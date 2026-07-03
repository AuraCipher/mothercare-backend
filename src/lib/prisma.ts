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
 */
export const basePrisma =
  global.prisma ||
  new PrismaClient({
    log: ['query'],
  });

if (process.env.NODE_ENV !== 'production') {
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