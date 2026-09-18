#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# R2-12c — Resend Email Smoke Test
#
# REAL_RESEND_SMOKE=true ./tests/scripts/smoke-test-resend.sh
#
# Required environment variables:
#   RESEND_API_KEY    — Resend API key
#   RESEND_FROM_EMAIL — Verified sender email
#
# Behavior:
#   - Validates API key by calling Resend API (checks domain verification)
#   - Does NOT send any real emails
#   - Uses the domains endpoint (read-only, non-destructive)
# ─────────────────────────────────────────────────────────────
set -euo pipefail

if [ "${REAL_RESEND_SMOKE:-}" != "true" ]; then
  echo "SKIP: Set REAL_RESEND_SMOKE=true to run Resend smoke test"
  exit 0
fi

# Validate required env vars
for var in RESEND_API_KEY RESEND_FROM_EMAIL; do
  if [ -z "${!var:-}" ]; then
    echo "ERROR: $var is not set"
    exit 1
  fi
done

echo "Resend Smoke Test"
echo "  Status: Running..."

node -e "
async function run() {
  const apiKey = process.env.RESEND_API_KEY;

  // Validate API key by listing domains (read-only endpoint)
  const response = await fetch('https://api.resend.com/domains', {
    headers: {
      'Authorization': 'Bearer ' + apiKey,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error('API key validation failed: ' + response.status + ' ' + body);
  }

  const data = await response.json();
  console.log('  API key: OK (validated)');
  console.log('  Domains:', data.data?.length || 0, 'found');

  // Check if the from email domain is verified
  const fromDomain = process.env.RESEND_FROM_EMAIL.split('@')[1];
  const verifiedDomains = (data.data || [])
    .filter(d => d.status === 'verified')
    .map(d => d.name);
  console.log('  Verified domains:', verifiedDomains.join(', ') || '(none)');

  if (verifiedDomains.includes(fromDomain)) {
    console.log('  From domain (' + fromDomain + '): VERIFIED');
  } else {
    console.log('  From domain (' + fromDomain + '): NOT VERIFIED (email sending may fail)');
  }

  console.log('  Status: PASS');
  console.log('  NOTE: No emails were sent');
}

run().catch((err) => {
  console.error('  Status: FAIL');
  console.error('  Error:', err.message);
  process.exit(1);
});
"
