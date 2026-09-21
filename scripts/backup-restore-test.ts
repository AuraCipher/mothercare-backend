/**
 * M16 — Restore test: download backup → restore into clean PG → verify.
 *
 * Usage:
 *   npm run db:backup:restore-test -- --source local:<path>
 *   npm run db:backup:restore-test -- --source r2:<key>
 *
 * Required env (for R2 source):
 *   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BACKUPS_BUCKET
 *
 * Required env (for restore target):
 *   RESTORE_DATABASE_URL  (e.g. postgresql://mcs:test@localhost:5435/mcs_restore_test)
 *
 * Optional:
 *   EXPECTED_SHA256  — if set, download checksum is verified against this
 */
import { spawn, execSync } from 'child_process';
import { createHash } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  GetObjectCommand,
  HeadObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import { Readable } from 'stream';

// ─── CLI args ───────────────────────────────────────────────────

function parseArgs(): { sourceType: 'local' | 'r2'; sourcePath: string } {
  const args = process.argv.slice(2);
  const sourceArg = args.find((a) => a.startsWith('--source='));
  if (!sourceArg) {
    console.error('Usage: --source=local:<path> or --source=r2:<key>');
    process.exit(1);
  }
  const value = sourceArg.split('=')[1];
  if (value.startsWith('local:')) {
    return { sourceType: 'local', sourcePath: value.slice(6) };
  }
  if (value.startsWith('r2:')) {
    return { sourceType: 'r2', sourcePath: value.slice(3) };
  }
  console.error(`Unknown source format: ${value}. Use local:<path> or r2:<key>`);
  process.exit(1);
  return { sourceType: 'local', sourcePath: '' }; // unreachable
}

// ─── Helpers ────────────────────────────────────────────────────

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
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

function runPgRestore(databaseUrl: string, dumpPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const stderrChunks: Buffer[] = [];
    const restore = spawn('pg_restore', ['-Fc', '--clean', '--if-exists', '--no-owner', '--no-privileges', '-d', databaseUrl, dumpPath], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    restore.stderr.on('data', (chunk) => stderrChunks.push(chunk));
    restore.on('error', reject);
    restore.on('close', (code) => {
      if (code !== 0) {
        const stderr = Buffer.concat(stderrChunks).toString('utf-8').trim();
        reject(new Error(`pg_restore exited with code ${code}: ${stderr}`));
      } else {
        resolve();
      }
    });
  });
}

function psql(databaseUrl: string, query: string): string {
  return execSync(`psql "${databaseUrl}" -t -A -c '${query.replace(/'/g, "'\\''")}' 2>/dev/null`, {
    encoding: 'utf-8',
    timeout: 30_000,
  }).trim();
}

// ─── R2 download ────────────────────────────────────────────────

async function downloadFromR2(key: string, destPath: string): Promise<void> {
  const client = new S3Client({
    region: 'auto',
    endpoint: `https://${env('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: env('R2_ACCESS_KEY_ID'),
      secretAccessKey: env('R2_SECRET_ACCESS_KEY'),
    },
    requestHandler: new NodeHttpHandler({ requestTimeout: 300_000 }),
  });
  const res = await client.send(new GetObjectCommand({ Bucket: env('R2_BACKUPS_BUCKET') || 'mcs-backups', Key: key }));
  const body = res.Body;
  if (!body) throw new Error('R2 GetObject returned empty body');

  const stream = body instanceof Readable ? body : Readable.from(body as any);
  const ws = fs.createWriteStream(destPath);
  await new Promise<void>((resolve, reject) => {
    stream.pipe(ws);
    ws.on('finish', resolve);
    ws.on('error', reject);
    stream.on('error', reject);
  });
}

// ─── Verification queries ───────────────────────────────────────

interface TableCheck {
  name: string;
  query: string;
}

const TABLE_CHECKS: TableCheck[] = [
  { name: 'users', query: 'SELECT count(*) FROM "users"' },
  { name: 'branches', query: 'SELECT count(*) FROM "branches"' },
  { name: 'students', query: 'SELECT count(*) FROM "students"' },
  { name: 'chat_messages', query: 'SELECT count(*) FROM "chat_messages"' },
  { name: 'payments', query: 'SELECT count(*) FROM "payments"' },
  { name: 'family_payments', query: 'SELECT count(*) FROM "family_payments"' },
  { name: 'file_records', query: 'SELECT count(*) FROM "file_records"' },
  { name: 'upload_sessions', query: 'SELECT count(*) FROM "upload_sessions"' },
  { name: 'student_fees', query: 'SELECT count(*) FROM "student_fees"' },
  { name: 'chat_rooms', query: 'SELECT count(*) FROM "chat_rooms"' },
  { name: 'academic_years', query: 'SELECT count(*) FROM "academic_years"' },
  { name: 'groups', query: 'SELECT count(*) FROM "groups"' },
  { name: 'subjects', query: 'SELECT count(*) FROM "subjects"' },
  { name: 'teacher_assignments', query: 'SELECT count(*) FROM "teacher_assignments"' },
  { name: 'branch_members', query: 'SELECT count(*) FROM "branch_members"' },
  { name: 'fee_structures', query: 'SELECT count(*) FROM "fee_structures"' },
  { name: 'attendance', query: 'SELECT count(*) FROM "attendances"' },
  { name: 'audit_logs', query: 'SELECT count(*) FROM "audit_logs"' },
];

const INDEX_CHECK_QUERIES = [
  'SELECT count(*) FROM pg_indexes WHERE schemaname = \'public\'',
  'SELECT count(*) FROM information_schema.table_constraints WHERE constraint_type = \'PRIMARY KEY\'',
];

const SEQUENCE_CHECK_QUERIES = [
  'SELECT count(*) FROM information_schema.sequences WHERE sequence_schema = \'public\'',
];

let tmpFile: string | null = null; // track for cleanup on exit

// ─── Main ───────────────────────────────────────────────────────

async function run(): Promise<void> {
  const startedAt = Date.now();
  const { sourceType, sourcePath } = parseArgs();
  const databaseUrl = env('RESTORE_DATABASE_URL');
  const expectedSha = process.env.EXPECTED_SHA256 || '';

  let dumpPath = sourcePath;

  // 1. Get the dump file
  if (sourceType === 'r2') {
    tmpFile = path.join(os.tmpdir(), `m16-restore-${Date.now()}.dump`);
    console.log(JSON.stringify({ event: 'r2:download', key: sourcePath }));
    await downloadFromR2(sourcePath, tmpFile);
    dumpPath = tmpFile;
  }

  // 2. Verify file exists and is non-empty
  const stat = fs.statSync(dumpPath);
  if (stat.size === 0) throw new Error(`Dump file is empty: ${dumpPath}`);
  console.log(JSON.stringify({ event: 'dump:loaded', path: dumpPath, sizeBytes: stat.size }));

  // 3. SHA-256 verification
  const checksum = await sha256File(dumpPath);
  console.log(JSON.stringify({ event: 'checksum:done', sha256: checksum }));
  if (expectedSha && checksum !== expectedSha) {
    throw new Error(`SHA-256 mismatch: expected=${expectedSha} actual=${checksum}`);
  }

  // 4. pg_restore into the clean target database
  console.log(JSON.stringify({ event: 'pg_restore:start', target: 'RESTORE_DATABASE_URL' }));
  const restoreStartedAt = Date.now();
  await runPgRestore(databaseUrl, dumpPath);
  const restoreDurationMs = Date.now() - restoreStartedAt;
  console.log(JSON.stringify({ event: 'pg_restore:done', durationMs: restoreDurationMs }));

  // 5. Verify table row counts
  let allPassed = true;
  const results: Array<{ table: string; count: string; ok: boolean }> = [];

  for (const check of TABLE_CHECKS) {
    try {
      const count = psql(databaseUrl, check.query);
      results.push({ table: check.name, count, ok: true });
    } catch (err: any) {
      results.push({ table: check.name, count: `ERROR: ${err.message}`, ok: false });
      allPassed = false;
    }
  }

  // 6. Verify indexes, constraints, sequences
  const indexCount = psql(databaseUrl, INDEX_CHECK_QUERIES[0]);
  const pkCount = psql(databaseUrl, INDEX_CHECK_QUERIES[1]);
  const seqCount = psql(databaseUrl, SEQUENCE_CHECK_QUERIES[0]);
  console.log(JSON.stringify({ event: 'verify:indexes', indexCount, primaryKeyCount: pkCount, sequenceCount: seqCount }));

  // 7. Verify representative queries work
  const representativeQueries = [
    { name: 'active_users', query: 'SELECT count(*) FROM "users" WHERE status = \'active\'' },
    { name: 'active_students', query: 'SELECT count(*) FROM "students" WHERE "isActive" = true' },
    { name: 'chat_rooms_with_messages', query: 'SELECT count(DISTINCT cr.id) FROM "chat_rooms" cr JOIN "chat_messages" cm ON cm."roomId" = cr.id' },
    { name: 'payments_with_allocations', query: 'SELECT count(DISTINCT p.id) FROM "payments" p JOIN "payment_head_allocations" a ON a."paymentId" = p.id' },
  ];
  const repResults: Array<{ name: string; count: string; ok: boolean }> = [];
  for (const q of representativeQueries) {
    try {
      const count = psql(databaseUrl, q.query);
      repResults.push({ name: q.name, count, ok: true });
    } catch (err: any) {
      repResults.push({ name: q.name, count: `ERROR: ${err.message}`, ok: false });
      allPassed = false;
    }
  }

  // 8. Print results
  console.log('\n=== Table Row Counts ===');
  for (const r of results) {
    const mark = r.ok ? '✓' : '✗';
    console.log(`  ${mark} ${r.table}: ${r.count}`);
  }
  console.log('\n=== Representative Queries ===');
  for (const r of repResults) {
    const mark = r.ok ? '✓' : '✗';
    console.log(`  ${mark} ${r.name}: ${r.count}`);
  }

  const totalDurationMs = Date.now() - startedAt;
  console.log(JSON.stringify({
    event: 'restore-test:done',
    totalDurationMs,
    restoreDurationMs,
    dumpSizeBytes: stat.size,
    sha256: checksum,
    tableChecks: TABLE_CHECKS.length,
    allPassed,
  }));

  if (!allPassed) {
    throw new Error('One or more verification checks failed');
  }
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
    console.error(JSON.stringify({ event: 'restore-test:failed', message: err.message }));
    process.exit(1);
  });
