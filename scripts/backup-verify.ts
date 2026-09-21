/**
 * M16 — Source vs Restored DB comparison.
 *
 * Usage:
 *   npm run db:backup:verify
 *
 * Required env:
 *   DATABASE_URL              — source (production/test) database
 *   RESTORE_DATABASE_URL      — restored (clean) database
 *
 * Compares: table existence, row counts, representative aggregates.
 * Exits non-zero if any check fails.
 */
import { execSync } from 'child_process';

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
}

function psql(databaseUrl: string, query: string): string {
  try {
    return execSync(`psql "${databaseUrl}" -t -A -c '${query.replace(/'/g, "'\\''")}' 2>/dev/null`, {
      encoding: 'utf-8',
      timeout: 30_000,
    }).trim();
  } catch {
    return '-1'; // table or query doesn't exist
  }
}

function psqlTableExists(databaseUrl: string, table: string): boolean {
  const result = psql(databaseUrl, `SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = '${table}'`);
  return result === '1';
}

interface CheckResult {
  name: string;
  source: string;
  restored: string;
  match: boolean;
}

function main(): void {
  const sourceUrl = env('DATABASE_URL');
  const restoredUrl = env('RESTORE_DATABASE_URL');
  const results: CheckResult[] = [];
  let allPassed = true;

  // ─── 1. Table existence ─────────────────────────────────────
  const expectedTables = [
    'users', 'branches', 'students', 'chat_messages', 'payments',
    'family_payments', 'file_records', 'upload_sessions', 'student_fees',
    'chat_rooms', 'academic_years', 'groups', 'subjects', 'teacher_assignments',
    'branch_members', 'fee_structures', 'attendances', 'audit_logs',
    'payment_head_allocations', 'fee_heads', 'student_parents', 'enrollments',
    'announcements', 'device_tokens', 'user_push_crypto_keys',
    'family_payment_receipts', 'payment_receipts', 'batch_promotion_runs',
    'timetable_entries', 'exam_sessions', 'marks_entries', 'subject_results',
    'report_cards', 'notification_recipients', 'payment_notifications',
    'attendance_notifications', 'chat_message_read_states', 'chat_message_attachments',
    'upload_session_parts', 'canteen_sales', 'canteen_products',
    'branch_outgoing_payments', 'payroll_bulk_runs', 'payment_operations',
  ];

  console.log('\n=== 1. Table Existence ===');
  for (const table of expectedTables) {
    const sourceExists = psqlTableExists(sourceUrl, table);
    const restoredExists = psqlTableExists(restoredUrl, table);
    const match = sourceExists === restoredExists;
    const mark = match ? '✓' : '✗';
    console.log(`  ${mark} ${table}: source=${sourceExists} restored=${restoredExists}`);
    if (!match) {
      allPassed = false;
      results.push({ name: `table:${table}`, source: String(sourceExists), restored: String(restoredExists), match: false });
    }
  }

  // ─── 2. Row counts ──────────────────────────────────────────
  const countQueries: Array<{ name: string; query: string }> = [
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
    { name: 'attendances', query: 'SELECT count(*) FROM "attendances"' },
    { name: 'audit_logs', query: 'SELECT count(*) FROM "audit_logs"' },
    { name: 'payment_head_allocations', query: 'SELECT count(*) FROM "payment_head_allocations"' },
    { name: 'fee_heads', query: 'SELECT count(*) FROM "fee_heads"' },
    { name: 'student_parents', query: 'SELECT count(*) FROM "student_parents"' },
    { name: 'enrollments', query: 'SELECT count(*) FROM "enrollments"' },
    { name: 'announcements', query: 'SELECT count(*) FROM "announcements"' },
    { name: 'device_tokens', query: 'SELECT count(*) FROM "device_tokens"' },
    { name: 'user_push_crypto_keys', query: 'SELECT count(*) FROM "user_push_crypto_keys"' },
    { name: 'family_payment_receipts', query: 'SELECT count(*) FROM "family_payment_receipts"' },
    { name: 'payment_receipts', query: 'SELECT count(*) FROM "payment_receipts"' },
    { name: 'batch_promotion_runs', query: 'SELECT count(*) FROM "batch_promotion_runs"' },
    { name: 'timetable_entries', query: 'SELECT count(*) FROM "timetable_entries"' },
    { name: 'exam_sessions', query: 'SELECT count(*) FROM "exam_sessions"' },
    { name: 'marks_entries', query: 'SELECT count(*) FROM "marks_entries"' },
    { name: 'subject_results', query: 'SELECT count(*) FROM "subject_results"' },
    { name: 'report_cards', query: 'SELECT count(*) FROM "report_cards"' },
    { name: 'notification_recipients', query: 'SELECT count(*) FROM "notification_recipients"' },
    { name: 'payment_notifications', query: 'SELECT count(*) FROM "payment_notifications"' },
    { name: 'attendance_notifications', query: 'SELECT count(*) FROM "attendance_notifications"' },
    { name: 'chat_message_read_states', query: 'SELECT count(*) FROM "chat_message_read_states"' },
    { name: 'chat_message_attachments', query: 'SELECT count(*) FROM "chat_message_attachments"' },
    { name: 'upload_session_parts', query: 'SELECT count(*) FROM "upload_session_parts"' },
    { name: 'branch_outgoing_payments', query: 'SELECT count(*) FROM "branch_outgoing_payments"' },
    { name: 'payroll_bulk_runs', query: 'SELECT count(*) FROM "payroll_bulk_runs"' },
    { name: 'payment_operations', query: 'SELECT count(*) FROM "payment_operations"' },
  ];

  console.log('\n=== 2. Row Counts ===');
  for (const q of countQueries) {
    const srcCount = psql(sourceUrl, q.query);
    const rstCount = psql(restoredUrl, q.query);
    const match = srcCount === rstCount;
    const mark = match ? '✓' : '✗';
    console.log(`  ${mark} ${q.name}: source=${srcCount} restored=${rstCount}`);
    results.push({ name: `count:${q.name}`, source: srcCount, restored: rstCount, match });
    if (!match) allPassed = false;
  }

  // ─── 3. Representative aggregates ───────────────────────────
  const aggregateQueries: Array<{ name: string; query: string }> = [
    { name: 'total_users_active', query: 'SELECT count(*) FROM "users" WHERE status = \'active\'' },
    { name: 'total_students_active', query: 'SELECT count(*) FROM "students" WHERE "isActive" = true' },
    { name: 'total_payments_positive', query: 'SELECT count(*) FROM "payments" WHERE amount > 0' },
    { name: 'total_chat_messages_deleted', query: 'SELECT count(*) FROM "chat_messages" WHERE "isDeleted" = true' },
    { name: 'total_fee_structures', query: 'SELECT count(*) FROM "fee_structures"' },
    { name: 'total_branches', query: 'SELECT count(*) FROM "branches"' },
    { name: 'total_academic_years', query: 'SELECT count(*) FROM "academic_years"' },
    { name: 'total_groups', query: 'SELECT count(*) FROM "groups"' },
    { name: 'total_subjects', query: 'SELECT count(*) FROM "subjects"' },
    { name: 'total_teacher_assignments', query: 'SELECT count(*) FROM "teacher_assignments"' },
  ];

  console.log('\n=== 3. Representative Aggregates ===');
  for (const q of aggregateQueries) {
    const srcCount = psql(sourceUrl, q.query);
    const rstCount = psql(restoredUrl, q.query);
    const match = srcCount === rstCount;
    const mark = match ? '✓' : '✗';
    console.log(`  ${mark} ${q.name}: source=${srcCount} restored=${rstCount}`);
    results.push({ name: `agg:${q.name}`, source: srcCount, restored: rstCount, match });
    if (!match) allPassed = false;
  }

  // ─── 4. Structural checks ───────────────────────────────────
  console.log('\n=== 4. Structural Checks ===');
  const structuralChecks = [
    { name: 'indexes', sourceQuery: 'SELECT count(*) FROM pg_indexes WHERE schemaname = \'public\'', restoredQuery: 'SELECT count(*) FROM pg_indexes WHERE schemaname = \'public\'' },
    { name: 'primary_keys', sourceQuery: 'SELECT count(*) FROM information_schema.table_constraints WHERE constraint_type = \'PRIMARY KEY\'', restoredQuery: 'SELECT count(*) FROM information_schema.table_constraints WHERE constraint_type = \'PRIMARY KEY\'' },
    { name: 'sequences', sourceQuery: 'SELECT count(*) FROM information_schema.sequences WHERE sequence_schema = \'public\'', restoredQuery: 'SELECT count(*) FROM information_schema.sequences WHERE sequence_schema = \'public\'' },
  ];

  for (const q of structuralChecks) {
    const srcCount = psql(sourceUrl, q.sourceQuery);
    const rstCount = psql(restoredUrl, q.restoredQuery);
    const match = srcCount === rstCount;
    const mark = match ? '✓' : '✗';
    console.log(`  ${mark} ${q.name}: source=${srcCount} restored=${rstCount}`);
    results.push({ name: `struct:${q.name}`, source: srcCount, restored: rstCount, match });
    if (!match) allPassed = false;
  }

  // ─── 5. Summary ─────────────────────────────────────────────
  const totalChecks = results.length;
  const passedChecks = results.filter((r) => r.match).length;
  const failedChecks = results.filter((r) => !r.match).length;
  console.log(`\n=== Summary ===`);
  console.log(`  Total checks: ${totalChecks}`);
  console.log(`  Passed: ${passedChecks}`);
  console.log(`  Failed: ${failedChecks}`);
  console.log(`  Result: ${allPassed ? 'ALL CHECKS PASSED ✓' : 'SOME CHECKS FAILED ✗'}`);

  if (!allPassed) {
    console.log('\nFailed checks:');
    for (const r of results.filter((r) => !r.match)) {
      console.log(`  ✗ ${r.name}: source=${r.source} restored=${r.restored}`);
    }
  }

  process.exit(allPassed ? 0 : 1);
}

main();
