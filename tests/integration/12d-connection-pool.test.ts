/**
 * TASK 12A — Section D: Connection / Pool Behavior
 *
 * Verifies connection pool works correctly with connection_limit=12.
 */
import { PrismaClient } from '@prisma/client';
import { createTestPrisma, uniquePrefix, disconnect } from './helpers';

describe('D1 — Connection pool behavior', () => {
  test('connection_limit=12 does not cause errors under moderate load', async () => {
    const prisma = createTestPrisma();
    try {
      const promises = Array.from({ length: 12 }, () => {
        return prisma.$queryRaw`SELECT 1 as ok`;
      });

      const results = await Promise.all(promises);
      expect(results).toHaveLength(12);
      for (const r of results) {
        expect((r as any[])[0].ok).toBe(1);
      }
    } finally {
      await disconnect(prisma);
    }
  });

  test('operations complete without connection leak', async () => {
    const prisma = createTestPrisma();
    try {
      for (let i = 0; i < 20; i++) {
        const result = await prisma.$queryRaw<{ ok: number }[]>`SELECT 1 as ok`;
        expect(result[0].ok).toBe(1);
      }
    } finally {
      await disconnect(prisma);
    }
  });

  test('transaction operations do not leak connections', async () => {
    const prisma = createTestPrisma();
    try {
      for (let i = 0; i < 10; i++) {
        await prisma.$transaction(async (tx) => {
          const result = await tx.$queryRaw<{ ok: number }[]>`SELECT 1 as ok`;
          expect(result[0].ok).toBe(1);
        });
      }
    } finally {
      await disconnect(prisma);
    }
  });

  test('concurrent transactions do not exceed pool capacity', async () => {
    const prisma = createTestPrisma();
    try {
      const promises = Array.from({ length: 12 }, () => {
        return prisma.$transaction(async (tx) => {
          const result = await tx.$queryRaw<{ ok: number }[]>`SELECT 1 as ok`;
          return result[0].ok;
        });
      });

      const results = await Promise.all(promises);
      expect(results).toHaveLength(12);
      expect(results.every((r) => r === 1)).toBe(true);
    } finally {
      await disconnect(prisma);
    }
  });

  test('connection pool recovers after burst', async () => {
    const prisma = createTestPrisma();
    try {
      const burst = Array.from({ length: 20 }, () => {
        return prisma.$queryRaw<{ ok: number }[]>`SELECT 1 as ok`;
      });
      const results = await Promise.all(burst);
      expect(results).toHaveLength(20);

      for (let i = 0; i < 5; i++) {
        const result = await prisma.$queryRaw<{ ok: number }[]>`SELECT 1 as ok`;
        expect(result[0].ok).toBe(1);
      }
    } finally {
      await disconnect(prisma);
    }
  });
});
