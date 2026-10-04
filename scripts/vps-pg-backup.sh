#!/usr/bin/env bash
#
# vps-pg-backup.sh — nightly PostgreSQL backup for the MCS VPS.
#
#   Layer 1 (ALWAYS, zero config): local pg_dump -> /var/backups/mcs/
#   Layer 2 (if R2_* keys are set): upload to Cloudflare R2 via `npm run db:backup`,
#                                   with remote retention (DB_BACKUP_RETENTION_DAYS)
#
# Layer 1 exists because scripts/backup-postgres-r2.ts hard-requires
# R2_ACCOUNT_ID + R2_ACCESS_KEY_ID + R2_SECRET_ACCESS_KEY (line 38) and exits 1
# without them — a cron that can only fail is worse than no cron. Local dumps
# also give you a restore path when R2 credentials are rotated/broken.
#
# CRON (root @ VPS — see setup block at the bottom of this file's docs):
#   30 2 * * * /home/root/mothercare-backend/scripts/vps-pg-backup.sh
#
# LOGROTATE  /etc/logrotate.d/mcs-pg-backup:
#   /var/log/mcs/pg-backup.log {
#     weekly
#     rotate 8
#     compress
#     missingok
#     notifempty
#     copytruncate
#   }
#
# Tunables (put in $APP_DIR/.env or export in the cron line):
#   DB_BACKUP_ENABLED=true          kill switch
#   DB_BACKUP_LOCAL_DAYS=7          keep local dumps this many days (default 7)
#   DB_BACKUP_RETENTION_DAYS=30     R2 retention (read by the node script)
#   R2_BACKUPS_BUCKET=mcs-backups   R2 bucket name
#
set -euo pipefail

APP_DIR="${APP_DIR:-/home/root/mothercare-backend}"
LOG_FILE="${LOG_FILE:-/var/log/mcs/pg-backup.log}"
LOCK_FILE="${LOCK_FILE:-/tmp/mcs-pg-backup.lock}"
LOCAL_DIR="${LOCAL_DIR:-/var/backups/mcs}"
LOCAL_DAYS="${DB_BACKUP_LOCAL_DAYS:-7}"
DB_BACKUP_ENABLED="${DB_BACKUP_ENABLED:-true}"

say() { echo "$(date -u +%FT%TZ) $*"; }
fail() { say "FAILED: $*"; exit 1; }

mkdir -p "$(dirname "$LOG_FILE")"

[ "$DB_BACKUP_ENABLED" = "true" ] || { say "SKIPPED: DB_BACKUP_ENABLED=false" >>"$LOG_FILE"; exit 0; }

# flock -n: if yesterday's run is somehow still going, skip rather than pile up.
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  say "SKIPPED: previous run still holding lock" >>"$LOG_FILE"
  exit 0
fi

command -v pg_dump  >/dev/null || fail "pg_dump not installed (apt-get install -y postgresql-client)"
command -v pg_restore >/dev/null || fail "pg_restore not installed (same package)"
[ -f "$APP_DIR/.env" ] || fail "$APP_DIR/.env missing"
[ -f "$APP_DIR/scripts/backup-postgres-r2.ts" ] || fail "R2 backup script missing under $APP_DIR/scripts"

# Strip quotes and Prisma-only query params (?connection_limit=… ) that libpq
# rejects when handed straight to pg_dump. DB is on 127.0.0.1 so no TLS params
# are lost by dropping the query string.
DB_URL="$(grep -E '^DATABASE_URL=' "$APP_DIR/.env" | tail -n1 | cut -d= -f2- | sed 's/^"//; s/"$//; s/?.*//' || true)"
[ -n "$DB_URL" ] || fail "DATABASE_URL not found in $APP_DIR/.env"

# Is R2 fully configured? (keys live in .env; the node script loads them itself)
R2_READY=true
for k in R2_ACCOUNT_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY; do
  grep -qE "^${k}=..*" "$APP_DIR/.env" || R2_READY=false
done

{
  say "===== backup start ====="

  # Detect the fused-line bug (two keys on one line, missing newline) that
  # silently broke ALLOWED_ORIGINS earlier — same class of failure here.
  if grep -nE '^[A-Z_]+=[^ ]*R2_[A-Z_]+=' "$APP_DIR/.env"; then
    say "WARN: fused .env line(s) shown above — R2 values may be garbage; fix the newline"
    R2_READY=false
  fi

  # ── Layer 1: local dump ────────────────────────────────────────────────
  mkdir -p "$LOCAL_DIR"
  OUT="$LOCAL_DIR/mcs-$(date +%Y%m%d-%H%M%S).dump"
  say "pg_dump -> $OUT"
  pg_dump --no-owner -Fc -f "$OUT" "$DB_URL"
  [ -s "$OUT" ] || { rm -f "$OUT"; fail "pg_dump produced an empty file"; }
  chmod 600 "$OUT"

  # Integrity check: can it actually be read back as an archive?
  if pg_restore --list "$OUT" >/dev/null 2>&1; then
    say "local dump OK: $OUT ($(du -h "$OUT" | cut -f1)) [archive readable]"
  else
    say "WARN: local dump written but pg_restore --list could not read it"
  fi

  # ── Layer 1 retention ──────────────────────────────────────────────────
  DELETED="$(find "$LOCAL_DIR" -maxdepth 1 -name 'mcs-*.dump' -mtime +"$LOCAL_DAYS" -print -delete | wc -l)"
  say "local retention: removed ${DELETED} dump(s) older than ${LOCAL_DAYS} day(s), $(ls -1 "$LOCAL_DIR"/mcs-*.dump 2>/dev/null | wc -l) kept"

  # ── Layer 2: R2 upload ─────────────────────────────────────────────────
  if [ "$R2_READY" = "true" ]; then
    if [ ! -d "$APP_DIR/node_modules/ts-node" ]; then
      # npm run db:backup = npx ts-node … (ts-node is a devDependency)
      say "R2 skipped: ts-node missing — run 'npm ci' in $APP_DIR (dev deps must be installed)"
    elif (cd "$APP_DIR" && npm run db:backup --silent); then
      say "R2 upload OK (retention: ${DB_BACKUP_RETENTION_DAYS:-30} days)"
    else
      say "R2 upload FAILED — local dump $OUT is intact and restorable"
    fi
  else
    say "R2 skipped: R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY not all set in $APP_DIR/.env"
  fi

  say "===== backup OK ====="
} >>"$LOG_FILE" 2>&1
