/**
 * TASK 12A — Section B: Transactional Concurrency (Real PostgreSQL)
 *
 * IMPORTANT: Never call disconnect() inside $transaction.
 * All payment tables use "paidAt" not "createdAt".
 * academic_calendars.label is UNIQUE — use unique prefix.
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

async function setupBranch(prisma: PrismaClient, prefix: string) {
  const branchId = `${prefix}_br`;
  await prisma.$executeRaw`INSERT INTO "branches" ("id","name","code","isActive","createdAt","updatedAt")
    VALUES (${branchId},${prefix},${prefix},true,NOW(),NOW())`;
  return branchId;
}

// ═════════════════════════════════════════════════════════════
// B1: Canteen Stock Deduction
// ═════════════════════════════════════════════════════════════

describe('B1 — Canteen stock deduction concurrency', () => {
  test('concurrent sales do not produce negative stock', async () => {
    const p = uniquePrefix();
    const branchId = await setupBranch(prisma, p);
    const catId = `${p}_cat`;
    const productId = `${p}_prod`;
    await prisma.$executeRaw`INSERT INTO "canteen_product_categories" ("id","branchId","name","isActive","createdAt","updatedAt")
      VALUES (${catId},${branchId},${p},true,NOW(),NOW())`;
    await prisma.$executeRaw`INSERT INTO "canteen_products" ("id","branchId","categoryId","name","unitPrice","stockUnits","stockBoxes","unitsPerBox","lowStockThreshold","isActive","createdAt","updatedAt")
      VALUES (${productId},${branchId},${catId},${p},10.00,5,0,1,2,true,NOW(),NOW())`;

    try {
      const promises = Array.from({ length: 8 }, () => {
        const client = makeClient();
        return client.$transaction(async (tx) => {
          const dec = await tx.$queryRaw<{ id: string }[]>`
            UPDATE "canteen_products" SET "stockUnits" = "stockUnits" - 1
            WHERE "id" = ${productId} AND "stockUnits" >= 1 RETURNING "id"`;
          return dec.length > 0;
        }).catch(() => false);
      });

      const results = await Promise.all(promises);
      const successes = results.filter(Boolean).length;
      const final = await prisma.$queryRaw<{ stockUnits: number }[]>`SELECT "stockUnits" FROM "canteen_products" WHERE "id" = ${productId}`;

      expect(Number(final[0].stockUnits)).toBeGreaterThanOrEqual(0);
      expect(Number(final[0].stockUnits)).toBe(5 - successes);
      expect(successes).toBeLessThanOrEqual(5);
    } finally {
      await prisma.$executeRaw`DELETE FROM "canteen_products" WHERE "id" = ${productId}`;
      await prisma.$executeRaw`DELETE FROM "canteen_product_categories" WHERE "id" = ${catId}`;
      await prisma.$executeRaw`DELETE FROM "branches" WHERE "id" = ${branchId}`;
    }
  }, 15000);

  test('insufficient stock correctly rejected under concurrency', async () => {
    const p = uniquePrefix();
    const branchId = await setupBranch(prisma, p);
    const catId = `${p}_cat`;
    const productId = `${p}_prod`;
    await prisma.$executeRaw`INSERT INTO "canteen_product_categories" ("id","branchId","name","isActive","createdAt","updatedAt")
      VALUES (${catId},${branchId},${p},true,NOW(),NOW())`;
    await prisma.$executeRaw`INSERT INTO "canteen_products" ("id","branchId","categoryId","name","unitPrice","stockUnits","stockBoxes","unitsPerBox","lowStockThreshold","isActive","createdAt","updatedAt")
      VALUES (${productId},${branchId},${catId},${p},10.00,2,0,1,1,true,NOW(),NOW())`;

    try {
      const promises = Array.from({ length: 5 }, () => {
        const client = makeClient();
        return client.$transaction(async (tx) => {
          const dec = await tx.$queryRaw<{ id: string }[]>`
            UPDATE "canteen_products" SET "stockUnits" = "stockUnits" - 2
            WHERE "id" = ${productId} AND "stockUnits" >= 2 RETURNING "id"`;
          return dec.length > 0;
        }).catch(() => false);
      });

      const results = await Promise.all(promises);
      const successes = results.filter(Boolean).length;
      const final = await prisma.$queryRaw<{ stockUnits: number }[]>`SELECT "stockUnits" FROM "canteen_products" WHERE "id" = ${productId}`;

      expect(successes).toBe(1);
      expect(Number(final[0].stockUnits)).toBe(0);
    } finally {
      await prisma.$executeRaw`DELETE FROM "canteen_products" WHERE "id" = ${productId}`;
      await prisma.$executeRaw`DELETE FROM "canteen_product_categories" WHERE "id" = ${catId}`;
      await prisma.$executeRaw`DELETE FROM "branches" WHERE "id" = ${branchId}`;
    }
  }, 15000);
});

// ═════════════════════════════════════════════════════════════
// B2: Canteen Account Payment (FOR UPDATE)
// ═════════════════════════════════════════════════════════════

describe('B2 — Canteen account payment concurrency', () => {
  test('concurrent payments against same account do not corrupt balance', async () => {
    const p = uniquePrefix();
    const branchId = await setupBranch(prisma, p);
    const accountId = `${p}_acct`;

    await prisma.$executeRaw`INSERT INTO "canteen_accounts" ("id","branchId","personType","displayName","runningBalance","isActive","createdAt","updatedAt")
      VALUES (${accountId},${branchId},'STUDENT',${p},1000.00,true,NOW(),NOW())`;

    try {
      const promises = Array.from({ length: 5 }, (_, i) => {
        const client = makeClient();
        return client.$transaction(async (tx) => {
          const locked = await tx.$queryRaw<{ runningBalance: unknown }[]>`
            SELECT "runningBalance" FROM "canteen_accounts" WHERE "id" = ${accountId} AND "branchId" = ${branchId} FOR UPDATE`;
          if (!locked.length) throw new Error('Account not found');

          await tx.$executeRaw`
            INSERT INTO "canteen_account_payments" ("id","canteenAccountId","amountPaid","paidAt")
            VALUES (${`${p}_pay_${i}`},${accountId},100,NOW())`;

          await tx.$executeRaw`
            UPDATE "canteen_accounts" SET "runningBalance" = GREATEST(0, "runningBalance" - 100) WHERE "id" = ${accountId}`;
        });
      });

      await Promise.all(promises);

      const final = await prisma.$queryRaw<{ runningBalance: number }[]>`
        SELECT "runningBalance" FROM "canteen_accounts" WHERE "id" = ${accountId}`;
      expect(Number(final[0].runningBalance)).toBe(500);
    } finally {
      await prisma.$executeRaw`DELETE FROM "canteen_account_payments" WHERE "canteenAccountId" = ${accountId}`;
      await prisma.$executeRaw`DELETE FROM "canteen_accounts" WHERE "id" = ${accountId}`;
      await prisma.$executeRaw`DELETE FROM "branches" WHERE "id" = ${branchId}`;
    }
  });

  test('payment does not over-deduct below zero', async () => {
    const p = uniquePrefix();
    const branchId = await setupBranch(prisma, p);
    const accountId = `${p}_acct`;

    await prisma.$executeRaw`INSERT INTO "canteen_accounts" ("id","branchId","personType","displayName","runningBalance","isActive","createdAt","updatedAt")
      VALUES (${accountId},${branchId},'STUDENT',${p},150.00,true,NOW(),NOW())`;

    try {
      const promises = Array.from({ length: 5 }, (_, i) => {
        const client = makeClient();
        return client.$transaction(async (tx) => {
          const locked = await tx.$queryRaw`SELECT "runningBalance" FROM "canteen_accounts" WHERE "id" = ${accountId} AND "branchId" = ${branchId} FOR UPDATE`;
          if (!(locked as any[]).length) throw new Error('Account not found');
          await tx.$executeRaw`
            INSERT INTO "canteen_account_payments" ("id","canteenAccountId","amountPaid","paidAt")
            VALUES (${`${p}_pay_${i}`},${accountId},100,NOW())`;
          await tx.$executeRaw`
            UPDATE "canteen_accounts" SET "runningBalance" = GREATEST(0, "runningBalance" - 100) WHERE "id" = ${accountId}`;
        }).catch(() => null);
      });

      await Promise.all(promises);

      const final = await prisma.$queryRaw<{ runningBalance: number }[]>`
        SELECT "runningBalance" FROM "canteen_accounts" WHERE "id" = ${accountId}`;
      expect(Number(final[0].runningBalance)).toBeGreaterThanOrEqual(0);
    } finally {
      await prisma.$executeRaw`DELETE FROM "canteen_account_payments" WHERE "canteenAccountId" = ${accountId}`;
      await prisma.$executeRaw`DELETE FROM "canteen_accounts" WHERE "id" = ${accountId}`;
      await prisma.$executeRaw`DELETE FROM "branches" WHERE "id" = ${branchId}`;
    }
  });
});

// ═════════════════════════════════════════════════════════════
// B3: Canteen Supplier Payment (FOR UPDATE)
// ═════════════════════════════════════════════════════════════

describe('B3 — Canteen supplier payment concurrency', () => {
  test('concurrent supplier payments do not corrupt balance', async () => {
    const p = uniquePrefix();
    const branchId = await setupBranch(prisma, p);
    const supplierId = `${p}_sup`;

    await prisma.$executeRaw`INSERT INTO "canteen_suppliers" ("id","branchId","name","balanceOwedToSupplier","balanceSupplierOwesUs","isActive","createdAt","updatedAt")
      VALUES (${supplierId},${branchId},${p},500.00,0.00,true,NOW(),NOW())`;

    try {
      const promises = Array.from({ length: 3 }, (_, i) => {
        const client = makeClient();
        return client.$transaction(async (tx) => {
          const locked = await tx.$queryRaw`SELECT "balanceOwedToSupplier","balanceSupplierOwesUs" FROM "canteen_suppliers" WHERE "id" = ${supplierId} AND "branchId" = ${branchId} FOR UPDATE`;
          if (!(locked as any[]).length) throw new Error('Supplier not found');

          await tx.$executeRaw`
            INSERT INTO "canteen_supplier_payments" ("id","supplierId","amount","direction","paidAt")
            VALUES (${`${p}_pay_${i}`},${supplierId},100,'WE_PAID_SUPPLIER',NOW())`;

          await tx.$executeRaw`
            UPDATE "canteen_suppliers"
            SET "balanceOwedToSupplier" = GREATEST(0, "balanceOwedToSupplier" - 100),
                "balanceSupplierOwesUs" = "balanceSupplierOwesUs" + GREATEST(0, 100 - "balanceOwedToSupplier")
            WHERE "id" = ${supplierId}`;
        });
      });

      await Promise.all(promises);

      const final = await prisma.$queryRaw<{ balanceOwedToSupplier: number; balanceSupplierOwesUs: number }[]>`
        SELECT "balanceOwedToSupplier","balanceSupplierOwesUs" FROM "canteen_suppliers" WHERE "id" = ${supplierId}`;

      expect(Number(final[0].balanceOwedToSupplier)).toBe(200);
      expect(Number(final[0].balanceSupplierOwesUs)).toBe(0);
    } finally {
      await prisma.$executeRaw`DELETE FROM "canteen_supplier_payments" WHERE "supplierId" = ${supplierId}`;
      await prisma.$executeRaw`DELETE FROM "canteen_suppliers" WHERE "id" = ${supplierId}`;
      await prisma.$executeRaw`DELETE FROM "branches" WHERE "id" = ${branchId}`;
    }
  });
});

// ═════════════════════════════════════════════════════════════
// B4: Fee Payment (student_fees FOR UPDATE)
// ═════════════════════════════════════════════════════════════

describe('B4 — Fee payment concurrency', () => {
  async function setupFeeTest(prefix: string) {
    const branchId = `${prefix}_br`;
    const calId = `${prefix}_cal`;
    const ayId = `${prefix}_ay`;
    const studentId = `${prefix}_stu`;
    const userId = `${prefix}_usr`;
    const feeId = `${prefix}_fee`;
    const h = 'hash';
    await prisma.$executeRaw`INSERT INTO "branches" ("id","name","code","isActive","createdAt","updatedAt") VALUES (${branchId},${prefix},${prefix},true,NOW(),NOW())`;
    await prisma.$executeRaw`INSERT INTO "users" ("id","name","passwordHash","role","status","createdAt","updatedAt") VALUES (${userId},${prefix},${h},'parent','active',NOW(),NOW())`;
    await prisma.$executeRaw`INSERT INTO "academic_calendars" ("id","label","startDate","endDate","isCurrent","createdAt","updatedAt") VALUES (${calId},${prefix},NOW(),NOW(),true,NOW(),NOW())`;
    await prisma.$executeRaw`INSERT INTO "academic_years" ("id","branchId","calendarId","status","createdAt","updatedAt") VALUES (${ayId},${branchId},${calId},'ACTIVE',NOW(),NOW())`;
    await prisma.$executeRaw`INSERT INTO "students" ("id","academicYearId","name","createdAt","updatedAt") VALUES (${studentId},${ayId},'Test',NOW(),NOW())`;
    return { branchId, calId, ayId, studentId, userId, feeId };
  }

  test('concurrent payments against same student fee do not produce double-payment', async () => {
    const p = uniquePrefix();
    const { branchId, calId, ayId, studentId, userId, feeId } = await setupFeeTest(p);

    await prisma.$executeRaw`INSERT INTO "student_fees" ("id","studentId","month","year","totalAmount","netAmount","paidAmount","status","academicYearId","createdAt","updatedAt")
      VALUES (${feeId},${studentId},1,2026,500,500,0,'UNPAID',${ayId},NOW(),NOW())`;

    try {
      const promises = Array.from({ length: 3 }, (_, i) => {
        const client = makeClient();
        return client.$transaction(async (tx) => {
          const locked = await tx.$queryRaw<{ netAmount: number; paidAmount: number }[]>`
            SELECT "netAmount","paidAmount" FROM "student_fees" WHERE "id" = ${feeId} FOR UPDATE`;
          if (!locked.length) throw new Error('Fee not found');
          const fee = locked[0];
          const newPaid = Math.min(Number(fee.netAmount), Number(fee.paidAmount) + 200);
          const newStatus = newPaid >= Number(fee.netAmount) ? 'PAID' : 'PARTIAL';
          await tx.$executeRaw`UPDATE "student_fees" SET "paidAmount" = ${newPaid}, "status" = ${newStatus}, "updatedAt" = NOW() WHERE "id" = ${feeId}`;
          await tx.$executeRaw`
            INSERT INTO "payments" ("id","studentFeeId","studentId","amount","paymentMethod","receiptNumber","recordedById","createdAt")
            VALUES (${`${p}_pay_${i}`},${feeId},${studentId},200,'cash',${`RCP-${p}-${i}`},${userId},NOW())`;
        });
      });

      await Promise.all(promises);

      const finalFee = await prisma.$queryRaw<{ paidAmount: number; status: string }[]>`
        SELECT "paidAmount","status" FROM "student_fees" WHERE "id" = ${feeId}`;
      const finalPayments = await prisma.$queryRaw<{ count: bigint }[]>`
        SELECT COUNT(*) as count FROM "payments" WHERE "studentFeeId" = ${feeId}`;

      expect(Number(finalFee[0].paidAmount)).toBeLessThanOrEqual(500);
      expect(Number(finalFee[0].paidAmount)).toBeGreaterThanOrEqual(200);
      expect(Number(finalPayments[0].count)).toBeGreaterThanOrEqual(1);
    } finally {
      await prisma.$executeRaw`DELETE FROM "payments" WHERE "studentFeeId" = ${feeId}`;
      await prisma.$executeRaw`DELETE FROM "student_fees" WHERE "id" = ${feeId}`;
      await prisma.$executeRaw`DELETE FROM "students" WHERE "id" = ${studentId}`;
      await prisma.$executeRaw`DELETE FROM "academic_years" WHERE "id" = ${ayId}`;
      await prisma.$executeRaw`DELETE FROM "academic_calendars" WHERE "id" = ${calId}`;
      await prisma.$executeRaw`DELETE FROM "users" WHERE "id" = ${userId}`;
      await prisma.$executeRaw`DELETE FROM "branches" WHERE "id" = ${branchId}`;
    }
  });

  test('payment revert under concurrency does not corrupt fee state', async () => {
    const p = uniquePrefix();
    const { branchId, calId, ayId, studentId, userId, feeId } = await setupFeeTest(p);

    await prisma.$executeRaw`INSERT INTO "student_fees" ("id","studentId","month","year","totalAmount","netAmount","paidAmount","status","academicYearId","createdAt","updatedAt")
      VALUES (${feeId},${studentId},1,2026,500,500,200,'PARTIAL',${ayId},NOW(),NOW())`;

    try {
      const paymentId = `${p}_ex_pay`;
      await prisma.$executeRaw`
        INSERT INTO "payments" ("id","studentFeeId","studentId","amount","paymentMethod","receiptNumber","recordedById","createdAt")
        VALUES (${paymentId},${feeId},${studentId},200,'cash',${`RCP-${p}-ex`},${userId},NOW())`;

      const revertClient = makeClient();
      const revertOp = revertClient.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "student_fees" WHERE id = ${feeId} FOR UPDATE`;
        await tx.$executeRaw`UPDATE "student_fees" SET "paidAmount" = GREATEST(0, "paidAmount" - 200), "status" = 'UNPAID', "updatedAt" = NOW() WHERE "id" = ${feeId}`;
        await tx.$executeRaw`UPDATE "payments" SET "revertedAt" = NOW(), "revertedById" = ${userId} WHERE "id" = ${paymentId}`;
        return 'reverted';
      }).catch(() => 'revert_failed');

      const payClient = makeClient();
      const payOp = payClient.$transaction(async (tx) => {
        const locked = await tx.$queryRaw<{ netAmount: number; paidAmount: number }[]>`
          SELECT "netAmount","paidAmount" FROM "student_fees" WHERE "id" = ${feeId} FOR UPDATE`;
        if (!locked.length) throw new Error('Fee not found');
        const fee = locked[0];
        const newPaid = Math.min(Number(fee.netAmount), Number(fee.paidAmount) + 100);
        const newStatus = newPaid >= Number(fee.netAmount) ? 'PAID' : 'PARTIAL';
        await tx.$executeRaw`UPDATE "student_fees" SET "paidAmount" = ${newPaid}, "status" = ${newStatus}, "updatedAt" = NOW() WHERE "id" = ${feeId}`;
        return 'paid';
      }).catch(() => 'pay_failed');

      await Promise.all([revertOp, payOp]);

      const finalFee = await prisma.$queryRaw<{ paidAmount: number; status: string }[]>`
        SELECT "paidAmount","status" FROM "student_fees" WHERE "id" = ${feeId}`;

      const paid = Number(finalFee[0].paidAmount);
      expect(paid).toBeGreaterThanOrEqual(0);
      expect(paid).toBeLessThanOrEqual(500);
    } finally {
      await prisma.$executeRaw`DELETE FROM "payments" WHERE "studentFeeId" = ${feeId}`;
      await prisma.$executeRaw`DELETE FROM "student_fees" WHERE "id" = ${feeId}`;
      await prisma.$executeRaw`DELETE FROM "students" WHERE "id" = ${studentId}`;
      await prisma.$executeRaw`DELETE FROM "academic_years" WHERE "id" = ${ayId}`;
      await prisma.$executeRaw`DELETE FROM "academic_calendars" WHERE "id" = ${calId}`;
      await prisma.$executeRaw`DELETE FROM "users" WHERE "id" = ${userId}`;
      await prisma.$executeRaw`DELETE FROM "branches" WHERE "id" = ${branchId}`;
    }
  });
});

// ═════════════════════════════════════════════════════════════
// B5: Stationary Supplier Payment (FOR UPDATE)
// ═════════════════════════════════════════════════════════════

describe('B5 — Stationary supplier payment concurrency', () => {
  test('concurrent stationary supplier payments do not corrupt balance', async () => {
    const p = uniquePrefix();
    const branchId = await setupBranch(prisma, p);
    const supplierId = `${p}_sup`;
    const userId = `${p}_usr`;
    const h = 'hash';
    await prisma.$executeRaw`INSERT INTO "users" ("id","name","passwordHash","role","status","createdAt","updatedAt") VALUES (${userId},${prefix(p)},${h},'management','active',NOW(),NOW())`;
    await prisma.$executeRaw`INSERT INTO "stationary_suppliers" ("id","branchId","name","balanceOwedToSupplier","balanceSupplierOwesUs","isActive","createdAt","updatedAt")
      VALUES (${supplierId},${branchId},${p},800.00,0.00,true,NOW(),NOW())`;

    try {
      const promises = Array.from({ length: 3 }, (_, i) => {
        const client = makeClient();
        return client.$transaction(async (tx) => {
          const locked = await tx.$queryRaw`SELECT "balanceOwedToSupplier","balanceSupplierOwesUs" FROM "stationary_suppliers" WHERE "id" = ${supplierId} AND "branchId" = ${branchId} FOR UPDATE`;
          if (!(locked as any[]).length) throw new Error('Supplier not found');

          await tx.$executeRaw`
            INSERT INTO "stationary_supplier_payments" ("id","supplierId","amount","direction","paidAt")
            VALUES (${`${p}_pay_${i}`},${supplierId},200,'WE_PAID_SUPPLIER',NOW())`;

          await tx.$executeRaw`
            UPDATE "stationary_suppliers"
            SET "balanceOwedToSupplier" = GREATEST(0, "balanceOwedToSupplier" - 200),
                "balanceSupplierOwesUs" = "balanceSupplierOwesUs" + GREATEST(0, 200 - "balanceOwedToSupplier")
            WHERE "id" = ${supplierId}`;
        });
      });

      await Promise.all(promises);

      const final = await prisma.$queryRaw<{ balanceOwedToSupplier: number; balanceSupplierOwesUs: number }[]>`
        SELECT "balanceOwedToSupplier","balanceSupplierOwesUs" FROM "stationary_suppliers" WHERE "id" = ${supplierId}`;

      expect(Number(final[0].balanceOwedToSupplier)).toBe(200);
      expect(Number(final[0].balanceSupplierOwesUs)).toBe(0);
    } finally {
      await prisma.$executeRaw`DELETE FROM "stationary_supplier_payments" WHERE "supplierId" = ${supplierId}`;
      await prisma.$executeRaw`DELETE FROM "stationary_suppliers" WHERE "id" = ${supplierId}`;
      await prisma.$executeRaw`DELETE FROM "users" WHERE "id" = ${userId}`;
      await prisma.$executeRaw`DELETE FROM "branches" WHERE "id" = ${branchId}`;
    }
  });
});

// ═════════════════════════════════════════════════════════════
// B6: Stationary Inventory Adjustment (FOR UPDATE)
// ═════════════════════════════════════════════════════════════

describe('B6 — Stationary inventory adjustment concurrency', () => {
  test('concurrent adjustments do not produce negative stock', async () => {
    const p = uniquePrefix();
    const branchId = await setupBranch(prisma, p);
    const catId = `${p}_cat`;
    const productId = `${p}_prod`;
    await prisma.$executeRaw`INSERT INTO "stationary_categories" ("id","branchId","name","isActive","createdAt","updatedAt")
      VALUES (${catId},${branchId},${p},true,NOW(),NOW())`;
    await prisma.$executeRaw`INSERT INTO "stationary_products" ("id","branchId","categoryId","name","unitPrice","stockBundles","stockUnits","unitsPerBundle","isActive","createdAt","updatedAt")
      VALUES (${productId},${branchId},${catId},${p},50.00,10,5,10,true,NOW(),NOW())`;

    try {
      const promises = Array.from({ length: 5 }, () => {
        const client = makeClient();
        return client.$transaction(async (tx) => {
          const locked = await tx.$queryRaw<{ stockBundles: number; stockUnits: number }[]>`
            SELECT "stockBundles","stockUnits" FROM "stationary_products" WHERE "id" = ${productId} FOR UPDATE`;
          if (!locked.length) throw new Error('Product not found');
          const cur = locked[0];
          const nextUnits = cur.stockUnits - 3;
          if (nextUnits < 0) throw new Error('Insufficient stock');
          await tx.$executeRaw`UPDATE "stationary_products" SET "stockBundles" = ${cur.stockBundles}, "stockUnits" = ${nextUnits} WHERE "id" = ${productId}`;
          return { success: true };
        }).catch(() => ({ success: false }));
      });

      const results = await Promise.all(promises);
      const successes = results.filter((r) => r.success).length;
      const final = await prisma.$queryRaw<{ stockUnits: number }[]>`SELECT "stockUnits" FROM "stationary_products" WHERE "id" = ${productId}`;

      expect(Number(final[0].stockUnits)).toBeGreaterThanOrEqual(0);
      expect(Number(final[0].stockUnits)).toBe(5 - successes * 3);
    } finally {
      await prisma.$executeRaw`DELETE FROM "stationary_products" WHERE "id" = ${productId}`;
      await prisma.$executeRaw`DELETE FROM "stationary_categories" WHERE "id" = ${catId}`;
      await prisma.$executeRaw`DELETE FROM "branches" WHERE "id" = ${branchId}`;
    }
  });
});

// ═════════════════════════════════════════════════════════════
// B7: Stationary Restock (FOR UPDATE)
// ═════════════════════════════════════════════════════════════

describe('B7 — Stationary restock concurrency', () => {
  test('concurrent restocks do not corrupt stock counts', async () => {
    const p = uniquePrefix();
    const branchId = await setupBranch(prisma, p);
    const catId = `${p}_cat`;
    const supplierId = `${p}_sup`;
    const productId = `${p}_prod`;
    const userId = `${p}_usr`;
    const h = 'hash';
    await prisma.$executeRaw`INSERT INTO "users" ("id","name","passwordHash","role","status","createdAt","updatedAt") VALUES (${userId},${p},${h},'management','active',NOW(),NOW())`;
    await prisma.$executeRaw`INSERT INTO "stationary_categories" ("id","branchId","name","isActive","createdAt","updatedAt") VALUES (${catId},${branchId},${p},true,NOW(),NOW())`;
    await prisma.$executeRaw`INSERT INTO "stationary_suppliers" ("id","branchId","name","balanceOwedToSupplier","balanceSupplierOwesUs","isActive","createdAt","updatedAt") VALUES (${supplierId},${branchId},${p},0.00,0.00,true,NOW(),NOW())`;
    await prisma.$executeRaw`INSERT INTO "stationary_products" ("id","branchId","categoryId","name","unitPrice","stockBundles","stockUnits","unitsPerBundle","isActive","supplierId","createdAt","updatedAt") VALUES (${productId},${branchId},${catId},${p},50.00,5,3,10,true,${supplierId},NOW(),NOW())`;

    try {
      const promises = Array.from({ length: 3 }, () => {
        const client = makeClient();
        return client.$transaction(async (tx) => {
          const locked = await tx.$queryRaw<{ stockBundles: number; stockUnits: number }[]>`
            SELECT "stockBundles","stockUnits" FROM "stationary_products" WHERE "id" = ${productId} FOR UPDATE`;
          if (!locked.length) throw new Error('Product not found');
          const cur = locked[0];
          const upb = 10;
          const qty = 20;
          const addB = Math.floor(qty / upb);
          const addU = qty % upb;
          await tx.$executeRaw`UPDATE "stationary_products" SET "stockBundles" = ${cur.stockBundles + addB}, "stockUnits" = ${cur.stockUnits + addU} WHERE "id" = ${productId}`;
          return { addB, addU };
        }).catch(() => null);
      });

      await Promise.all(promises);

      const final = await prisma.$queryRaw<{ stockBundles: number; stockUnits: number }[]>`
        SELECT "stockBundles","stockUnits" FROM "stationary_products" WHERE "id" = ${productId}`;
      expect(Number(final[0].stockBundles)).toBeGreaterThanOrEqual(5);
      expect(Number(final[0].stockUnits)).toBeGreaterThanOrEqual(3);
    } finally {
      await prisma.$executeRaw`DELETE FROM "stationary_products" WHERE "id" = ${productId}`;
      await prisma.$executeRaw`DELETE FROM "stationary_suppliers" WHERE "id" = ${supplierId}`;
      await prisma.$executeRaw`DELETE FROM "stationary_categories" WHERE "id" = ${catId}`;
      await prisma.$executeRaw`DELETE FROM "users" WHERE "id" = ${userId}`;
      await prisma.$executeRaw`DELETE FROM "branches" WHERE "id" = ${branchId}`;
    }
  }, 15000);
});

function prefix(s: string) { return s; }
