#!/usr/bin/env bash
# The backup jobs. Sourced by hmis-backup. Each job records its outcome (record) and raises or
# clears its alert (alert_state); none of them exits the scheduler on failure.
# shellcheck source=lib.sh
source /opt/hmis-backup/lib.sh

NIGHT_HOUR=${BACKUP_NIGHT_HOUR:-1}
is_night() { (($((10#$(date +%H))) == NIGHT_HOUR)); }

# One heavy job at a time, whether started by the scheduler or by hand.
with_lock() {
  local fd rc
  mkdir -p "$STATE_DIR"
  exec {fd}>"$STATE_DIR/job.lock"
  if ! flock -w 7200 "$fd"; then
    log "Another backup job has been running for 2 hours; giving up on: $*"
    return 1
  fi
  "$@" && rc=0 || rc=$?
  flock -u "$fd"
  exec {fd}>&-
  return "$rc"
}

# --- Backups ----------------------------------------------------------------------------------
# Full weekly, differential nightly, incremental through the day. Decided from what is actually
# in the repository, so a server that was off catches up instead of silently skipping.
next_backup_type() {
  local info now full diff any fullp=$((${BACKUP_FULL_DAYS:-7} * 86400)) day=86400
  info=$(backup_info)
  now=$(date +%s)
  full=$(jq '[.[0].backup[]? | select(.type == "full") | .timestamp.stop] | max // 0' <<<"$info")
  diff=$(jq '[.[0].backup[]? | select(.type != "incr") | .timestamp.stop] | max // 0' <<<"$info")
  any=$(jq '[.[0].backup[]? | .timestamp.stop] | max // 0' <<<"$info")
  if ((full == 0)) || ((now - full >= fullp + 6 * 3600)) || { ((now - full >= fullp - 2 * 3600)) && is_night; }; then
    echo full
  elif ((now - diff >= day + 6 * 3600)) || { ((now - diff >= day - 2 * 3600)) && is_night; }; then
    echo diff
  elif ((now - any >= ${BACKUP_INCR_MINUTES:-60} * 60)); then
    echo incr
  fi
}

job_backup() {
  local type=$1 started out info size data
  started=$(date +%s)
  if out=$(pgbackrest --type="$type" backup 2>&1); then
    info=$(backup_info)
    size=$(jq -r '.[0].backup[-1].info.repository.delta // empty' <<<"$info")
    data=$(jq -c '.[0] as $s | {
        label: $s.backup[-1].label,
        databaseBytes: $s.backup[-1].info.size,
        backups: ($s.backup | length),
        oldestBackupAt: $s.backup[0].timestamp.start,
        newestBackupAt: $s.backup[-1].timestamp.stop,
        repositoryBytes: ([$s.backup[].info.repository.delta] | add),
        offsite: (env.OFFSITE_LOCATION // null)
      }' <<<"$info")
    record BACKUP OK "$type" "Finished in $(($(date +%s) - started)) s; $(human "$size") stored" "$size" "$data" "$started"
    alert_state backup ok "Backups are working again."
    heartbeat
  else
    record BACKUP FAILED "$type" "$(tail_text "$out")" "" '{}' "$started"
    alert_state backup failed "The $type backup failed: $(tail_text "$out" 3)"
    return 1
  fi
}

# --- Off-site copy (3-2-1) --------------------------------------------------------------------
# The encrypted repository is mirrored to S3-compatible storage with object lock. Deleting or
# overwriting there only adds a new version: the locked versions stay until their retention ends,
# so ransomware or a stolen key cannot erase the history. Mirroring (instead of pgBackRest writing
# to S3 directly) keeps the database independent of the internet: WAL lands on the local disk at
# once and goes off-site whenever the link is up.
job_offsite_sync() {
  offsite_configured || return 0
  local started out opts rc=0
  started=$(date +%s)
  mapfile -t opts < <(rclone_opts)
  out=$(rclone sync "$REPO_PATH" "$OFFSITE_REPO_URL" --exclude '*.tmp' "${opts[@]}" 2>&1) || rc=$?
  if ((rc == 0)) && [[ -d $ARCHIVE_DIR ]]; then
    # Long-term archives are only ever added off-site, never deleted from here.
    out+=$(rclone copy "$ARCHIVE_DIR" "$OFFSITE_ARCHIVE_URL" --exclude '*.part' "${opts[@]}" 2>&1) || rc=$?
  fi
  if ((rc == 0)); then
    echo "$(date +%s)" >"$STATE_DIR/offsite.ok"
    local prev
    prev=$(cat "$STATE_DIR/offsite.recorded" 2>/dev/null || echo 0)
    # An OK event every 15 minutes keeps the status page current; failures are always recorded.
    if (($(date +%s) - prev >= 900)) || [[ -f $STATE_DIR/alert-offsite && $(cut -d' ' -f1 "$STATE_DIR/alert-offsite") == failed ]]; then
      record OFFSITE_SYNC OK "" "Off-site copy is up to date" "$(du -sb "$REPO_PATH" | cut -f1)" \
        "$(jq -cn --arg l "${OFFSITE_LOCATION:-}" '{location: $l}')" "$started"
      date +%s >"$STATE_DIR/offsite.recorded"
    fi
    alert_state offsite ok "The off-site copy is up to date again."
  else
    record OFFSITE_SYNC FAILED "" "$(tail_text "$out")" "" '{}' "$started"
    local last
    last=$(cat "$STATE_DIR/offsite.ok" 2>/dev/null || echo 0)
    # A short internet outage is normal; alert once the copy is more than 6 hours behind.
    if (($(date +%s) - last >= ${OFFSITE_ALERT_HOURS:-6} * 3600)); then
      alert_state offsite failed "The off-site copy has not been updated for over ${OFFSITE_ALERT_HOURS:-6} hours: $(tail_text "$out" 2)"
    fi
    return 1
  fi
}

# --- Health check -----------------------------------------------------------------------------
job_check() {
  local force=${1:-} problems=() warnings=() archived failed ready path pct status message data prev
  if db_ready; then
    read -r archived failed ready < <(psql -XAt -F' ' -c "SELECT coalesce(extract(epoch FROM last_archived_time)::bigint, 0),
        coalesce(extract(epoch FROM last_failed_time)::bigint, 0),
        (SELECT count(*) FROM pg_ls_archive_statusdir() WHERE name LIKE '%.ready')
      FROM pg_stat_archiver") || true
    if ((${failed:-0} > ${archived:-0})); then problems+=("WAL archiving is failing, so recent changes are not being backed up"); fi
    if ((${ready:-0} > 30)); then problems+=("${ready} WAL files are waiting to be archived"); fi
  else
    problems+=("The database is not answering")
  fi
  for path in "$BACKUP_ROOT" "$PGDATA"; do
    pct=$(df --output=pcent "$path" 2>/dev/null | tail -1 | tr -dc '0-9')
    if ((${pct:-0} >= 90)); then
      problems+=("Disk for $path is ${pct}% full")
    elif ((${pct:-0} >= 80)); then
      warnings+=("Disk for $path is ${pct}% full")
    fi
  done
  if [[ $(df --output=source "$BACKUP_ROOT" | tail -1) == "$(df --output=source "$PGDATA" | tail -1)" && -z ${BACKUP_SAME_DISK_OK:-} ]]; then
    warnings+=("Backups are on the same disk as the database; put /backup on a second disk")
  fi
  offsite_configured || warnings+=("No off-site copy is configured")
  [[ -n ${BACKUP_ARCHIVE_RECIPIENT:-} ]] || warnings+=("Long-term archive is not set up (no BACKUP_ARCHIVE_RECIPIENT)")

  # Disk encryption, as found by deploy/host-check.sh on the host (a container can't see it).
  local hs=$STATE_DIR/host-security.json encryption='{"checked":false}'
  if [[ -f $hs ]] && jq -e . "$hs" >/dev/null 2>&1; then
    local plain checked_days
    plain=$(jq -r '[.disks[] | select(.encrypted | not) | .label] | join(", ")' "$hs")
    checked_days=$(( ($(date +%s) - $(stat -c %Y "$hs")) / 86400 ))
    [[ -z $plain ]] || warnings+=("Not encrypted: $plain. A stolen disk would expose patient records")
    ((checked_days <= 8)) || warnings+=("Disk encryption was last checked $checked_days days ago (run deploy/host-check.sh daily)")
    encryption=$(jq -c --argjson days "$checked_days" '{checked: true, checkedAt, daysAgo: $days, unencrypted: [.disks[] | select(.encrypted | not) | .label], unattendedBoot: ([.disks[] | select(.encrypted) | .tpm2] | all)}' "$hs")
  else
    warnings+=("Disk encryption has not been checked: run deploy/host-check.sh on the server")
  fi

  if ((${#problems[@]})); then
    status=FAILED
  elif ((${#warnings[@]})); then
    status=WARNING
  else
    status=OK
  fi
  message=$(printf '%s; ' "${problems[@]}" "${warnings[@]}" | sed 's/^; //; s/; $//')
  [[ -n $message ]] || message="Archiving, disk space and settings are fine"
  data=$(jq -cn --arg a "${archived:-0}" --arg r "${ready:-0}" --arg d "$(df --output=pcent "$BACKUP_ROOT" | tail -1 | tr -dc '0-9')" \
    --argjson offsite "$(offsite_configured && echo true || echo false)" --arg loc "${OFFSITE_LOCATION:-}" \
    --argjson archive "$([[ -n ${BACKUP_ARCHIVE_RECIPIENT:-} ]] && echo true || echo false)" --argjson encryption "$encryption" \
    '{lastArchivedAt: ($a|tonumber), walWaiting: ($r|tonumber), backupDiskPercent: ($d|tonumber), offsite: $offsite, offsiteLocation: $loc, archive: $archive, diskEncryption: $encryption}')
  prev=$(cat "$STATE_DIR/check.status" 2>/dev/null || echo none)
  # Record when the picture changes, and once a day so the status page stays fresh.
  if [[ -n $force || $status != "$prev" ]] || due check-recorded 86400; then
    record CHECK "$status" "" "$message" "" "$data"
    echo "$status" >"$STATE_DIR/check.status"
    mark_run check-recorded
    # Routine OK events are pruned after 90 days. Backups, tests, restores and every failure are
    # kept: they are the record of processing.
    if db_ready; then
      psql -XAtq -c "DELETE FROM \"BackupEvent\" WHERE kind IN ('OFFSITE_SYNC', 'CHECK') AND status = 'OK' AND \"finishedAt\" < now() - interval '90 days'" >/dev/null 2>&1 || true
    fi
  fi
  if ((${#problems[@]})); then alert_state check failed "$message"; else alert_state check ok "Backup health checks pass again."; fi
}

# --- Restore test -----------------------------------------------------------------------------
# A backup is only proven by restoring it. This restores the latest backup (and all WAL after it)
# into a throw-away PostgreSQL on the backup disk, checks every table and index for corruption,
# compares the data with the live database, records how long it took (the real recovery time),
# and deletes it again. "offsite" first downloads the off-site copy, which proves that copy too.
RT_DIR=$SCRATCH_DIR/restore-test
RT_PORT=5499

cleanup_restore_test() {
  if [[ -f $RT_DIR/postmaster.pid ]]; then pg_ctl -D "$RT_DIR" -m immediate stop >/dev/null 2>&1 || true; fi
  rm -rf "$RT_DIR" "$SCRATCH_DIR/offsite-repo"
}

rt_sql() { psql -h "$SCRATCH_DIR" -p "$RT_PORT" -XAt -c "$1" 2>/dev/null; }

job_restore_test() {
  local source=${1:-local} started repo logf=$SCRATCH_DIR/restore-test.log step data took
  local patients visits live_patients live_visits newest
  started=$(date +%s)
  if [[ $source == offsite ]] && ! offsite_configured; then return 0; fi
  if [[ $(jq '[.[0].backup[]?] | length' <<<"$(backup_info)") == 0 ]]; then
    log "No backup to test yet"
    return 0
  fi
  mkdir -p "$SCRATCH_DIR"
  cleanup_restore_test
  : >"$logf"
  repo=$REPO_PATH
  if [[ $source == offsite ]]; then
    repo=$SCRATCH_DIR/offsite-repo
    local opts
    mapfile -t opts < <(rclone_opts)
    step="downloading the off-site copy"
    rclone copy "$OFFSITE_REPO_URL" "$repo" "${opts[@]}" >>"$logf" 2>&1 || {
      restore_test_failed "$source" "$step" "$started"
      return 1
    }
  fi

  step="restoring"
  (
    export PGBACKREST_REPO1_PATH=$repo PGBACKREST_PG1_PATH=$RT_DIR
    mkdir -p "$RT_DIR" && chmod 700 "$RT_DIR" &&
      pgbackrest --stanza="$STANZA" --archive-mode=off --log-level-console=info restore
  ) >>"$logf" 2>&1 || {
    restore_test_failed "$source" "$step" "$started"
    return 1
  }

  step="starting the restored database and replaying WAL"
  (
    # archive-get (in restore_command) must read the same repository the restore came from. The
    # stanza is deliberately not in the environment: restore_command must carry everything else
    # itself, exactly as in a real disaster recovery.
    unset PGBACKREST_STANZA
    export PGBACKREST_REPO1_PATH=$repo PGBACKREST_PG1_PATH=$RT_DIR
    pg_ctl -D "$RT_DIR" -l "$SCRATCH_DIR/restore-test-postgres.log" -w -t 900 \
      -o "-p $RT_PORT -c listen_addresses='' -c unix_socket_directories=$SCRATCH_DIR -c archive_mode=off -c shared_buffers=128MB" start
  ) >>"$logf" 2>&1 || {
    restore_test_failed "$source" "$step" "$started"
    return 1
  }
  local i
  for ((i = 0; i < 900; i++)); do
    [[ $(rt_sql 'SELECT pg_is_in_recovery()') == f ]] && break
    sleep 2
  done
  if [[ $(rt_sql 'SELECT pg_is_in_recovery()') != f ]]; then
    restore_test_failed "$source" "$step (still recovering after 30 minutes)" "$started"
    return 1
  fi
  took=$(($(date +%s) - started))

  step="checking every table and index for corruption (pg_amcheck)"
  pg_amcheck -h "$SCRATCH_DIR" -p "$RT_PORT" --install-missing --all --heapallindexed >>"$logf" 2>&1 || {
    restore_test_failed "$source" "$step" "$started"
    return 1
  }

  step="reading the restored data"
  patients=$(rt_sql 'SELECT count(*) FROM "Patient"')
  visits=$(rt_sql 'SELECT count(*) FROM "Visit"')
  newest=$(rt_sql 'SELECT coalesce(extract(epoch FROM max("createdAt"))::bigint, 0) FROM "AuditLog"')
  live_patients=$(psql -XAt -c 'SELECT count(*) FROM "Patient"' 2>/dev/null || echo)
  live_visits=$(psql -XAt -c 'SELECT count(*) FROM "Visit"' 2>/dev/null || echo)
  if [[ -z $patients || -z $visits ]]; then
    restore_test_failed "$source" "$step: the HMIS tables are missing" "$started"
    return 1
  fi
  # The restore can only be behind the live database, never ahead of it.
  if [[ -n $live_patients ]] && ((patients > live_patients)); then
    restore_test_failed "$source" "$step: restored more patients ($patients) than the live database has ($live_patients)" "$started"
    return 1
  fi

  cleanup_restore_test
  data=$(jq -cn --arg s "$source" --arg t "$took" --arg p "$patients" --arg v "$visits" --arg lp "${live_patients:-}" \
    --arg lv "${live_visits:-}" --arg n "${newest:-0}" \
    '{source: $s, recoverySeconds: ($t|tonumber), patients: ($p|tonumber), visits: ($v|tonumber),
      livePatients: (if $lp == "" then null else ($lp|tonumber) end), liveVisits: (if $lv == "" then null else ($lv|tonumber) end),
      newestRecordAt: ($n|tonumber), integrity: "pg_amcheck passed"}')
  record RESTORE_TEST OK "$source" "Restored and checked in $took s: $patients patients, $visits visits, no corruption found" "" "$data" "$started"
  alert_state "restore-$source" ok "The $source restore test passes again."
}

restore_test_failed() {
  local source=$1 step=$2 started=$3
  record RESTORE_TEST FAILED "$source" "Failed while $step: $(tail_text "$(cat "$SCRATCH_DIR/restore-test.log" 2>/dev/null)" 4)" "" \
    "$(jq -cn --arg s "$source" '{source: $s}')" "$started"
  alert_state "restore-$source" failed "The $source restore test failed while $step. The backups may not be usable: check them now."
  cp -f "$SCRATCH_DIR/restore-test.log" "$STATE_DIR/restore-test-failed.log" 2>/dev/null || true
  cleanup_restore_test
}

# --- Repository verification ------------------------------------------------------------------
# Re-reads every file in the repository and checks it against its recorded checksum (bit rot,
# a failing disk, tampering), and checks that the WAL needed by each backup is all there.
job_verify() {
  local started out
  started=$(date +%s)
  if out=$(pgbackrest verify --log-level-console=info 2>&1) && ! grep -qiE 'error|invalid|missing' <<<"$out"; then
    record VERIFY OK "" "Every file in the backup repository matches its checksum" "" '{}' "$started"
    alert_state verify ok "Backup repository verification passes again."
  else
    record VERIFY FAILED "" "$(tail_text "$out")" "" '{}' "$started"
    alert_state verify failed "Backup repository verification found problems: $(tail_text "$out" 2)"
    return 1
  fi
}

# --- Long-term archive ------------------------------------------------------------------------
# Once a month, a logical dump (pg_dump), encrypted to a public key whose private half is kept
# offline. It restores into any future PostgreSQL version, which physical backups do not, so it
# covers the years medical records must be kept. Off-site, these are only ever added.
archive_recipients() {
  local r out=()
  for r in ${BACKUP_ARCHIVE_RECIPIENT//,/ }; do out+=(-r "$r"); done
  printf '%s\n' "${out[@]}"
}

job_archive() {
  [[ -n ${BACKUP_ARCHIVE_RECIPIENT:-} ]] || return 0
  local started file size recipients
  started=$(date +%s)
  mkdir -p "$ARCHIVE_DIR"
  file="$ARCHIVE_DIR/hmis-$(date +%F).dump.age"
  mapfile -t recipients < <(archive_recipients)
  if pg_dump -Fc --compress=zstd:6 "$PGDATABASE" 2>"$STATE_DIR/archive.err" | age "${recipients[@]}" -o "$file.part" 2>>"$STATE_DIR/archive.err"; then
    mv "$file.part" "$file"
    (cd "$ARCHIVE_DIR" && sha256sum "$(basename "$file")" >"$(basename "$file").sha256")
    size=$(stat -c %s "$file")
    # Local copies are pruned; the off-site ones are kept by the bucket's lifecycle rule.
    find "$ARCHIVE_DIR" -name 'hmis-*.dump.age*' -mtime +$((${BACKUP_ARCHIVE_LOCAL_MONTHS:-12} * 31)) -delete
    record ARCHIVE OK "monthly" "Encrypted monthly archive $(basename "$file") ($(human "$size"))" "$size" \
      "$(jq -cn --arg f "$(basename "$file")" '{file: $f}')" "$started"
    alert_state archive ok "The monthly archive works again."
  else
    rm -f "$file.part"
    record ARCHIVE FAILED "monthly" "$(tail_text "$(cat "$STATE_DIR/archive.err")")" "" '{}' "$started"
    alert_state archive failed "The monthly long-term archive failed: $(tail_text "$(cat "$STATE_DIR/archive.err")" 2)"
    return 1
  fi
}
archive_due() {
  [[ -n ${BACKUP_ARCHIVE_RECIPIENT:-} ]] || return 1
  compgen -G "$ARCHIVE_DIR/hmis-$(date +%Y-%m)-*.dump.age" >/dev/null && return 1
  # The first archive is made straight away; after that, at night.
  compgen -G "$ARCHIVE_DIR/hmis-*.dump.age" >/dev/null || return 0
  is_night
}

# --- Scheduler --------------------------------------------------------------------------------
tick() {
  flush_pending
  local type
  if due backup-failed 900; then
    type=$(next_backup_type)
    if [[ -n $type ]]; then
      if with_lock job_backup "$type"; then
        mark_run offsite-sync
        job_offsite_sync || true
      else
        mark_run backup-failed
      fi
    fi
  fi
  if due offsite-sync $((${OFFSITE_SYNC_MINUTES:-5} * 60)); then
    mark_run offsite-sync
    job_offsite_sync || true
  fi
  if due check 600; then
    mark_run check
    job_check || true
  fi
  # Heavy jobs: the first run happens straight away, later ones at night. A failed run is tried
  # again the next night.
  local rt=$((${RESTORE_TEST_DAYS:-7} * 86400 - 3 * 3600)) rto=$((${RESTORE_TEST_OFFSITE_DAYS:-30} * 86400 - 3 * 3600))
  local vf=$((7 * 86400 - 3 * 3600))
  if due restore-test "$rt" && { [[ $(last_run restore-test) == 0 ]] || is_night; }; then
    if with_lock job_restore_test local; then mark_run restore-test; else mark_retry restore-test "$rt"; fi
  fi
  if offsite_configured && due restore-test-offsite "$rto" && { [[ $(last_run restore-test-offsite) == 0 ]] || is_night; }; then
    if with_lock job_restore_test offsite; then mark_run restore-test-offsite; else mark_retry restore-test-offsite "$rto"; fi
  fi
  if due verify "$vf" && { [[ $(last_run verify) == 0 ]] || is_night; }; then
    if with_lock job_verify; then mark_run verify; else mark_retry verify "$vf"; fi
  fi
  if due archive-failed 3600 && archive_due; then
    if with_lock job_archive; then job_offsite_sync || true; else mark_run archive-failed; fi
  fi
}
