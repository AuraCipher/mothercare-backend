#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# R2-12c — Twilio WhatsApp Smoke Test
#
# REAL_TWILIO_SMOKE=true ./tests/scripts/smoke-test-twilio.sh
#
# Required environment variables:
#   TWILIO_ACCOUNT_SID  — Twilio Account SID
#   TWILIO_AUTH_TOKEN   — Twilio Auth Token
#
# Behavior:
#   - Validates credentials by fetching account info (read-only)
#   - Does NOT send any SMS or WhatsApp messages
#   - Uses the Twilio REST API accounts endpoint (non-destructive)
# ─────────────────────────────────────────────────────────────
set -euo pipefail

if [ "${REAL_TWILIO_SMOKE:-}" != "true" ]; then
  echo "SKIP: Set REAL_TWILIO_SMOKE=true to run Twilio smoke test"
  exit 0
fi

# Validate required env vars
for var in TWILIO_ACCOUNT_SID TWILIO_AUTH_TOKEN; do
  if [ -z "${!var:-}" ]; then
    echo "ERROR: $var is not set"
    exit 1
  fi
done

echo "Twilio Smoke Test"
echo "  Status: Running..."

node -e "
async function run() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;

  // Validate credentials by fetching account info (read-only)
  const auth = Buffer.from(accountSid + ':' + authToken).toString('base64');
  const response = await fetch(
    'https://api.twilio.com/2010-04-01/Accounts/' + accountSid + '.json',
    {
      headers: {
        'Authorization': 'Basic ' + auth,
      },
    }
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error('Credential validation failed: ' + response.status);
  }

  const data = await response.json();
  console.log('  Account SID:', data.sid);
  console.log('  Account name:', data.friendly_name);
  console.log('  Status:', data.status);
  console.log('  Credentials: OK (validated)');

  if (data.status !== 'active') {
    console.log('  WARNING: Account is not active');
  }

  console.log('  Status: PASS');
  console.log('  NOTE: No messages were sent');
}

run().catch((err) => {
  console.error('  Status: FAIL');
  console.error('  Error:', err.message);
  process.exit(1);
});
"
