#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# R2-12c — Cloudflare R2 Smoke Test
#
# REAL_R2_SMOKE=true ./tests/scripts/smoke-test-r2.sh
#
# Required environment variables:
#   R2_ACCOUNT_ID       — Cloudflare account ID
#   R2_ACCESS_KEY_ID    — R2 access key ID
#   R2_SECRET_ACCESS_KEY — R2 secret access key
#   R2_DOCUMENTS_BUCKET — Target bucket (default: mcs-documents)
#
# Behavior:
#   - Uploads a uniquely-prefixed temporary object
#   - Retrieves and verifies content
#   - Deletes the object (cleanup)
#   - Never prints credentials or signed URLs
# ─────────────────────────────────────────────────────────────
set -euo pipefail

if [ "${REAL_R2_SMOKE:-}" != "true" ]; then
  echo "SKIP: Set REAL_R2_SMOKE=true to run R2 smoke test"
  exit 0
fi

# Validate required env vars
for var in R2_ACCOUNT_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY; do
  if [ -z "${!var:-}" ]; then
    echo "ERROR: $var is not set"
    exit 1
  fi
done

BUCKET="${R2_DOCUMENTS_BUCKET:-mcs-documents}"
PREFIX="smoke-test-$(date +%s)-$$"
TEST_KEY="${PREFIX}/test.txt"
TEST_CONTENT="R2 smoke test $(date -Iseconds) pid=$$"

echo "R2 Smoke Test"
echo "  Bucket: ${BUCKET}"
echo "  Key:    ${TEST_KEY}"
echo "  Status: Running..."

# Use Node.js to perform the smoke test (matches backend R2 adapter)
node -e "
const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');

async function run() {
  const client = new S3Client({
    region: 'auto',
    endpoint: 'https://' + process.env.R2_ACCOUNT_ID + '.r2.cloudflarestorage.com',
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
    requestHandler: { requestTimeout: 15000 },
  });

  const bucket = process.env.R2_DOCUMENTS_BUCKET || 'mcs-documents';
  const key = '${TEST_KEY}';
  const content = '${TEST_CONTENT}';

  // Upload
  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: content,
    ContentType: 'text/plain',
  }));
  console.log('  Upload: OK');

  // Download
  const result = await client.send(new GetObjectCommand({
    Bucket: bucket,
    Key: key,
  }));
  const body = await streamToString(result.Body);
  if (body !== content) {
    console.error('  Download: MISMATCH');
    process.exit(1);
  }
  console.log('  Download: OK (content verified)');

  // Cleanup
  await client.send(new DeleteObjectCommand({
    Bucket: bucket,
    Key: key,
  }));
  console.log('  Cleanup: OK');

  console.log('  Status: PASS');
}

function streamToString(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', (chunk) => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks).toString()));
    stream.on('error', reject);
  });
}

run().catch((err) => {
  console.error('  Status: FAIL');
  console.error('  Error:', err.message);
  process.exit(1);
});
"
