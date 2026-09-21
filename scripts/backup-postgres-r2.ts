/**
 * M16 — Production PostgreSQL backup → Cloudflare R2.
 *
 * Format: pg_dump -Fc (PostgreSQL custom format, built-in compression).
 * Upload: @aws-sdk/lib-storage Upload (streaming, 5 MB parts, bounded memory).
 * Integrity: SHA-256 + HeadObject size verification.
 * Naming: db_backup/database-YYYY-MM-DD_HH-mm-ss.dump (UTC, never overwrites).
 * Retention: configurable via DB_BACKUP_RETENTION_DAYS (default 30).
 *
 * Usage:
 *   npm run db:backup
 *
 * Required env:
 *   DATABASE_URL, R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY
 *
 * Optional env:
 *   R2_BACKUPS_BUCKET (default: mcs-backups)
 *   DB_BACKUP_RETENTION_DAYS (default: 30)
 *   DB_BACKUP_PREFIX (default: db_backup)
 */
import { spawn } from 'child_process';
import { createHash } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import { execSync } from 'child_process';

// ─── Configuration ──────────────────────────────────────────────

const REQUIRED_ENV = ['DATABASE_URL', 'R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'] as const;
const RETENTION_DAYS = Number(process.env.DB_BACKUP_RETENTION_DAYS) || 30;
const BACKUP_PREFIX = process.env.DB_BACKUP_PREFIX || 'db_backup';
const BACKUP_BUCKET = process.env.R2_BACKUPS_BUCKET || 'mcs-backups';
const MIN_DISK_BYTES = 100 * 1024 * 1024; // 100 MB safety floor
let tmpFile: string | null = null; // track for cleanup on exit

// ─── Helpers ────────────────────────────────────────────────────

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
}

function utcStamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
}

function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

function availableDisk(dir: string): number {
  try {
    const stats = fs.statfsSync(dir);
    return stats.bsize * stats.bavail;
  } catch {
    return Infinity; // statfs unavailable — proceed and let OS fail
  }
}

function getPostgresVersion(databaseUrl: string): string {
  try {
    // Extract host/port/db from DATABASE_URL for a quick version query
    const url = new URL(databaseUrl);
    const cmd = `psql "${databaseUrl}" -t -A -c "SELECT version();" 2>/dev/null | head -1`;
    return execSync(cmd, { encoding: 'utf-8', timeout: 10_000 }).trim() || 'unknown';
  } catch {
    return 'unknown';
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

// ─── Core functions ─────────────────────────────────────────────

function runPgDump(databaseUrl: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const stderrChunks: Buffer[] = [];
    const dump = spawn('pg_dump', ['-Fc', '-f', outputPath, databaseUrl], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    dump.stderr.on('data', (chunk) => stderrChunks.push(chunk));
    dump.on('error', reject);
    dump.on('close', (code) => {
      if (code !== 0) {
        const stderr = Buffer.concat(stderrChunks).toString('utf-8').trim();
        reject(new Error(`pg_dump exited with code ${code}: ${stderr}`));
      } else {
        resolve();
      }
    });
  });
}

function createR2Client(): S3Client {
  const accountId = env('R2_ACCOUNT_ID');
  return new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: env('R2_ACCESS_KEY_ID'),
      secretAccessKey: env('R2_SECRET_ACCESS_KEY'),
    },
    requestHandler: new NodeHttpHandler({ requestTimeout: 120_000 }),
  });
}

async function headObject(client: S3Client, bucket: string, key: string): Promise<{ size: number } | null> {
  try {
    const res = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return { size: res.ContentLength ?? 0 };
  } catch (err: any) {
    if (err?.$metadata?.httpStatusCode === 404 || err?.name === 'NotFound') return null;
    throw err;
  }
}

async function pruneOldBackups(client: S3Client, bucket: string, prefix: string): Promise<number> {
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  let deleted = 0;
  let continuationToken: string | undefined;

  do {
    const list = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: `${prefix}/`,
        ContinuationToken: continuationToken,
      }),
    );
    for (const item of list.Contents || []) {
      if (!item.Key || !item.LastModified) continue;
      if (item.LastModified.getTime() < cutoff) {
        await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: item.Key }));
        console.log(JSON.stringify({ event: 'retention:delete', key: item.Key, lastModified: item.LastModified.toISOString() }));
        deleted++;
      }
    }
    continuationToken = list.IsTruncated ? list.NextContinuationToken : undefined;
  } while (continuationToken);

  return deleted;
}

// ─── Main ───────────────────────────────────────────────────────

async function run(): Promise<void> {
  const startedAt = Date.now();
  const tmpDir = os.tmpdir();

  // 1. Validate configuration
  for (const key of REQUIRED_ENV) env(key);
  const databaseUrl = env('DATABASE_URL');
  const bucket = BACKUP_BUCKET;
  const stamp = utcStamp();
  const key = `${BACKUP_PREFIX}/database-${stamp}.dump`;

  const pgVersion = getPostgresVersion(databaseUrl);
  console.log(JSON.stringify({ event: 'backup:start', key, bucket, pgVersion }));

  // 2. Disk space check
  const availBefore = availableDisk(tmpDir);
  if (availBefore < MIN_DISK_BYTES) {
    throw new Error(`Insufficient disk space: ${formatBytes(availBefore)} available, ${formatBytes(MIN_DISK_BYTES)} required`);
  }
  console.log(JSON.stringify({ event: 'disk:check', availableBytes: availBefore, availableHuman: formatBytes(availBefore) }));

  // 3. Create pg_dump (streaming to temp file — no heap buffering)
  tmpFile = path.join(tmpDir, `m16-backup-${stamp}.dump`);
  console.log(JSON.stringify({ event: 'pg_dump:start' }));
  await runPgDump(databaseUrl, tmpFile);
  const dumpDurationMs = Date.now() - startedAt;

  // 4. Verify dump exists and is non-empty
  const stat = fs.statSync(tmpFile);
  if (stat.size === 0) {
    throw new Error('pg_dump produced an empty file');
  }
  console.log(JSON.stringify({ event: 'pg_dump:done', sizeBytes: stat.size, sizeHuman: formatBytes(stat.size), durationMs: dumpDurationMs }));

  // 5. Calculate SHA-256
  const checksum = await sha256File(tmpFile);
  console.log(JSON.stringify({ event: 'checksum:done', sha256: checksum }));

  // 6. Upload to R2 via streaming multipart (5 MB parts, bounded memory)
  const client = createR2Client();
  const fileStream = fs.createReadStream(tmpFile);
  const upload = new Upload({
    client,
    params: {
      Bucket: bucket,
      Key: key,
      Body: fileStream,
      ContentType: 'application/octet-stream',
      ContentLength: stat.size,
      Metadata: {
        'sha256': checksum,
        'pg-version': pgVersion,
        'backup-format': 'pg_dump-fc',
        'backup-stamp': stamp,
      },
    },
    partSize: 5 * 1024 * 1024,
    queueSize: 4,
  });

  const uploadStartedAt = Date.now();
  await upload.done();
  const uploadDurationMs = Date.now() - uploadStartedAt;
  console.log(JSON.stringify({ event: 'upload:done', durationMs: uploadDurationMs }));

  // 7. HeadObject verification
  const head = await headObject(client, bucket, key);
  if (!head) {
    throw new Error(`HeadObject failed: object not found after upload (${key})`);
  }
  if (head.size !== stat.size) {
    throw new Error(`HeadObject size mismatch: local=${stat.size} remote=${head.size}`);
  }
  console.log(JSON.stringify({ event: 'verify:head_ok', remoteSize: head.size }));

  // 8. Retention pruning (non-fatal if it fails)
  try {
    const deleted = await pruneOldBackups(client, bucket, BACKUP_PREFIX);
    console.log(JSON.stringify({ event: 'retention:done', deleted, retentionDays: RETENTION_DAYS }));
  } catch (err: any) {
    console.error(JSON.stringify({ event: 'retention:error', message: err.message }));
  }

  // 9. Success summary
  const totalDurationMs = Date.now() - startedAt;
  const rssBytes = process.memoryUsage().rss;
  console.log(JSON.stringify({
    event: 'backup:ok',
    key,
    bucket,
    sizeBytes: stat.size,
    sizeHuman: formatBytes(stat.size),
    sha256: checksum,
    pgVersion,
    format: 'pg_dump -Fc',
    dumpDurationMs,
    uploadDurationMs,
    totalDurationMs,
    rssBytes,
    rssHuman: formatBytes(rssBytes),
  }));
}

// ─── Entry ──────────────────────────────────────────────────────

function cleanupTempFiles(): void {
  if (!tmpFile) return;
  try { fs.unlinkSync(tmpFile); } catch {}
}

process.on('exit', cleanupTempFiles);
process.on('SIGINT', () => { cleanupTempFiles(); process.exit(130); });
process.on('SIGTERM', () => { cleanupTempFiles(); process.exit(143); });

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(JSON.stringify({ event: 'backup:failed', message: err.message, stack: err.stack }));
    process.exit(1);
  });
