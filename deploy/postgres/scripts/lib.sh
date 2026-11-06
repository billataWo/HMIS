#!/usr/bin/env bash
# Shared settings and helpers for the HMIS backup scripts. Sourced, not run.
set -Eeuo pipefail

STANZA=hmis
BACKUP_ROOT=/backup
REPO_PATH=$BACKUP_ROOT/pgbackrest   # pgBackRest repository (encrypted)
ARCHIVE_DIR=$BACKUP_ROOT/archive    # monthly long-term archives (encrypted with age)
STATE_DIR=$BACKUP_ROOT/state        # scheduler state, alert state, local event log
SCRATCH_DIR=$BACKUP_ROOT/scratch    # restore tests and off-site downloads
PGDATA=${PGDATA:-/var/lib/postgresql/data}
PGSOCKET=/var/run/postgresql

export PGHOST=$PGSOCKET
export PGUSER=${POSTGRES_USER:-postgres}
export PGDATABASE=${POSTGRES_DB:-$PGUSER}
export PGPASSWORD=${POSTGRES_PASSWORD:-}
export PGBACKREST_STANZA=$STANZA
export PGBACKREST_PG1_USER=$PGUSER
export PGBACKREST_PG1_DATABASE=$PGDATABASE
export PGBACKREST_REPO1_RETENTION_FULL=${BACKUP_RETENTION_DAYS:-14}

SITE=${BACKUP_SITE_NAME:-HMIS server}
OFFSITE_PREFIX=${OFFSITE_S3_PREFIX:-$(printf '%s' "$SITE" | tr -cs 'A-Za-z0-9' '-' | tr 'A-Z' 'a-z' | sed 's/^-*//; s/-*$//')}

log() { printf '%s %s\n' "$(date +'%F %T %Z')" "$*" >&2; }

# The off-site copy goes to S3-compatible storage with object lock (WORM). rclone reads its
# remote from these variables, so no credentials are written to disk.
offsite_configured() { [[ -n ${OFFSITE_S3_BUCKET:-} && -n ${OFFSITE_S3_ENDPOINT:-} ]]; }
if offsite_configured; then
  export RCLONE_CONFIG_OFFSITE_TYPE=s3
  export RCLONE_CONFIG_OFFSITE_PROVIDER=${OFFSITE_S3_PROVIDER:-Other}
  export RCLONE_CONFIG_OFFSITE_ENDPOINT=$OFFSITE_S3_ENDPOINT
  export RCLONE_CONFIG_OFFSITE_REGION=${OFFSITE_S3_REGION:-us-east-1}
  export RCLONE_CONFIG_OFFSITE_ACCESS_KEY_ID=${OFFSITE_S3_ACCESS_KEY:-}
  export RCLONE_CONFIG_OFFSITE_SECRET_ACCESS_KEY=${OFFSITE_S3_SECRET_KEY:-}
  export RCLONE_CONFIG_OFFSITE_FORCE_PATH_STYLE=true
fi
OFFSITE_REPO_URL="offsite:${OFFSITE_S3_BUCKET:-}/pgbackrest/$OFFSITE_PREFIX"
OFFSITE_ARCHIVE_URL="offsite:${OFFSITE_S3_BUCKET:-}/archive/$OFFSITE_PREFIX"
rclone_opts() {
  local opts=(--s3-no-check-bucket --retries 5 --low-level-retries 20 --contimeout 30s --timeout 10m --stats 0 -q)
  [[ -n ${OFFSITE_BWLIMIT:-} ]] && opts+=(--bwlimit "$OFFSITE_BWLIMIT")
  printf '%s\n' "${opts[@]}"
}

require_settings() {
  local key=${PGBACKREST_REPO1_CIPHER_PASS:-}
  if (( ${#key} < 24 )); then
    log "BACKUP_ENCRYPTION_KEY is missing or shorter than 24 characters: backups refuse to run unencrypted."
    return 1
  fi
}

db_ready() { pg_isready -q -h "$PGSOCKET" -t 5; }

# --- Event log --------------------------------------------------------------------------------
# Every event goes to the local log on the backup disk, and to the BackupEvent table when the
# database is up (the app's Settings → Backups page reads it). Events written while the database
# was down are kept in pending.log and replayed later.
record() { # kind status [detail] [message] [size_bytes] [json] [started_epoch]
  local kind=$1 status=$2 detail=${3:-} message=${4:-} size=${5:-} data=${6:-}
  local started=${7:-$(date +%s)}
  [[ -n $data ]] || data='{}'
  local line
  line=$(jq -cn --arg k "$kind" --arg s "$status" --arg d "$detail" --arg m "$message" --arg z "$size" \
    --argjson j "$data" --arg st "$started" --arg fin "$(date +%s)" \
    '{kind:$k,status:$s,detail:$d,message:$m,size:$z,data:$j,started:($st|tonumber),finished:($fin|tonumber)}')
  mkdir -p "$STATE_DIR"
  printf '%s\n' "$line" >>"$STATE_DIR/events.log"
  insert_event "$line" || printf '%s\n' "$line" >>"$STATE_DIR/pending.log"
  log "$kind $status ${detail:+($detail) }${message}"
}

insert_event() {
  db_ready || return 1
  local line=$1
  psql -X -q -v ON_ERROR_STOP=1 \
    -v kind="$(jq -r .kind <<<"$line")" -v status="$(jq -r .status <<<"$line")" \
    -v detail="$(jq -r .detail <<<"$line")" -v message="$(jq -r .message <<<"$line")" \
    -v size="$(jq -r .size <<<"$line")" -v data="$(jq -c .data <<<"$line")" \
    -v started="$(jq -r .started <<<"$line")" -v finished="$(jq -r .finished <<<"$line")" \
    -v site="$SITE" >/dev/null 2>&1 <<'SQL'
INSERT INTO "BackupEvent" ("id", "kind", "status", "detail", "message", "sizeBytes", "data", "site", "startedAt", "finishedAt")
VALUES (gen_random_uuid()::text, :'kind', :'status', NULLIF(:'detail', ''), NULLIF(:'message', ''),
        NULLIF(:'size', '')::bigint, :'data'::jsonb, :'site',
        -- The columns hold UTC (as Prisma writes them), whatever the server's time zone.
        to_timestamp(:'started') AT TIME ZONE 'UTC', to_timestamp(:'finished') AT TIME ZONE 'UTC');
SQL
}

flush_pending() {
  [[ -s $STATE_DIR/pending.log ]] || return 0
  db_ready || return 0
  local rest=() line
  while IFS= read -r line; do
    [[ -n $line ]] || continue
    insert_event "$line" || rest+=("$line")
  done <"$STATE_DIR/pending.log"
  if ((${#rest[@]})); then printf '%s\n' "${rest[@]}" >"$STATE_DIR/pending.log"; else rm -f "$STATE_DIR/pending.log"; fi
}

# --- Alerts -----------------------------------------------------------------------------------
send_alert() {
  local text="[$SITE] $1"
  if [[ -n ${ALERT_TELEGRAM_BOT_TOKEN:-} && -n ${ALERT_TELEGRAM_CHAT_ID:-} ]]; then
    curl -fsS -m 20 --retry 3 "https://api.telegram.org/bot${ALERT_TELEGRAM_BOT_TOKEN}/sendMessage" \
      --data-urlencode "chat_id=${ALERT_TELEGRAM_CHAT_ID}" --data-urlencode "text=${text}" >/dev/null ||
      log "Telegram alert could not be sent"
  fi
  if [[ -n ${ALERT_SMTP_URL:-} && -n ${ALERT_EMAIL_TO:-} ]]; then
    local from=${ALERT_EMAIL_FROM:-hmis-backup@localhost} rcpt=() addr
    IFS=',' read -ra addrs <<<"$ALERT_EMAIL_TO"
    for addr in "${addrs[@]}"; do rcpt+=(--mail-rcpt "${addr// /}"); done
    printf 'From: %s\r\nTo: %s\r\nSubject: %s\r\nDate: %s\r\n\r\n%s\r\n' \
      "$from" "$ALERT_EMAIL_TO" "HMIS backup: ${1%%$'\n'*}" "$(date -R)" "$text" |
      curl -fsS -m 30 --ssl-reqd --url "$ALERT_SMTP_URL" --mail-from "$from" "${rcpt[@]}" -T - >/dev/null ||
      log "Email alert could not be sent"
  fi
}

# Alert when something starts failing, every 6 hours while it keeps failing, and once when it
# recovers, instead of once a minute.
alert_state() { # key ok|failed message
  local key=$1 state=$2 message=$3 file="$STATE_DIR/alert-$1" now prev=ok since=0
  now=$(date +%s)
  [[ -f $file ]] && read -r prev since <"$file"
  if [[ $state == failed ]]; then
    if [[ $prev != failed ]] || ((now - since >= 6 * 3600)); then
      send_alert "PROBLEM: $message"
      echo "failed $now" >"$file"
    fi
  elif [[ $prev == failed ]]; then
    send_alert "RESOLVED: $message"
    echo "ok $now" >"$file"
  fi
}

# Dead-man's switch: an outside monitor (e.g. healthchecks.io, Uptime Kuma) expects this ping
# after every successful backup and raises the alarm itself if the whole server goes quiet.
heartbeat() {
  [[ -n ${BACKUP_HEARTBEAT_URL:-} ]] || return 0
  curl -fsS -m 10 --retry 3 "$BACKUP_HEARTBEAT_URL" >/dev/null || log "Heartbeat ping failed"
}

# --- Scheduler state --------------------------------------------------------------------------
last_run() { [[ -f $STATE_DIR/$1.last ]] && cat "$STATE_DIR/$1.last" || echo 0; }
mark_run() { date +%s >"$STATE_DIR/$1.last"; }
# After a failure, try again in an hour rather than waiting a whole interval.
mark_retry() { echo $(($(date +%s) - $2 + 3600)) >"$STATE_DIR/$1.last"; }
due() { (($(date +%s) - $(last_run "$1") >= $2)); }

backup_info() { pgbackrest --output=json info 2>/dev/null || echo '[]'; }
human() { numfmt --to=iec --suffix=B "${1:-0}" 2>/dev/null || echo "${1}B"; }
tail_text() { tail -n "${2:-6}" <<<"$1" | tr '\n' ' ' | cut -c1-900; }
