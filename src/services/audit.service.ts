import { prisma } from '../lib/prisma';
import { auditContextStorage } from '../middleware/auth/auditContext.middleware';

// ─── Types ────────────────────────────────────────────────────────────

export type LogAuditParams = {
  /** 'CREATE' | 'UPDATE' | 'DELETE' or custom like 'password_reset' */
  action: string;
  /** Domain area: 'exams', 'fees', 'users', 'attendance', 'rbac', etc. */
  module: string;
  /** Model name: 'TeacherProfile', 'MarksEntry', 'Payment', etc. */
  entityType: string;
  /** UUID of the affected record */
  entityId: string;
  /** Snapshot before the change (null on CREATE) */
  oldValue?: Record<string, unknown> | null;
  /** Snapshot after the change (null on DELETE) */
  newValue?: Record<string, unknown> | null;
  /** Business context — e.g. "marks corrected due to teacher error" */
  metadata?: Record<string, unknown>;
};

// ─── Main Audit Logger ────────────────────────────────────────────────

/**
 * Write an audit log entry.
 *
 * Always best-effort — never crashes the primary operation.
 * Context (userId, IP, userAgent) is pulled from AsyncLocalStorage
 * automatically; no need to pass it in manually.
 */
export async function logAudit(params: LogAuditParams): Promise<void> {
  const ctx = auditContextStorage.getStore();
  const req = ctx?.req;

  // Read userId/IP/userAgent lazily from the stored Request object.
  // This is safe even when auditContextMiddleware ran BEFORE auth middleware —
  // by the time logAudit() is called, auth has already populated req.user.
  // When no auth context is available (background job, script), userId stays null
  // and the DB stores NULL — the FK is nullable with ON DELETE SET NULL.
  const userId: string | null = req ? ((req as any).user?.id ?? null) : null;
  const ipAddress: string = req?.ip ?? req?.socket?.remoteAddress ?? '';
  const userAgent: string = (req?.headers?.['user-agent'] as string) ?? '';

  try {
    await prisma.auditLog.create({
      data: {
        userId,
        action: params.action,
        module: params.module,
        entity: params.entityType,
        entityId: params.entityId,
        oldValue: (params.oldValue ?? undefined) as any,
        newValue: (params.newValue ?? undefined) as any,
        metadata: (params.metadata ?? undefined) as any,
        ipAddress,
        userAgent,
      },
    });
  } catch (error) {
    // Best-effort: log the failure but never throw
    // In production, consider wiring this to a metrics counter
    console.error('[AuditLog] Failed to write entry:', error instanceof Error ? error.message : error);
  }
}

// ─── Diff Helper ──────────────────────────────────────────────────────

/**
 * Compares two objects and returns only the fields that changed.
 * Useful before calling logAudit({ action: 'UPDATE', … }) to keep
 * oldValue / newValue lean.
 *
 * @example
 * const { oldChanged, newChanged } = diffFields(existing, updated);
 * await logAudit({ action: 'UPDATE', oldValue: oldChanged, newValue: newChanged, … });
 */
export function diffFields(
  oldObj: Record<string, unknown>,
  newObj: Record<string, unknown>,
): { oldChanged: Record<string, unknown>; newChanged: Record<string, unknown> } {
  const oldChanged: Record<string, unknown> = {};
  const newChanged: Record<string, unknown> = {};

  for (const key of Object.keys(newObj)) {
    if (oldObj[key] !== newObj[key]) {
      oldChanged[key] = oldObj[key];
      newChanged[key] = newObj[key];
    }
  }

  return { oldChanged, newChanged };
}
