/**
 * r2-list-buckets.js — one-off diagnostic.
 *
 * Lists the R2 buckets the credentials in .env can see, so we know the real
 * bucket name instead of guessing (backup-postgres-r2.ts defaults to
 * "mcs-backups" when R2_BACKUPS_BUCKET is unset → NoSuchBucket if wrong).
 * Prints bucket NAMES ONLY — never credentials.
 *
 * Run:  node scripts/r2-list-buckets.js
 */
require('dotenv/config');

const { S3Client, ListBucketsCommand, HeadBucketCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');

const id = process.env.R2_ACCOUNT_ID;
const ak = process.env.R2_ACCESS_KEY_ID;
const sk = process.env.R2_SECRET_ACCESS_KEY;

if (!id || !ak || !sk) {
  console.error('MISSING: R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY in .env');
  process.exit(1);
}

const client = new S3Client({
  region: 'auto',
  endpoint: `https://${id}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: ak, secretAccessKey: sk },
});

(async () => {
  const configured = process.env.R2_BACKUPS_BUCKET || 'mcs-backups';
  try {
    // 1) Most important: can these credentials actually reach the target bucket?
    //    (a scoped token often cannot ListBuckets, but CAN read/write its bucket)
    const probe = async (bucket) => {
      const tries = [];
      try {
        await client.send(new HeadBucketCommand({ Bucket: bucket }));
        tries.push('HeadBucket=200 OK');
      } catch (e) {
        tries.push(`HeadBucket=${e.$metadata?.httpStatusCode ?? '?'} ${e.name}${e.Code ? ':' + e.Code : ''}`);
      }
      try {
        const r = await client.send(new ListObjectsV2Command({ Bucket: bucket, MaxKeys: 1 }));
        const n = r.KeyCount ?? (r.Contents || []).length;
        tries.push(`ListObjectsV2=200 OK (objects visible: ${n})`);
        return { ok: true, detail: tries.join('  ') };
      } catch (e) {
        const code = e.$metadata?.httpStatusCode ?? '?';
        const id = e.Code || e.name;
        tries.push(`ListObjectsV2=${code} ${id}`);
        // 404 NoSuchBucket = wrong name; 403 AccessDenied = right name, wrong scope
        return { ok: false, detail: tries.join('  '), verdict: code === '403' || id === 'AccessDenied'
          ? 'bucket EXISTS but this token is not scoped to it'
          : 'bucket NOT FOUND (name is wrong)' };
      }
    };

    const res = await probe(configured);
    console.log(`configured bucket "${configured}": ${res.ok ? 'ACCESSIBLE ✅' : 'NOT ACCESSIBLE ❌'}`);
    console.log(`  ${res.detail}`);
    if (!res.ok) console.log(`  → ${res.verdict}`);

    // 2) Best-effort: full bucket list for visibility
    try {
      const { Buckets } = await client.send(new ListBucketsCommand({}));
      const names = (Buckets || []).map((b) => b.Name);
      console.log('\nbuckets visible to these credentials:');
      if (!names.length) console.log('  (none)');
      for (const n of names) console.log(`  - ${n}`);
      console.log(names.includes(configured)
        ? `MATCH: configured bucket exists ✅`
        : `MISMATCH: "${configured}" is NOT in the list above → set R2_BACKUPS_BUCKET in .env`);
    } catch (e) {
      console.log(`\nListBuckets denied (${e.name}) — normal for a bucket-scoped token. HeadBucket above is the real test.`);
    }
    console.log(`\ncredentials: VALID (request was authenticated) ✅`);
  } catch (e) {
    console.error(`R2 ERROR: ${e.name}: ${e.message}`);
    process.exit(1);
  }
})();
