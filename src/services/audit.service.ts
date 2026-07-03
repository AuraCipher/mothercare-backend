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

  try {
    await prisma.auditLog.create({
      data: {
        userId: ctx?.userId ?? 'SYSTEM',
        action: params.action,
        module: params.module,
        entity: params.entityType,
        entityId: params.entityId,
        oldValue: (params.oldValue ?? undefined) as any,
        newValue: (params.newValue ?? undefined) as any,
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,
        // Store business context metadata alongside the structured diff
        ...(params.metadata && {
          oldValue: params.oldValue
            ? { ...params.oldValue, _meta: params.metadata }
            : { _meta: params.metadata },
        }),
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
