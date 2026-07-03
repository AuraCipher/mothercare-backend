import { PrismaClient } from '@prisma/client';
import { auditContextStorage } from '../middleware/auth/auditContext.middleware';

/**
 * Models that have `createdById` / `updatedById` fields should be listed here.
 * The extension will auto-populate those fields on create/update when an audit
 * context (userId) is available.
 *
 * This is LOW-STAKES supplementary metadata — it does NOT replace explicit
 * logAudit() calls for the proper audit trail. See Decisions.md for rationale.
 */
/**
 * Models confirmed to have both `createdById` and `updatedById` scalar fields.
 *
 * To add a model: verify the Prisma schema has both fields, then add it here.
 * ⚠️ Adding a model WITHOUT these fields will cause a Prisma runtime error
 *    ("Unknown argument `createdById`") on every create/update.
 *
 * Skipped / pending:
 *   FeeHead, FeeStructure, StudentFee, Payment, Announcement, Message
 *   — these models don't yet have createdById/updatedById fields.
 */
const AUDITED_MODELS = new Set([
  'Student',
  'TeacherProfile',
  'Group',
  'Subject',
  'Enrollment',
  'Timetable',
  'TimetableSlot',
  'TimetableEntry',
]);

/**
 * Creates a Prisma client extension that auto-populates `createdById` on
 * create and `updatedById` on create/update for the models listed above.
 *
 * Safe to use on public/unauthenticated routes — the extension reads
 * from AsyncLocalStorage and simply does nothing when no audit context
 * is active.
 */
export function createAuditExtension(prisma: PrismaClient) {
  return prisma.$extends({
    query: {
      $allModels: {
        async create({ model, args, query }) {
          if (AUDITED_MODELS.has(model)) {
            const ctx = auditContextStorage.getStore();
            if (ctx?.userId) {
              // TypeScript doesn't know the shape of args.data for an arbitrary model,
              // but Prisma accepts unknown key-value pairs gracefully here.
              (args.data as Record<string, unknown>).createdById = ctx.userId;
              (args.data as Record<string, unknown>).updatedById = ctx.userId;
            }
          }
          return query(args);
        },

        async update({ model, args, query }) {
          if (AUDITED_MODELS.has(model)) {
            const ctx = auditContextStorage.getStore();
            if (ctx?.userId) {
              (args.data as Record<string, unknown>).updatedById = ctx.userId;
            }
          }
          return query(args);
        },
      },
    },
  });
}
