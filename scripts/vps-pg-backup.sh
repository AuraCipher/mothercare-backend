#!/usr/bin/env bash
#
# M16 — VPS nightly PostgreSQL backup → Cloudflare R2.
# Called by cron (see CRON LINE below), NOT run locally.
#
# CRON LINE (VPS, as the deploy user — edit path to match your checkout):
#   30 2 * * * /opt/mcs-app/backend/scripts/vps-pg-backup.sh
#
# Prerequisites on the VPS:
#   - postgresql-client (provides pg_dump):  apt-get install -y postgresql-client
#   - backend/.env present with DATABASE_URL + R2_ACCOUNT_ID /
#     R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY (+ optional R2_BACKUPS_BUCKET)
#   - node_modules installed (npm ci)
#
# Log rotation (/etc/logrotate.d/mcs-pg-backup):
#   /var/log/mcs/pg-backup.log {
#     weekly
#     rotate 8
#     compress
#     missingok
#     notifempty
#   }
#
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/mcs-app/backend}"
LOG_FILE="${LOG_FILE:-/var/log/mcs/pg-backup.log}"
LOCK_FILE="${LOCK_FILE:-/tmp/mcs-pg-backup.lock}"
DB_BACKUP_ENABLED="${DB_BACKUP_ENABLED:-true}"

mkdir -p "$(dirname "$LOG_FILE")"

# Skip if backup disabled
if [ "$DB_BACKUP_ENABLED" != "true" ]; then
  echo "$(date -u +%FT%TZ) backup SKIPPED: DB_BACKUP_ENABLED=false" >>"$LOG_FILE"
  exit 0
fi

# flock -n: if yesterday's dump is still running, skip instead of piling up.
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "$(date -u +%FT%TZ) backup SKIPPED: previous run still holding lock" >>"$LOG_FILE"
  exit 0
fi

command -v pg_dump >/dev/null || {
  echo "$(date -u +%FT%TZ) backup FAILED: pg_dump not installed (apt-get install -y postgresql-client)" >>"$LOG_FILE"
  exit 1
}

cd "$APP_DIR"

{
  echo "===== $(date -u +%FT%TZ) backup start ====="
  if npm run db:backup --silent; then
    echo "===== $(date -u +%FT%TZ) backup OK ====="
  else
    echo "===== $(date -u +%FT%TZ) backup FAILED (exit $?) ====="
    exit 1
  fi
} >>"$LOG_FILE" 2>&1
