#!/usr/bin/env bash
#
# deploy.sh — one-command production deploy for the MCS backend (runs ON the VPS).
#
#   cd /home/root/mothercare-backend
#   ./deploy.sh
#
# Pipeline:
#   0  preflight   refuse to run outside the app dir; LINT .env (catches the
#                  fused-line bug that broke CORS); warn if a dev process is up
#   1  update      git pull --ff-only (LOUD warning if this is not a git checkout)
#   2  install     npm ci                    SKIP_INSTALL=1
#   3  generate    npx prisma generate
#   4  build       npm run build  -> old dist/ parked as dist.prev (rollback bait)
#   5  admin page  src/admin/index.html -> dist/src/admin/  (postbuild also does it)
#   6  migrate     npx prisma migrate deploy SKIP_MIGRATE=1
#   7  restart     pm2 restart mcs-backend --update-env && pm2 save
#   8  verify      poll /health; on failure restore dist.prev and restart
#
# Manual rollback:   ./deploy.sh --rollback
#
# NOTE: migrate runs AFTER a successful build, so a code failure can never
# leave a new schema under an old server (that's exactly how /setup/init 500'd).
#
set -euo pipefail

APP_DIR="${APP_DIR:-$PWD}"
APP_NAME="${APP_NAME:-mcs-backend}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:5000/health}"
PUBLIC_URL="${PUBLIC_URL:-https://api.mothercareschool.pk}"
SKIP_INSTALL="${SKIP_INSTALL:-}"
SKIP_MIGRATE="${SKIP_MIGRATE:-}"

log()  { printf '[deploy] %s\n' "$*"; }
warn() { printf '[deploy] WARNING: %s\n' "$*" >&2; }
die()  { printf '[deploy] ERROR: %s\n' "$*" >&2; exit 1; }

# ── 0. Preflight ────────────────────────────────────────────────────────────
[ -f "$APP_DIR/package.json" ] || die "no package.json here — run from the app dir (got: $APP_DIR)"
[ -f "$APP_DIR/.env" ]         || die "$APP_DIR/.env is missing"
cd "$APP_DIR"

command -v node >/dev/null || die "node not on PATH"
command -v npm  >/dev/null || die "npm not on PATH"
command -v pm2  >/dev/null || die "pm2 not on PATH (npm i -g pm2 — keep it global so npm ci can't delete it)"
case "$(command -v pm2)" in
  */node_modules/.bin/*) warn "pm2 is a local install — 'npm ci' will delete it. Install globally: npm i -g pm2" ;;
esac

# .env lint — the bug that produced a day of CORS 500s: two keys fused onto one
# line because a newline was missing, so ALLOWED_ORIGINS silently became garbage
# and APP_URL stopped existing. dotenv never complains about either.
lint_env() {
  local key count
  for key in ALLOWED_ORIGINS APP_URL FRONTEND_URL DATABASE_URL PORT HOST NODE_ENV; do
    count="$(grep -c "^${key}=" "$APP_DIR/.env" || true)"
    if [ "$count" = "0" ]; then
      die ".env: '^${key}=' not found — likely merged into another line (missing newline). See: grep -n '${key}=' .env"
    fi
    if [ "$count" != "1" ]; then
      die ".env: '^${key}=' appears ${count} times — remove the duplicate"
    fi
  done
  # R2 keys: right names AND right lengths (32 / 32 / 64). We once found two
  # endpoint URLs sitting in the key fields — auth failed with a cryptic
  # "Credential access key has length 65, should be 32".
  local pair len
  for pair in "R2_ACCOUNT_ID:32" "R2_ACCESS_KEY_ID:32" "R2_SECRET_ACCESS_KEY:64"; do
    key="${pair%%:*}"; len="${pair##*:}"
    if grep -q "^${key}=" "$APP_DIR/.env"; then
      local v
      v="$(grep "^${key}=" "$APP_DIR/.env" | tail -n1 | cut -d= -f2- | tr -d '"')"
      [ "${#v}" = "$len" ] || die ".env: ${key} is ${#v} chars, expected ${len} — wrong value pasted (a URL? run: node scripts/r2-list-buckets.js)"
    fi
  done
  if grep -nE '^[A-Z_]+=[^ ]*(ALLOWED_ORIGINS|APP_URL|FRONTEND_URL|DATABASE_URL|R2_)=' "$APP_DIR/.env"; then
    die ".env: fused line above (two keys on one line, no newline between them)"
  fi
  if grep -q $'\r' "$APP_DIR/.env"; then
    warn ".env contains CRLF (Windows) line endings — convert with: sed -i 's/\r$//' .env"
  fi
}
lint_env
log ".env lint OK (critical keys present once, correct lengths, no fused lines)"

PM2_LIST="$(pm2 jlist 2>/dev/null || true)"
case "$PM2_LIST" in
  *nodemon*|*ts-node*) warn "a dev-mode process is running under pm2 — production must be dist/server.js only" ;;
esac

if [ "${1:-}" = "--rollback" ]; then
  [ -d "$APP_DIR/dist.prev" ] || die "nothing to roll back to (dist.prev missing)"
  rm -rf "$APP_DIR/dist.broken"
  [ -d "$APP_DIR/dist" ] && mv "$APP_DIR/dist" "$APP_DIR/dist.broken"
  mv "$APP_DIR/dist.prev" "$APP_DIR/dist"
  log "restored previous dist/"
  pm2 restart "$APP_NAME" --update-env && pm2 save
  exit 0
fi

restart_app() {
  if pm2 describe "$APP_NAME" >/dev/null 2>&1; then
    pm2 restart "$APP_NAME" --update-env
  else
    pm2 start "$APP_DIR/ecosystem.config.js"
  fi
  pm2 save
}

verify_health() {
  local i
  for i in $(seq 1 20); do
    if curl -fsS -m 3 "$HEALTH_URL" >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  return 1
}

rollback_dist() {
  warn "rolling back to the previous dist/"
  if [ -d "$APP_DIR/dist.prev" ]; then
    rm -rf "$APP_DIR/dist.broken"
    [ -d "$APP_DIR/dist" ] && mv "$APP_DIR/dist" "$APP_DIR/dist.broken"
    mv "$APP_DIR/dist.prev" "$APP_DIR/dist"
    restart_app || true
  fi
  warn "rolled back. Diagnose with: pm2 logs $APP_NAME --lines 60"
}

# ── 1. Update ───────────────────────────────────────────────────────────────
if [ -d "$APP_DIR/.git" ]; then
  BEFORE="$(git rev-parse --short HEAD)"
  git fetch --all --prune
  git pull --ff-only
  AFTER="$(git rev-parse --short HEAD)"
  if [ "$BEFORE" = "$AFTER" ]; then log "code unchanged ($AFTER)"; else log "code $BEFORE -> $AFTER"; fi
else
  warn "NOT A GIT CHECKOUT — code must be copied by hand."
  warn "That is exactly how prisma/migrations ended up 17 folders short on this box."
  warn "Set up a private GitHub repo + 'git clone' here so ./deploy.sh can pull."
fi

# ── 2. Install ──────────────────────────────────────────────────────────────
if [ -n "$SKIP_INSTALL" ]; then
  log "SKIP_INSTALL=1 — skipping npm ci"
else
  log "npm ci (this deletes and reinstalls node_modules — ~1-3 min)"
  npm ci
fi

# ── 3. Generate Prisma client ──────────────────────────────────────────────
log "prisma generate"
npx prisma generate

# ── 4. Build (park old dist for rollback) ──────────────────────────────────
log "build: tsc"
rm -rf "$APP_DIR/dist.prev"
if [ -d "$APP_DIR/dist" ]; then mv "$APP_DIR/dist" "$APP_DIR/dist.prev"; fi
if ! npm run build; then
  rollback_dist
  die "build failed"
fi
[ -f "$APP_DIR/dist/server.js" ] || { rollback_dist; die "build produced no dist/server.js"; }
log "build OK (previous dist kept at dist.prev)"

# ── 5. Admin page (belt: package.json postbuild already does this) ─────────
mkdir -p "$APP_DIR/dist/src/admin"
cp -f "$APP_DIR/src/admin/index.html" "$APP_DIR/dist/src/admin/index.html"
[ -f "$APP_DIR/dist/src/admin/index.html" ] || { rollback_dist; die "key-manager page missing from dist"; }

# ── 6. Migrate ──────────────────────────────────────────────────────────────
if [ -n "$SKIP_MIGRATE" ]; then
  log "SKIP_MIGRATE=1 — skipping prisma migrate deploy"
else
  log "prisma migrate deploy"
  if ! npx prisma migrate deploy; then
    warn "MIGRATION FAILED — old server is still running untouched."
    warn "The DB keeps whatever applied before the failure. Inspect with:"
    warn "  npx prisma migrate status"
    exit 1
  fi
fi

# ── 7. Restart ──────────────────────────────────────────────────────────────
log "restarting $APP_NAME"
restart_app

# ── 8. Verify ───────────────────────────────────────────────────────────────
log "waiting for $HEALTH_URL"
if ! verify_health; then
  warn "health check never passed"
  pm2 logs "$APP_NAME" --lines 40 --nostream || true
  rollback_dist
  die "deploy failed: unhealthy after restart (rolled back)"
fi
log "local health OK"

if curl -fsS -m 8 "$PUBLIC_URL/health" >/dev/null 2>&1; then
  log "public health OK ($PUBLIC_URL/health)"
else
  warn "public health check failed — nginx/Cloudflare/DNS issue? Try: curl -i $PUBLIC_URL/health"
fi

log "DONE"
log "  app:      $APP_NAME ($(pm2 pid "$APP_NAME") pid)"
log "  admin UI: $PUBLIC_URL/key-manager"
log "  backups:  scripts/vps-pg-backup.sh (cron 02:30) — check: tail -20 /var/log/mcs/pg-backup.log"
