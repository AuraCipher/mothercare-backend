#!/usr/bin/env bash
# Preset load scenarios — requires API running on BASE_URL (default http://127.0.0.1:5000)
set -euo pipefail

BASE_URL="${LOAD_TEST_URL:-http://127.0.0.1:5000}"
CONCURRENCY="${LOAD_TEST_CONCURRENCY:-30}"
DURATION="${LOAD_TEST_DURATION:-20}"
# Login credentials — defaults match `prisma db seed` (prisma/seed.ts: admin / admin123).
# Demo DB (`npm run seed:demo`): demo_admin / DemoAdmin@123
LOAD_TEST_IDENTIFIER="${LOAD_TEST_IDENTIFIER:-admin}"
LOAD_TEST_PASSWORD="${LOAD_TEST_PASSWORD:-admin123}"
LOGIN_BODY=$(printf '{"identifier":"%s","password":"%s"}' "$LOAD_TEST_IDENTIFIER" "$LOAD_TEST_PASSWORD")

run() {
  local label="$1"
  shift
  echo ""
  echo "========== $label =========="
  npx ts-node scripts/load-test.ts "$@"
}

echo "MCS load test suite → $BASE_URL"
echo "Concurrency: $CONCURRENCY, duration: ${DURATION}s per scenario"

run "Health (baseline)" \
  --url "$BASE_URL" --path /health \
  --concurrency "$CONCURRENCY" --duration "$DURATION"

echo ""
echo "Auth login credentials: $LOAD_TEST_IDENTIFIER (override with LOAD_TEST_IDENTIFIER / LOAD_TEST_PASSWORD)"
preflight_code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/auth/login" \
  -H "Content-Type: application/json" \
  -d "$LOGIN_BODY" || echo "000")
if [ "$preflight_code" != "200" ]; then
  echo "ERROR: Login preflight returned HTTP $preflight_code — credentials do not match the database."
  echo "  Main seed (prisma db seed):      admin / admin123"
  echo "  Demo seed (npm run seed:demo):   demo_admin / DemoAdmin@123"
  echo "  Teacher (demo):                  demo_teacher_playgroup / DemoTeacher@123"
  echo "  Export LOAD_TEST_IDENTIFIER and LOAD_TEST_PASSWORD, then re-run."
  exit 1
fi
echo "Login preflight OK (HTTP 200)"

run "Auth login" \
  --url "$BASE_URL" --path /auth/login --method POST \
  --body "$LOGIN_BODY" \
  --concurrency 10 --duration "$DURATION"

echo ""
echo "Done. Increase LOAD_TEST_CONCURRENCY or LOAD_TEST_DURATION to stress further."
