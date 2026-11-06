#!/usr/bin/env bash
# Disaster recovery: replaces the database with a backup. Read docs/backup/RESTORE.md first.
# Runs in the one-off "restore" container while the database is stopped:
#   docker compose stop api web backup db
#   docker compose run --rm restore hmis-backup restore --time "2026-11-06 10:42"
# shellcheck source=lib.sh
source /opt/hmis-backup/lib.sh

usage() {
  cat <<'EOF'
hmis-backup restore [options]

  --time "YYYY-MM-DD HH:MM[:SS]"   restore to this moment (clinic time unless an offset is given);
                                   without it, restore everything up to the last archived change
  --from local|offsite             where to restore from (default: local, the backup disk)
  --offsite-as-of "YYYY-MM-DD HH:MM"
                                   with --from offsite: use the off-site copy as it was at this
                                   moment, from the locked versions (e.g. before a ransomware attack)
  --yes                            don't ask for confirmation
EOF
}

die() {
  log "RESTORE STOPPED: $*"
  exit 1
}

target="" from=local as_of="" yes=""
while (($#)); do
  case $1 in
    --time) target=$2; shift 2 ;;
    --from) from=$2; shift 2 ;;
    --offsite-as-of) as_of=$2; shift 2 ;;
    --yes) yes=1; shift ;;
    -h | --help) usage; exit 0 ;;
    *) usage; die "unknown option $1" ;;
  esac
done
[[ $from == local || $from == offsite ]] || die "--from must be local or offsite"
[[ -z $as_of || $from == offsite ]] || die "--offsite-as-of only applies with --from offsite"
require_settings || die "BACKUP_ENCRYPTION_KEY is needed to read the backups"
db_ready && die "The database is running. Stop it first: docker compose stop api web backup db"
[[ -w $PGDATA ]] || die "$PGDATA is not writable: run this through the restore service (docker compose run --rm restore ...)"

stamp=$(date +%Y%m%d-%H%M%S)
mkdir -p "$STATE_DIR" "$SCRATCH_DIR"

if [[ $from == offsite ]]; then
  offsite_configured || die "No off-site storage is configured (OFFSITE_S3_*)"
  dl=$SCRATCH_DIR/offsite-restore-$stamp
  mapfile -t opts < <(rclone_opts)
  [[ -n $as_of ]] && opts+=(--s3-version-at "$as_of")
  log "Downloading the off-site copy${as_of:+ as it was at $as_of}..."
  rclone copy "$OFFSITE_REPO_URL" "$dl" "${opts[@]}" || die "download from off-site storage failed"
  # The restored database will keep archiving into /backup/pgbackrest and fetch WAL from there, so
  # the downloaded copy becomes the local repository. The previous one is kept, not deleted.
  if [[ -d $REPO_PATH && -n $(ls -A "$REPO_PATH" 2>/dev/null) ]]; then
    mv "$REPO_PATH" "$BACKUP_ROOT/pgbackrest.before-restore-$stamp"
    log "Previous local repository kept in $BACKUP_ROOT/pgbackrest.before-restore-$stamp"
  else
    rm -rf "$REPO_PATH"
  fi
  mv "$dl" "$REPO_PATH"
fi

pgbackrest info || die "the backup repository cannot be read (wrong BACKUP_ENCRYPTION_KEY?)"

args=()
if [[ -n $target ]]; then
  # Without an offset PostgreSQL would read the time as UTC; people mean clinic time.
  [[ $target =~ ([+-][0-9]{2}(:?[0-9]{2})?|Z|UTC)$ ]] || target="$target$(date +%z)"
  args+=(--type=time "--target=$target" --target-action=promote)
fi

echo
echo "This REPLACES the current database with the backup${target:+ as it was at $target}."
echo "Everything entered after that moment will be gone from the database."
echo "The current database files are copied to $BACKUP_ROOT/pre-restore/$stamp first."
if [[ -z $yes ]]; then
  [[ -t 0 ]] || die "no terminal to confirm on: add --yes"
  read -r -p "Type RESTORE to continue: " answer
  [[ $answer == RESTORE ]] || die "not confirmed"
fi

started=$(date +%s)
if [[ -n $(ls -A "$PGDATA" 2>/dev/null) ]]; then
  need=$(du -sb "$PGDATA" | cut -f1)
  free=$(df --output=avail -B1 "$BACKUP_ROOT" | tail -1)
  ((free > need + 1073741824)) || die "not enough space on the backup disk to keep a copy of the current database ($(human "$need") needed)"
  mkdir -p "$BACKUP_ROOT/pre-restore/$stamp"
  cp -a "$PGDATA/." "$BACKUP_ROOT/pre-restore/$stamp/" || die "could not copy the current database aside"
  log "Current database copied to $BACKUP_ROOT/pre-restore/$stamp"
  args+=(--delta)
fi

pgbackrest --stanza="$STANZA" "${args[@]}" --log-level-console=info restore || die "pgBackRest could not restore (the old files are in $BACKUP_ROOT/pre-restore/$stamp)"

# Written to the database's BackupEvent table by the backup worker once everything is running,
# so the restore itself is part of the record of processing.
line=$(jq -cn --arg d "$from" --arg t "${target:-latest}" --arg a "$as_of" --arg st "$started" --arg fin "$(date +%s)" --arg u "${RESTORED_BY:-}" \
  '{kind: "RESTORE", status: "OK", detail: $d, message: ("Database restored from the \($d) backup to \($t)" + (if $a != "" then " (off-site copy as of \($a))" else "" end) + (if $u != "" then " by \($u)" else "" end)),
    size: "", data: {target: $t, source: $d, offsiteAsOf: $a, by: $u}, started: ($st|tonumber), finished: ($fin|tonumber)}')
printf '%s\n' "$line" >>"$STATE_DIR/events.log"
printf '%s\n' "$line" >>"$STATE_DIR/pending.log"
send_alert "Database restored from the $from backup to ${target:-the latest point}."

cat <<EOF

Restore complete. Next:
  1. docker compose up -d db          (PostgreSQL replays the changes up to the target; watch: docker compose logs -f db)
  2. Check the data, e.g. the last patients registered before ${target:-the failure}.
  3. docker compose up -d backup api web
  4. docker compose exec backup hmis-backup now full     (a fresh full backup of the restored database)
The previous database files are in $BACKUP_ROOT/pre-restore/$stamp until you delete them.
EOF
