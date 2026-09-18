/**
 * TASK 12A — Section A: Migration / Schema Validation
 *
 * Verifies the database schema against a REAL PostgreSQL instance.
 */
import { PrismaClient } from '@prisma/client';
import { createTestPrisma, uniquePrefix, disconnect } from './helpers';

let prisma: PrismaClient;

beforeAll(() => {
  prisma = createTestPrisma();
});

afterAll(async () => {
  await disconnect(prisma);
});

describe('A1 — Migration / Schema integrity', () => {
  test('all expected tables exist', async () => {
    const rows = await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename
    `;
    const tables = rows.map((r) => r.tablename);
    const required = [
      'users', 'branches', 'academic_years', 'academic_calendars',
      'students', 'student_persons', 'groups', 'subjects',
      'student_fees', 'payments', 'payment_receipts',
      'canteen_products', 'canteen_accounts', 'canteen_sales',
      'stationary_products', 'stationary_suppliers',
      'batch_promotion_runs', 'file_records',
      'marks_entries', 'subject_results', 'report_cards',
      'chat_messages', 'chat_rooms', 'chat_room_members',
    ];
    for (const t of required) {
      expect(tables).toContain(t);
    }
  });

  test('important columns exist on canteen_products', async () => {
    const cols = await prisma.$queryRaw<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'canteen_products' AND table_schema = 'public'
    `;
    const names = cols.map((c) => c.column_name);
    expect(names).toContain('stockUnits');
    expect(names).toContain('stockBoxes');
    expect(names).toContain('unitsPerBox');
    expect(names).toContain('branchId');
    expect(names).toContain('isActive');
  });

  test('important columns exist on student_fees', async () => {
    const cols = await prisma.$queryRaw<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'student_fees' AND table_schema = 'public'
    `;
    const names = cols.map((c) => c.column_name);
    expect(names).toContain('paidAmount');
    expect(names).toContain('netAmount');
    expect(names).toContain('status');
    expect(names).toContain('studentId');
  });

  test('important columns exist on stationary_products', async () => {
    const cols = await prisma.$queryRaw<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'stationary_products' AND table_schema = 'public'
    `;
    const names = cols.map((c) => c.column_name);
    expect(names).toContain('stockBundles');
    expect(names).toContain('stockUnits');
    expect(names).toContain('unitsPerBundle');
    expect(names).toContain('branchId');
    expect(names).toContain('isActive');
  });
});

describe('A2 — FK constraints exist and are enforced', () => {
  test('payments.studentFeeId FK to student_fees exists', async () => {
    const fks = await prisma.$queryRaw<{ constraint_name: string }[]>`
      SELECT tc.constraint_name FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
      WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_name = 'payments' AND kcu.column_name = 'studentFeeId'
    `;
    expect(fks.length).toBeGreaterThanOrEqual(1);
  });

  test('FK violation is rejected by PostgreSQL', async () => {
    await expect(
      prisma.$executeRaw`
        INSERT INTO "canteen_sales" ("id", "branchId", "canteenAccountId", "paymentType", "totalAmount", "soldAt")
        VALUES ('test-fk-violation', 'nonexistent-branch', 'nonexistent-account', 'CASH', 100, NOW())
      `,
    ).rejects.toThrow();
  });
});

describe('A3 — Compound unique constraints exist', () => {
  test('marks_entries has examClassSubjectId + studentId unique', async () => {
    const indexes = await prisma.$queryRaw<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes WHERE tablename = 'marks_entries' AND indexname LIKE '%_key'
    `;
    expect(indexes.map((i) => i.indexname)).toContain('marks_entries_examClassSubjectId_studentId_key');
  });

  test('subject_results has studentId + examSessionId + subjectId unique', async () => {
    const indexes = await prisma.$queryRaw<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes WHERE tablename = 'subject_results' AND indexname LIKE '%_key'
    `;
    expect(indexes.map((i) => i.indexname)).toContain('subject_results_studentId_examSessionId_subjectId_key');
  });

  test('student_fees has studentId + month + year + academicYearId unique', async () => {
    const indexes = await prisma.$queryRaw<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes WHERE tablename = 'student_fees' AND indexname LIKE '%_key'
    `;
    expect(indexes.map((i) => i.indexname)).toContain('student_fees_studentId_month_year_academicYearId_key');
  });

  test('compound unique rejects duplicates on subject_results', async () => {
    const prefix = uniquePrefix();
    const branchId = `${prefix}_br`;
    const calId = `${prefix}_cal`;
    const ayId = `${prefix}_ay`;
    const studentId = `${prefix}_stu`;
    const sessionId = `${prefix}_ses`;
    const subjectId = `${prefix}_sub`;
    const r1 = `${prefix}_r1`;
    const r2 = `${prefix}_r2`;
    const userId = `${prefix}_usr`;

    try {
      const h = 'hash';
      await prisma.$executeRaw`INSERT INTO "branches" ("id","name","code","isActive","createdAt","updatedAt") VALUES (${branchId},${prefix},${prefix},true,NOW(),NOW())`;
      await prisma.$executeRaw`INSERT INTO "users" ("id","name","passwordHash","role","status","createdAt","updatedAt") VALUES (${userId},${prefix},${h},'management','active',NOW(),NOW())`;
      await prisma.$executeRaw`INSERT INTO "academic_calendars" ("id","label","startDate","endDate","isCurrent","createdAt","updatedAt") VALUES (${calId},${prefix},NOW(),NOW(),true,NOW(),NOW())`;
      await prisma.$executeRaw`INSERT INTO "academic_years" ("id","branchId","calendarId","status","createdAt","updatedAt") VALUES (${ayId},${branchId},${calId},'ACTIVE',NOW(),NOW())`;
      await prisma.$executeRaw`INSERT INTO "students" ("id","academicYearId","name","createdAt","updatedAt") VALUES (${studentId},${ayId},'Test',NOW(),NOW())`;
      await prisma.$executeRaw`INSERT INTO "exam_sessions" ("id","name","academicYearId","startDate","endDate","createdAt","updatedAt") VALUES (${sessionId},'1st',${ayId},'2026-01-01','2026-06-30',NOW(),NOW())`;
      await prisma.$executeRaw`INSERT INTO "subjects" ("id","academicYearId","name","createdAt","updatedAt") VALUES (${subjectId},${ayId},'Math',NOW(),NOW())`;

      await prisma.$executeRaw`
        INSERT INTO "subject_results" ("id","studentId","examSessionId","subjectId","percentage","grade","computedAt","createdAt","updatedAt")
        VALUES (${r1},${studentId},${sessionId},${subjectId},85.0,'A',NOW(),NOW(),NOW())
      `;
      await expect(
        prisma.$executeRaw`
          INSERT INTO "subject_results" ("id","studentId","examSessionId","subjectId","percentage","grade","computedAt","createdAt","updatedAt")
          VALUES (${r2},${studentId},${sessionId},${subjectId},90.0,'B',NOW(),NOW(),NOW())
        `,
      ).rejects.toThrow();
    } finally {
      await prisma.$executeRaw`DELETE FROM "subject_results" WHERE "id" IN (${r1}, ${r2})`;
      await prisma.$executeRaw`DELETE FROM "subjects" WHERE "id" = ${subjectId}`;
      await prisma.$executeRaw`DELETE FROM "exam_sessions" WHERE "id" = ${sessionId}`;
      await prisma.$executeRaw`DELETE FROM "students" WHERE "id" = ${studentId}`;
      await prisma.$executeRaw`DELETE FROM "academic_years" WHERE "id" = ${ayId}`;
      await prisma.$executeRaw`DELETE FROM "academic_calendars" WHERE "id" = ${calId}`;
      await prisma.$executeRaw`DELETE FROM "users" WHERE "id" = ${userId}`;
      await prisma.$executeRaw`DELETE FROM "branches" WHERE "id" = ${branchId}`;
    }
  });
});

describe('A4 — DB-01 performance indexes exist', () => {
  test('branch_members has composite index for role+isActive', async () => {
    const idx = await prisma.$queryRaw<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes WHERE tablename = 'branch_members' AND indexname = 'branch_members_branchId_role_isActive_idx'
    `;
    expect(idx).toHaveLength(1);
  });

  test('students has composite index for academicYearId+groupId', async () => {
    const idx = await prisma.$queryRaw<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes WHERE tablename = 'students' AND indexname = 'students_academicYearId_groupId_idx'
    `;
    expect(idx).toHaveLength(1);
  });

  test('students has composite index for academicYearId+status', async () => {
    const idx = await prisma.$queryRaw<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes WHERE tablename = 'students' AND indexname = 'students_academicYearId_status_idx'
    `;
    expect(idx).toHaveLength(1);
  });

  test('teacher_assignments has composite index for academicYearId+groupId', async () => {
    const idx = await prisma.$queryRaw<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes WHERE tablename = 'teacher_assignments' AND indexname = 'teacher_assignments_academicYearId_groupId_idx'
    `;
    expect(idx).toHaveLength(1);
  });
});

describe('A5 — Enum types exist in PostgreSQL', () => {
  test.each(['CanteenSalePaymentType', 'CanteenSupplierPaymentDirection', 'BatchPromotionRunPhase', 'AcademicYearStatus'])(
    '%s enum exists',
    async (name) => {
      const enums = await prisma.$queryRaw<{ typname: string }[]>`SELECT t.typname FROM pg_type t WHERE t.typname = ${name}`;
      expect(enums).toHaveLength(1);
    },
  );
});

describe('A6 — Decimal precision on financial columns', () => {
  test('canteen_accounts.runningBalance is numeric type', async () => {
    const cols = await prisma.$queryRaw<{ data_type: string }[]>`
      SELECT data_type FROM information_schema.columns WHERE table_name = 'canteen_accounts' AND column_name = 'runningBalance'
    `;
    expect(cols[0].data_type).toBe('numeric');
  });

  test('payments can store integer amounts', async () => {
    const prefix = uniquePrefix();
    const branchId = `${prefix}_br`;
    const calId = `${prefix}_cal`;
    const ayId = `${prefix}_ay`;
    const userId = `${prefix}_usr`;
    const studentId = `${prefix}_stu`;
    const feeId = `${prefix}_fee`;
    const paymentId = `${prefix}_pay`;

    try {
      const h = 'hash';
      await prisma.$executeRaw`INSERT INTO "branches" ("id","name","code","isActive","createdAt","updatedAt") VALUES (${branchId},${prefix},${prefix},true,NOW(),NOW())`;
      await prisma.$executeRaw`INSERT INTO "users" ("id","name","passwordHash","role","status","createdAt","updatedAt") VALUES (${userId},${prefix},${h},'management','active',NOW(),NOW())`;
      await prisma.$executeRaw`INSERT INTO "academic_calendars" ("id","label","startDate","endDate","isCurrent","createdAt","updatedAt") VALUES (${calId},${prefix},NOW(),NOW(),true,NOW(),NOW())`;
      await prisma.$executeRaw`INSERT INTO "academic_years" ("id","branchId","calendarId","status","createdAt","updatedAt") VALUES (${ayId},${branchId},${calId},'ACTIVE',NOW(),NOW())`;
      await prisma.$executeRaw`INSERT INTO "students" ("id","academicYearId","name","createdAt","updatedAt") VALUES (${studentId},${ayId},'Test',NOW(),NOW())`;
      await prisma.$executeRaw`
        INSERT INTO "student_fees" ("id","studentId","month","year","totalAmount","netAmount","paidAmount","status","academicYearId","createdAt","updatedAt")
        VALUES (${feeId},${studentId},1,2026,1500,1500,0,'UNPAID',${ayId},NOW(),NOW())
      `;
      await prisma.$executeRaw`
        INSERT INTO "payments" ("id","studentFeeId","studentId","amount","paymentMethod","receiptNumber","recordedById","createdAt")
        VALUES (${paymentId},${feeId},${studentId},999,'cash','RCP-TEST-001',${userId},NOW())
      `;
      const rows = await prisma.$queryRaw<{ amount: number }[]>`SELECT "amount" FROM "payments" WHERE "id" = ${paymentId}`;
      expect(rows[0].amount).toBe(999);
    } finally {
      await prisma.$executeRaw`DELETE FROM "payments" WHERE "id" = ${paymentId}`;
      await prisma.$executeRaw`DELETE FROM "student_fees" WHERE "id" = ${feeId}`;
      await prisma.$executeRaw`DELETE FROM "students" WHERE "id" = ${studentId}`;
      await prisma.$executeRaw`DELETE FROM "academic_years" WHERE "id" = ${ayId}`;
      await prisma.$executeRaw`DELETE FROM "academic_calendars" WHERE "id" = ${calId}`;
      await prisma.$executeRaw`DELETE FROM "users" WHERE "id" = ${userId}`;
      await prisma.$executeRaw`DELETE FROM "branches" WHERE "id" = ${branchId}`;
    }
  });
});
