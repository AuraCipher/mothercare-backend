/**
 * Nightly PostgreSQL backup → Cloudflare R2 (mcs-backups bucket).
 *
 * Usage:
 *   npm run backup:postgres
 *
 * Cron (02:30 daily):
 *   30 2 * * * cd /path/to/backend && npm run backup:postgres >> /var/log/mcs-pg-backup.log 2>&1
 */
import { spawn } from 'child_process';
import { createGzip } from 'zlib';
import {
  DeleteObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const RETENTION_DAYS = 30;

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env: ${name}`);
  return value;
}

function createR2Client(): S3Client {
  const accountId = required('R2_ACCOUNT_ID');
  return new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: required('R2_ACCESS_KEY_ID'),
      secretAccessKey: required('R2_SECRET_ACCESS_KEY'),
    },
  });
}

async function createDumpGzip(databaseUrl: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const dump = spawn('pg_dump', [databaseUrl], { stdio: ['ignore', 'pipe', 'inherit'] });
    const gzip = createGzip();

    dump.stdout.pipe(gzip);
    gzip.on('data', (chunk) => chunks.push(chunk));
    gzip.on('end', () => resolve(Buffer.concat(chunks)));
    gzip.on('error', reject);
    dump.on('error', reject);
    dump.on('close', (code) => {
      if (code !== 0) reject(new Error(`pg_dump exited with code ${code}`));
    });
  });
}

async function pruneOldBackups(client: S3Client, bucket: string): Promise<void> {
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  let continuationToken: string | undefined;

  do {
    const list = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: 'postgres/',
        ContinuationToken: continuationToken,
      }),
    );

    for (const item of list.Contents || []) {
      if (!item.Key || !item.LastModified) continue;
      if (item.LastModified.getTime() < cutoff) {
        await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: item.Key }));
        console.log(`Deleted old backup: ${item.Key}`);
      }
    }

    continuationToken = list.IsTruncated ? list.NextContinuationToken : undefined;
  } while (continuationToken);
}

async function run(): Promise<void> {
  const databaseUrl = required('DATABASE_URL');
  const bucket = process.env.R2_BACKUPS_BUCKET || 'mcs-backups';
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const key = `postgres/${stamp}.sql.gz`;

  console.log('Creating pg_dump...');
  const body = await createDumpGzip(databaseUrl);

  const client = createR2Client();
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: 'application/gzip',
      ContentLength: body.length,
    }),
  );

  console.log(`Backup uploaded: ${bucket}/${key} (${body.length} bytes)`);
  await pruneOldBackups(client, bucket);
}

run().catch((err) => {
  console.error('Backup failed:', err);
  process.exit(1);
});
