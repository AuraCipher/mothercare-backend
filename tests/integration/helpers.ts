/**
 * Real PostgreSQL integration test helpers.
 *
 * Provides Prisma clients connected to a dedicated test database (mcs_test)
 * on the local Docker PostgreSQL instance. All test data is scoped by a unique
 * prefix to enable parallel-safe cleanup.
 */
import { PrismaClient } from '@prisma/client';

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ||
  'postgresql://mcs:mcs_dev_password@localhost:5434/mcs_test?connection_limit=12';

let _counter = 0;

/**
 * Create a fresh PrismaClient connected to the test database.
 * Each call creates a new connection — use sparingly for concurrency tests.
 */
export function createTestPrisma(): PrismaClient {
  return new PrismaClient({
    datasources: { db: { url: TEST_DB_URL } },
    log: [],
  });
}

/**
 * Generate a unique prefix for test data isolation.
 * Each test file gets a unique prefix like `t1a2`, `t1a3`, etc.
 */
export function uniquePrefix(): string {
  return `t${process.pid}${String(++_counter).padStart(3, '0')}`;
}

/**
 * Helper: generate deterministic IDs within a prefix scope.
 */
export function testId(prefix: string, kind: string, seq: number): string {
  return `${prefix}_${kind}_${seq}`;
}

/**
 * Wait for a promise to settle (used in concurrency tests).
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Run N concurrent async operations and return all results/errors.
 * Each operation gets its own PrismaClient to simulate true connection-level concurrency.
 */
export async function runConcurrent<T>(
  operations: ((prisma: PrismaClient) => Promise<T>)[],
): Promise<{ results: (T | null)[]; errors: (Error | null)[] }> {
  const prismaClients = operations.map(() => createTestPrisma());
  try {
    const settled = await Promise.allSettled(
      operations.map((op, i) => op(prismaClients[i])),
    );
    return {
      results: settled.map((s) => (s.status === 'fulfilled' ? s.value : null)),
      errors: settled.map((s) =>
        s.status === 'rejected'
          ? s.reason instanceof Error
            ? s.reason
            : new Error(String(s.reason))
          : null,
      ),
    };
  } finally {
    await Promise.all(prismaClients.map((p) => p.$disconnect()));
  }
}

/**
 * Disconnect a Prisma client safely.
 */
export async function disconnect(prisma: PrismaClient): Promise<void> {
  try {
    await prisma.$disconnect();
  } catch {}
}
