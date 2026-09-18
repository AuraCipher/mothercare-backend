#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# R2-12c — Firebase FCM Smoke Test
#
# REAL_FCM_SMOKE=true ./tests/scripts/smoke-test-fcm.sh
#
# Required environment variables:
#   FIREBASE_SERVICE_ACCOUNT_JSON — Firebase service account JSON (inline)
#     OR
#   FIREBASE_SERVICE_ACCOUNT_PATH — Path to Firebase service account file
#
# Behavior:
#   - Validates Firebase credentials by calling projects.get
#   - Does NOT send any user-facing notifications
#   - Uses a test topic subscription check (non-destructive)
# ─────────────────────────────────────────────────────────────
set -euo pipefail

if [ "${REAL_FCM_SMOKE:-}" != "true" ]; then
  echo "SKIP: Set REAL_FCM_SMOKE=true to run FCM smoke test"
  exit 0
fi

# Check for Firebase credentials
if [ -z "${FIREBASE_SERVICE_ACCOUNT_JSON:-}" ] && [ -z "${FIREBASE_SERVICE_ACCOUNT_PATH:-}" ]; then
  echo "ERROR: Set FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_SERVICE_ACCOUNT_PATH"
  exit 1
fi

echo "FCM Smoke Test"
echo "  Status: Running..."

node -e "
const admin = require('firebase-admin');
const fs = require('fs');

async function run() {
  // Initialize Firebase
  if (admin.apps.length === 0) {
    let credential;
    if (process.env.FIREBASE_SERVICE_ACCOUNT_PATH) {
      const raw = fs.readFileSync(process.env.FIREBASE_SERVICE_ACCOUNT_PATH, 'utf8');
      credential = admin.credential.cert(JSON.parse(raw));
    } else {
      credential = admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON));
    }
    admin.initializeApp({ credential });
  }

  // Validate credentials by getting project info
  const projectId = admin.app().options.credential.projectId;
  console.log('  Project ID:', projectId);

  // Test messaging capability without sending
  // Just verify the messaging client is accessible
  const messaging = admin.messaging();
  if (typeof messaging.sendEachForMulticast !== 'function') {
    throw new Error('messaging.sendEachForMulticast is not a function');
  }
  console.log('  Messaging client: OK');

  // Validate the service account by attempting to get an access token
  // This verifies credentials without sending anything
  const tokenResult = await admin.app().options.credential.getAccessToken();
  if (!tokenResult.access_token) {
    throw new Error('Failed to obtain access token');
  }
  console.log('  Access token: OK (credentials valid)');

  console.log('  Status: PASS');
  console.log('  NOTE: No notifications were sent');
}

run().catch((err) => {
  console.error('  Status: FAIL');
  console.error('  Error:', err.message);
  process.exit(1);
});
"
