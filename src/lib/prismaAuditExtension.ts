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
const AUDITED_MODELS = new Set([
  'Student',
  'TeacherProfile',
  'Group',
  'Subject',
  'FeeHead',
  'FeeStructure',
  'StudentFee',
  'Payment',
  'Enrollment',
  'Announcement',
  'Message',
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
