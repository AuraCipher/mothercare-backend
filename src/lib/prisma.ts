import { PrismaClient } from '@prisma/client';
import { createAuditExtension } from './prismaAuditExtension';

declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClient | undefined;
}

/**
 * Base (non-extended) Prisma client.
 * Use this when `$extends` type incompatibility surfaces — e.g.
 * `$transaction` callbacks that type-check against TransactionClient.
 *
 * Most code should import the extended `prisma` below.
 *
 * NOTE ON TEST ISOLATION: the global.prisma cache below is a dev-only
 * convenience (avoids exhausting Postgres connections on every hot
 * reload). It must never be read or written in NODE_ENV=test, since
 * `global` is a real Node object shared across every test file scheduled
 * onto the same Jest worker, while each file otherwise gets its own
 * fresh module registry. This guard is defensive hardening, not the fix
 * for the mass test failure investigated on 2026-07-04 — that failure's
 * actual cause was jest-mock-extended's mockDeep() generating `$extends`
 * as a bare jest.fn() with no return value, so createAuditExtension()
 * below received `undefined` back from `basePrisma.$extends(...)` at
 * module-load time. The real fix lives in tests/mocks/prisma.ts
 * (`$extends.mockReturnValue(prismaMock)`). This guard stays because a
 * global cache leaking across parallel test workers is still a latent
 * risk worth closing, even though it wasn't what broke this run.
 */
export const basePrisma =
  (process.env.NODE_ENV !== 'test' && global.prisma) ||
  new PrismaClient({
    log: ['query'],
  });

if (process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test') {
  global.prisma = basePrisma;
}

/**
 * Extended Prisma client with supplementary audit extension applied.
 *
 * The extension auto-populates `createdById` / `updatedById` on models
 * listed in prismaAuditExtension.ts. This is the stated exception to the
 * "explicit logAudit() only" rule (see Decisions.md).
 *
 * Use this exported `prisma` everywhere — it is a drop-in replacement
 * for the base PrismaClient with no breaking changes.
 * For `$transaction` callbacks, import `basePrisma` instead.
 */
export const prisma = createAuditExtension(basePrisma);
