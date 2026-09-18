/**
 * TASK 12A — Section E: Query / Constraint Sanity
 *
 * Verifies bounded/paginated queries (DB-02) and batch paths (DB-03)
 * work correctly against real PostgreSQL.
 */
import { PrismaClient } from '@prisma/client';
import { createTestPrisma, uniquePrefix, disconnect } from './helpers';

let prisma: PrismaClient;
const clientsToCleanup: PrismaClient[] = [];

beforeAll(() => {
  prisma = createTestPrisma();
});

afterAll(async () => {
  await disconnect(prisma);
  await Promise.all(clientsToCleanup.map((c) => disconnect(c)));
});

describe('E1 — Bounded pagination queries (DB-02)', () => {
  test('student_fees query with cursor pagination returns correct page', async () => {
    const prefix = uniquePrefix();
    const branchId = `${prefix}_branch`;
    const studentId = `${prefix}_student`;
    const ayId = `${prefix}_ay`;
    const calId = `${prefix}_cal`;

    await prisma.$executeRaw`INSERT INTO "branches" ("id", "name", "code", "isActive", "createdAt", "updatedAt")
      VALUES (${branchId}, ${prefix}, ${prefix}, true, NOW(), NOW())`;
    await prisma.$executeRaw`INSERT INTO "academic_calendars" ("id", "label", "startDate", "endDate", "isCurrent", "createdAt", "updatedAt")
      VALUES (${calId}, ${prefix}, NOW(), NOW(), true, NOW(), NOW())`;
    await prisma.$executeRaw`INSERT INTO "academic_years" ("id", "branchId", "calendarId", "status", "createdAt", "updatedAt")
      VALUES (${ayId}, ${branchId}, ${calId}, 'ACTIVE', NOW(), NOW())`;
    await prisma.$executeRaw`INSERT INTO "students" ("id", "academicYearId", "name", "createdAt", "updatedAt")
      VALUES (${studentId}, ${ayId}, 'Test', NOW(), NOW())`;

    const feeIds: string[] = [];
    for (let i = 0; i < 15; i++) {
      const fid = `${prefix}_fee_${i}`;
      feeIds.push(fid);
      await prisma.$executeRaw`
        INSERT INTO "student_fees" ("id", "studentId", "month", "year", "totalAmount", "netAmount", "paidAmount", "status", "academicYearId", "createdAt", "updatedAt")
        VALUES (${fid}, ${studentId}, ${i + 1}, 2026, 1000, 1000, 0, 'UNPAID', ${ayId}, NOW(), NOW())
      `;
    }

    try {
      const page1 = await prisma.studentFee.findMany({
        where: { studentId },
        orderBy: { id: 'asc' },
        take: 5,
      });
      expect(page1).toHaveLength(5);

      const page2 = await prisma.studentFee.findMany({
        where: { studentId },
        orderBy: { id: 'asc' },
        take: 5,
        skip: 1,
        cursor: { id: page1[page1.length - 1].id },
      });
      expect(page2).toHaveLength(5);

      const page1Ids = page1.map((f) => f.id);
      const page2Ids = page2.map((f) => f.id);
      expect(page1Ids.some((id) => page2Ids.includes(id))).toBe(false);
    } finally {
      await prisma.$executeRaw`DELETE FROM "student_fees" WHERE "studentId" = ${studentId}`;
      await prisma.$executeRaw`DELETE FROM "students" WHERE "id" = ${studentId}`;
      await prisma.$executeRaw`DELETE FROM "academic_years" WHERE "id" = ${ayId}`;
      await prisma.$executeRaw`DELETE FROM "academic_calendars" WHERE "id" = ${calId}`;
      await prisma.$executeRaw`DELETE FROM "branches" WHERE "id" = ${branchId}`;
    }
  });

  test('bounded query with status filter and limit', async () => {
    const prefix = uniquePrefix();
    const branchId = `${prefix}_branch`;
    const studentId = `${prefix}_student`;
    const ayId = `${prefix}_ay`;
    const calId = `${prefix}_cal`;

    await prisma.$executeRaw`INSERT INTO "branches" ("id", "name", "code", "isActive", "createdAt", "updatedAt")
      VALUES (${branchId}, ${prefix}, ${prefix}, true, NOW(), NOW())`;
    await prisma.$executeRaw`INSERT INTO "academic_calendars" ("id", "label", "startDate", "endDate", "isCurrent", "createdAt", "updatedAt")
      VALUES (${calId}, ${prefix}, NOW(), NOW(), true, NOW(), NOW())`;
    await prisma.$executeRaw`INSERT INTO "academic_years" ("id", "branchId", "calendarId", "status", "createdAt", "updatedAt")
      VALUES (${ayId}, ${branchId}, ${calId}, 'ACTIVE', NOW(), NOW())`;
    await prisma.$executeRaw`INSERT INTO "students" ("id", "academicYearId", "name", "createdAt", "updatedAt")
      VALUES (${studentId}, ${ayId}, 'Test', NOW(), NOW())`;

    for (let i = 0; i < 10; i++) {
      const status = i < 4 ? 'PAID' : 'UNPAID';
      await prisma.$executeRaw`
        INSERT INTO "student_fees" ("id", "studentId", "month", "year", "totalAmount", "netAmount", "paidAmount", "status", "academicYearId", "createdAt", "updatedAt")
        VALUES (${`${prefix}_fee_${i}`}, ${studentId}, ${i + 1}, 2026, 1000, 1000, ${status === 'PAID' ? 1000 : 0}, ${status}, ${ayId}, NOW(), NOW())
      `;
    }

    try {
      const unpaid = await prisma.studentFee.findMany({
        where: { studentId, status: 'UNPAID' },
        take: 3,
        orderBy: { id: 'asc' },
      });
      expect(unpaid.length).toBeLessThanOrEqual(3);
      expect(unpaid.every((f) => f.status === 'UNPAID')).toBe(true);
    } finally {
      await prisma.$executeRaw`DELETE FROM "student_fees" WHERE "studentId" = ${studentId}`;
      await prisma.$executeRaw`DELETE FROM "students" WHERE "id" = ${studentId}`;
      await prisma.$executeRaw`DELETE FROM "academic_years" WHERE "id" = ${ayId}`;
      await prisma.$executeRaw`DELETE FROM "academic_calendars" WHERE "id" = ${calId}`;
      await prisma.$executeRaw`DELETE FROM "branches" WHERE "id" = ${branchId}`;
    }
  });
});

describe('E2 — Compound unique constraint behavior', () => {
  test('upsert on compound unique key works correctly', async () => {
    const prefix = uniquePrefix();
    const studentId = `${prefix}_student`;
    const session1Id = `${prefix}_session1`;
    const subjectId = `${prefix}_subject`;
    const resultId1 = `${prefix}_result1`;
    const resultId2 = `${prefix}_result2`;
    const branchId = `${prefix}_branch`;
    const calId = `${prefix}_cal`;

    const hashVal = 'hash';
    const userId = `${prefix}_user`;
    await prisma.$executeRaw`INSERT INTO "branches" ("id", "name", "code", "isActive", "createdAt", "updatedAt")
      VALUES (${branchId}, ${prefix}, ${prefix}, true, NOW(), NOW())`;
    await prisma.$executeRaw`INSERT INTO "users" ("id", "name", "passwordHash", "role", "status", "createdAt", "updatedAt")
      VALUES (${userId}, ${prefix}, ${hashVal}, 'management', 'active', NOW(), NOW())`;
    await prisma.$executeRaw`INSERT INTO "academic_calendars" ("id", "label", "startDate", "endDate", "isCurrent", "createdAt", "updatedAt")
      VALUES (${calId}, ${prefix}, NOW(), NOW(), true, NOW(), NOW())`;
    await prisma.$executeRaw`INSERT INTO "academic_years" ("id", "branchId", "calendarId", "status", "createdAt", "updatedAt")
      VALUES (${session1Id}, ${branchId}, ${calId}, 'ACTIVE', NOW(), NOW())`;
    await prisma.$executeRaw`INSERT INTO "exam_sessions" ("id", "name", "academicYearId", "startDate", "endDate", "createdAt", "updatedAt")
      VALUES (${session1Id}, '1st Term', ${session1Id}, '2026-01-01', '2026-06-30', NOW(), NOW())`;
    await prisma.$executeRaw`INSERT INTO "students" ("id", "academicYearId", "name", "createdAt", "updatedAt")
      VALUES (${studentId}, ${session1Id}, 'Test', NOW(), NOW())`;
    await prisma.$executeRaw`INSERT INTO "subjects" ("id", "academicYearId", "name", "createdAt", "updatedAt")
      VALUES (${subjectId}, ${session1Id}, 'Math', NOW(), NOW())`;

    try {
      await prisma.$executeRaw`
        INSERT INTO "subject_results" ("id", "studentId", "examSessionId", "subjectId", "percentage", "grade", "computedAt", "createdAt", "updatedAt")
        VALUES (${resultId1}, ${studentId}, ${session1Id}, ${subjectId}, 85.0, 'A', NOW(), NOW(), NOW())
      `;

      await prisma.$executeRaw`
        INSERT INTO "subject_results" ("id", "studentId", "examSessionId", "subjectId", "percentage", "grade", "computedAt", "createdAt", "updatedAt")
        VALUES (${resultId2}, ${studentId}, ${session1Id}, ${subjectId}, 90.0, 'B', NOW(), NOW(), NOW())
        ON CONFLICT ("studentId", "examSessionId", "subjectId")
        DO UPDATE SET "id" = ${resultId2}, "updatedAt" = NOW()
      `;

      const count = await prisma.$queryRaw<{ count: bigint }[]>`
        SELECT COUNT(*) as count FROM "subject_results"
        WHERE "studentId" = ${studentId} AND "examSessionId" = ${session1Id} AND "subjectId" = ${subjectId}
      `;
      expect(Number(count[0].count)).toBe(1);
    } finally {
      await prisma.$executeRaw`DELETE FROM "subject_results" WHERE "studentId" = ${studentId}`;
      await prisma.$executeRaw`DELETE FROM "subjects" WHERE "id" = ${subjectId}`;
      await prisma.$executeRaw`DELETE FROM "exam_sessions" WHERE "id" = ${session1Id}`;
      await prisma.$executeRaw`DELETE FROM "students" WHERE "id" = ${studentId}`;
      await prisma.$executeRaw`DELETE FROM "academic_years" WHERE "id" = ${session1Id}`;
      await prisma.$executeRaw`DELETE FROM "academic_calendars" WHERE "id" = ${calId}`;
      await prisma.$executeRaw`DELETE FROM "users" WHERE "id" = ${userId}`;
      await prisma.$executeRaw`DELETE FROM "branches" WHERE "id" = ${branchId}`;
    }
  });
});

describe('E3 — Raw SQL batch operations (DB-03 chunked upsert pattern)', () => {
  test('chunked ON CONFLICT DO UPDATE works correctly', async () => {
    const prefix = uniquePrefix();
    const roomId = `${prefix}_room`;
    const branchId = `${prefix}_branch`;
    const ayId = `${prefix}_ay`;
    const calId = `${prefix}_cal`;

    await prisma.$executeRaw`INSERT INTO "branches" ("id", "name", "code", "isActive", "createdAt", "updatedAt")
      VALUES (${branchId}, ${prefix}, ${prefix}, true, NOW(), NOW())`;
    await prisma.$executeRaw`INSERT INTO "academic_calendars" ("id", "label", "startDate", "endDate", "isCurrent", "createdAt", "updatedAt")
      VALUES (${calId}, ${prefix}, NOW(), NOW(), true, NOW(), NOW())`;
    await prisma.$executeRaw`INSERT INTO "academic_years" ("id", "branchId", "calendarId", "status", "createdAt", "updatedAt")
      VALUES (${ayId}, ${branchId}, ${calId}, 'ACTIVE', NOW(), NOW())`;
    await prisma.$executeRaw`INSERT INTO "chat_rooms" ("id", "academicYearId", "branchId", "name", "kind", "source", "createdAt", "updatedAt")
      VALUES (${roomId}, ${ayId}, ${branchId}, 'test-room', 'group_chat', 'system_bootstrap', NOW(), NOW())`;

    const userIds: string[] = [];
    const hashVal = 'hash';
    for (let i = 0; i < 25; i++) {
      const uid = `${prefix}_user_${i}`;
      userIds.push(uid);
      await prisma.$executeRaw`INSERT INTO "users" ("id", "name", "passwordHash", "role", "status", "createdAt", "updatedAt")
        VALUES (${uid}, ${uid}, ${hashVal}, 'student', 'active', NOW(), NOW())`;
    }

    try {
      for (const uid of userIds) {
        await prisma.$executeRaw`
          INSERT INTO "chat_room_members" ("id", "roomId", "userId", "access", "canPost", "canRead", "isMuted", "isPostingRestricted", "joinedAt", "createdAt", "updatedAt")
          VALUES (${`${prefix}_member_${uid}`}, ${roomId}, ${uid}, 'owner', true, true, false, false, NOW(), NOW(), NOW())
          ON CONFLICT ("roomId", "userId")
          DO UPDATE SET "access" = 'owner'
        `;
      }

      const count = await prisma.$queryRaw<{ count: bigint }[]>`
        SELECT COUNT(*) as count FROM "chat_room_members" WHERE "roomId" = ${roomId}
      `;
      expect(Number(count[0].count)).toBe(25);

      // Re-run: idempotent
      for (const uid of userIds) {
        await prisma.$executeRaw`
          INSERT INTO "chat_room_members" ("id", "roomId", "userId", "access", "canPost", "canRead", "isMuted", "isPostingRestricted", "joinedAt", "createdAt", "updatedAt")
          VALUES (${`${prefix}_member_${uid}`}, ${roomId}, ${uid}, 'owner', true, true, false, false, NOW(), NOW(), NOW())
          ON CONFLICT ("roomId", "userId")
          DO UPDATE SET "access" = 'owner'
        `;
      }

      const countAfter = await prisma.$queryRaw<{ count: bigint }[]>`
        SELECT COUNT(*) as count FROM "chat_room_members" WHERE "roomId" = ${roomId}
      `;
      expect(Number(countAfter[0].count)).toBe(25);
    } finally {
      await prisma.$executeRaw`DELETE FROM "chat_room_members" WHERE "roomId" = ${roomId}`;
      await prisma.$executeRaw`DELETE FROM "chat_rooms" WHERE "id" = ${roomId}`;
      for (const uid of userIds) {
        await prisma.$executeRaw`DELETE FROM "users" WHERE "id" = ${uid}`;
      }
      await prisma.$executeRaw`DELETE FROM "academic_years" WHERE "id" = ${ayId}`;
      await prisma.$executeRaw`DELETE FROM "academic_calendars" WHERE "id" = ${calId}`;
      await prisma.$executeRaw`DELETE FROM "branches" WHERE "id" = ${branchId}`;
    }
  });
});

describe('E4 — GREATEST/Negative floor behavior on real PostgreSQL', () => {
  test('GREATEST(0, x) prevents negative values in SQL', async () => {
    const prefix = uniquePrefix();
    const branchId = `${prefix}_branch`;
    const accountId = `${prefix}_account`;

    await prisma.$executeRaw`INSERT INTO "branches" ("id", "name", "code", "isActive", "createdAt", "updatedAt")
      VALUES (${branchId}, ${prefix}, ${prefix}, true, NOW(), NOW())`;
    await prisma.$executeRaw`INSERT INTO "canteen_accounts" ("id", "branchId", "personType", "displayName", "runningBalance", "isActive", "createdAt", "updatedAt")
      VALUES (${accountId}, ${branchId}, 'STUDENT', ${prefix}, 50.00, true, NOW(), NOW())`;

    try {
      await prisma.$executeRaw`
        UPDATE "canteen_accounts"
        SET "runningBalance" = GREATEST(0, "runningBalance" - 100)
        WHERE "id" = ${accountId}
      `;

      const final = await prisma.$queryRaw<{ runningBalance: number }[]>`
        SELECT "runningBalance" FROM "canteen_accounts" WHERE "id" = ${accountId}
      `;
      expect(Number(final[0].runningBalance)).toBe(0);
    } finally {
      await prisma.$executeRaw`DELETE FROM "canteen_accounts" WHERE "id" = ${accountId}`;
      await prisma.$executeRaw`DELETE FROM "branches" WHERE "id" = ${branchId}`;
    }
  });

  test('conditional RETURNING detects insufficient stock', async () => {
    const prefix = uniquePrefix();
    const branchId = `${prefix}_branch`;
    const catId = `${prefix}_cat`;
    const productId = `${prefix}_product`;

    await prisma.$executeRaw`INSERT INTO "branches" ("id", "name", "code", "isActive", "createdAt", "updatedAt")
      VALUES (${branchId}, ${prefix}, ${prefix}, true, NOW(), NOW())`;
    await prisma.$executeRaw`INSERT INTO "canteen_product_categories" ("id", "branchId", "name", "isActive", "createdAt", "updatedAt")
      VALUES (${catId}, ${branchId}, ${prefix}, true, NOW(), NOW())`;
    await prisma.$executeRaw`INSERT INTO "canteen_products" ("id", "branchId", "categoryId", "name", "unitPrice", "stockUnits", "stockBoxes", "unitsPerBox", "lowStockThreshold", "isActive", "createdAt", "updatedAt")
      VALUES (${productId}, ${branchId}, ${catId}, ${prefix}, 10.00, 3, 0, 1, 1, true, NOW(), NOW())`;

    try {
      const dec = await prisma.$queryRaw<{ id: string }[]>`
        UPDATE "canteen_products" SET "stockUnits" = "stockUnits" - 5
        WHERE "id" = ${productId} AND "stockUnits" >= 5
        RETURNING "id"
      `;
      expect(dec).toHaveLength(0);

      const stock = await prisma.$queryRaw<{ stockUnits: number }[]>`
        SELECT "stockUnits" FROM "canteen_products" WHERE "id" = ${productId}
      `;
      expect(Number(stock[0].stockUnits)).toBe(3);
    } finally {
      await prisma.$executeRaw`DELETE FROM "canteen_products" WHERE "id" = ${productId}`;
      await prisma.$executeRaw`DELETE FROM "canteen_product_categories" WHERE "id" = ${catId}`;
      await prisma.$executeRaw`DELETE FROM "branches" WHERE "id" = ${branchId}`;
    }
  });
});

describe('E5 — FOR UPDATE in isolated transactions', () => {
  test('FOR UPDATE blocks concurrent reads until first transaction commits', async () => {
    const prefix = uniquePrefix();
    const branchId = `${prefix}_branch`;
    const accountId = `${prefix}_account`;

    await prisma.$executeRaw`INSERT INTO "branches" ("id", "name", "code", "isActive", "createdAt", "updatedAt")
      VALUES (${branchId}, ${prefix}, ${prefix}, true, NOW(), NOW())`;
    await prisma.$executeRaw`INSERT INTO "canteen_accounts" ("id", "branchId", "personType", "displayName", "runningBalance", "isActive", "createdAt", "updatedAt")
      VALUES (${accountId}, ${branchId}, 'STUDENT', ${prefix}, 1000.00, true, NOW(), NOW())`;

    try {
      const client1 = createTestPrisma();
      const client2 = createTestPrisma();
      clientsToCleanup.push(client1, client2);

      // Start TX1 first — it acquires the FOR UPDATE lock
      const tx1Promise = client1.$transaction(async (tx) => {
        const locked = await tx.$queryRaw<{ runningBalance: unknown }[]>`
          SELECT "runningBalance" FROM "canteen_accounts" WHERE "id" = ${accountId} FOR UPDATE
        `;
        // Hold lock for 300ms while updating
        await new Promise((r) => setTimeout(r, 300));
        await tx.$executeRaw`
          UPDATE "canteen_accounts" SET "runningBalance" = 500 WHERE "id" = ${accountId}
        `;
        return Number(locked[0].runningBalance);
      });

      // Let TX1 acquire the lock before starting TX2
      await new Promise((r) => setTimeout(r, 50));

      // TX2 will block on FOR UPDATE until TX1 commits
      const tx2Promise = client2.$transaction(async (tx) => {
        const locked = await tx.$queryRaw<{ runningBalance: unknown }[]>`
          SELECT "runningBalance" FROM "canteen_accounts" WHERE "id" = ${accountId} FOR UPDATE
        `;
        return Number(locked[0].runningBalance);
      });

      const [val1, val2] = await Promise.all([tx1Promise, tx2Promise]);

      expect(val1).toBe(1000);
      expect(val2).toBe(500);
    } finally {
      await prisma.$executeRaw`DELETE FROM "canteen_accounts" WHERE "id" = ${accountId}`;
      await prisma.$executeRaw`DELETE FROM "branches" WHERE "id" = ${branchId}`;
    }
  });
});
