/**
 * r2-list-objects.js — independent confirmation that backups really landed in
 * the bucket (the backup script's own verify:head_ok only proves ONE object;
 * this shows the whole prefix, unfiltered by the code that wrote it).
 *
 * Run:  node scripts/r2-list-objects.js [prefix]
 */
require('dotenv/config');
const { S3Client, ListObjectsV2Command } = require('@aws-sdk/client-s3');

const bucket = process.env.R2_BACKUPS_BUCKET || 'mcs-backups';
const prefix = process.argv[2] || 'db_backup/';

const client = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

(async () => {
  try {
    let token, items = [];
    do {
      const r = await client.send(new ListObjectsV2Command({
        Bucket: bucket, Prefix: prefix, ContinuationToken: token,
      }));
      items = items.concat(r.Contents || []);
      token = r.NextContinuationToken;
    } while (token);

    console.log(`bucket: ${bucket}   prefix: ${prefix}   objects: ${items.length}`);
    if (!items.length) { console.log('  (empty)'); return; }
    let total = 0;
    for (const o of items.sort((a, b) => new Date(b.LastModified) - new Date(a.LastModified))) {
      total += o.Size;
      console.log(`  ${o.Key.padEnd(46)} ${String(o.Size).padStart(9)} B   ${new Date(o.LastModified).toISOString()}`);
    }
    console.log(`  total: ${total} B (${(total / 1048576).toFixed(1)} MB)`);
  } catch (e) {
    console.error(`LIST FAILED: ${e.name} ${e.Code || ''} ${e.message}`);
    process.exit(1);
  }
})();
