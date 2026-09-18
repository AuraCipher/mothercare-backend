/**
 * TASK 12A — Section C: Batch Promotion / Long Transaction Tests
 */
import { PrismaClient } from '@prisma/client';
import { createTestPrisma, uniquePrefix, disconnect } from './helpers';

let prisma: PrismaClient;
const clientsToCleanup: PrismaClient[] = [];

beforeAll(() => { prisma = createTestPrisma(); });
afterAll(async () => {
  await disconnect(prisma);
  await Promise.all(clientsToCleanup.map((c) => disconnect(c)));
});

function makeClient(): PrismaClient {
  const c = createTestPrisma();
  clientsToCleanup.push(c);
  return c;
}

async function setup(prefix: string) {
  const branchId = `${prefix}_branch`;
  const userId = `${prefix}_user`;
  const calId = `${prefix}_cal`;
  const calId2 = `${prefix}_cal2`;
  const calLabel2 = `${prefix}_label2`;
  const sourceAyId = `${prefix}_src_ay`;
  const targetAyId = `${prefix}_tgt_ay`;
  const h = 'hash';

  await prisma.$executeRaw`INSERT INTO "branches" ("id","name","code","isActive","createdAt","updatedAt")
    VALUES (${branchId},${prefix},${prefix},true,NOW(),NOW())`;
  await prisma.$executeRaw`INSERT INTO "users" ("id","name","passwordHash","role","status","createdAt","updatedAt")
    VALUES (${userId},${prefix},${h},'management','active',NOW(),NOW())`;
  await prisma.$executeRaw`INSERT INTO "academic_calendars" ("id","label","startDate","endDate","isCurrent","createdAt","updatedAt")
    VALUES (${calId},${prefix},NOW(),NOW(),true,NOW(),NOW())`;
  await prisma.$executeRaw`INSERT INTO "academic_calendars" ("id","label","startDate","endDate","isCurrent","createdAt","updatedAt")
    VALUES (${calId2},${calLabel2},NOW(),NOW(),false,NOW(),NOW())`;
  await prisma.$executeRaw`INSERT INTO "academic_years" ("id","branchId","calendarId","status","createdAt","updatedAt")
    VALUES (${sourceAyId},${branchId},${calId},'ACTIVE',NOW(),NOW())`;
  await prisma.$executeRaw`INSERT INTO "academic_years" ("id","branchId","calendarId","status","createdAt","updatedAt")
    VALUES (${targetAyId},${branchId},${calId2},'BUILD_STAGE',NOW(),NOW())`;
  return { branchId, userId, calId, calId2, sourceAyId, targetAyId };
}

describe('C1 — BatchPromotionRun FOR UPDATE locking', () => {
  test('concurrent snapshot attempts on same DRAFT run: only one succeeds', async () => {
    const p = uniquePrefix();
    const { branchId, userId, calId, calId2, sourceAyId, targetAyId } = await setup(p);
    const runId = `${p}_run`;

    await prisma.$executeRaw`INSERT INTO "batch_promotion_runs" ("id","branchId","sourceAcademicYearId","targetAcademicYearId","phase","carryOptions","promotedById","createdAt","updatedAt")
      VALUES (${runId},${branchId},${sourceAyId},${targetAyId},'DRAFT',${'{}'}::jsonb,${userId},NOW(),NOW())`;

    try {
      const promises = Array.from({ length: 3 }, () => {
        const client = makeClient();
        return client.$transaction(async (tx) => {
          const rows = await tx.$queryRaw<{ id: string; phase: string }[]>`
            SELECT "id","phase" FROM "batch_promotion_runs" WHERE "id" = ${runId} AND "branchId" = ${branchId} FOR UPDATE`;
          if (!rows.length) throw new Error('Not found');
          if (rows[0].phase !== 'DRAFT') throw new Error(`Cannot proceed: run is in '${rows[0].phase}' phase`);
          await tx.$executeRaw`UPDATE "batch_promotion_runs" SET "phase" = 'SNAPSHOT_DONE',"updatedAt" = NOW() WHERE "id" = ${runId}`;
          return 'snapshot_done';
        }).catch(() => 'failed');
      });

      const results = await Promise.all(promises);
      const successes = results.filter((r) => r === 'snapshot_done');
      expect(successes.length).toBe(1);

      const final = await prisma.$queryRaw<{ phase: string }[]>`SELECT "phase" FROM "batch_promotion_runs" WHERE "id" = ${runId}`;
      expect(final[0].phase).toBe('SNAPSHOT_DONE');
    } finally {
      await prisma.$executeRaw`DELETE FROM "batch_promotion_runs" WHERE "id" = ${runId}`;
      await prisma.$executeRaw`DELETE FROM "academic_years" WHERE "id" IN (${sourceAyId},${targetAyId})`;
      await prisma.$executeRaw`DELETE FROM "academic_calendars" WHERE "id" IN (${calId},${calId2})`;
      await prisma.$executeRaw`DELETE FROM "users" WHERE "id" = ${userId}`;
      await prisma.$executeRaw`DELETE FROM "branches" WHERE "id" = ${branchId}`;
    }
  });

  test('phase transition from wrong phase is rejected', async () => {
    const p = uniquePrefix();
    const { branchId, userId, calId, calId2, sourceAyId, targetAyId } = await setup(p);
    const runId = `${p}_run`;

    await prisma.$executeRaw`INSERT INTO "batch_promotion_runs" ("id","branchId","sourceAcademicYearId","targetAcademicYearId","phase","carryOptions","promotedById","createdAt","updatedAt")
      VALUES (${runId},${branchId},${sourceAyId},${targetAyId},'SNAPSHOT_DONE',${'{}'}::jsonb,${userId},NOW(),NOW())`;

    try {
      const client = makeClient();
      await expect(
        client.$transaction(async (tx) => {
          const rows = await tx.$queryRaw<{ id: string; phase: string }[]>`
            SELECT "id","phase" FROM "batch_promotion_runs" WHERE "id" = ${runId} AND "branchId" = ${branchId} FOR UPDATE`;
          if (!rows.length) throw new Error('Not found');
          if (rows[0].phase !== 'DRAFT') throw new Error(`Cannot proceed: run is in '${rows[0].phase}' phase (expected 'DRAFT')`);
        }),
      ).rejects.toThrow(/SNAPSHOT_DONE/);
    } finally {
      await prisma.$executeRaw`DELETE FROM "batch_promotion_runs" WHERE "id" = ${runId}`;
      await prisma.$executeRaw`DELETE FROM "academic_years" WHERE "id" IN (${sourceAyId},${targetAyId})`;
      await prisma.$executeRaw`DELETE FROM "academic_calendars" WHERE "id" IN (${calId},${calId2})`;
      await prisma.$executeRaw`DELETE FROM "users" WHERE "id" = ${userId}`;
      await prisma.$executeRaw`DELETE FROM "branches" WHERE "id" = ${branchId}`;
    }
  });
});
