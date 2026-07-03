import { Request, Response, NextFunction } from 'express';
import { AsyncLocalStorage } from 'async_hooks';

/**
 * Stores the Express Request object so that the audit service can read
 * `req.user`, `req.ip`, and `req.headers` LAZILY at logAudit() call time.
 *
 * IMPORTANT: We store `req` itself — not a snapshot of userId/IP/userAgent —
 * because auth middleware may populate `req.user` AFTER this middleware runs.
 * Reading from `req` at logAudit() time guarantees the user is current.
 *
 * Safe to mount GLOBALLY (before any auth middleware). Routes without auth
 * simply produce userId: 'SYSTEM'.
 */
export type AuditContext = {
  req: Request;
};

export const auditContextStorage = new AsyncLocalStorage<AuditContext>();

/**
 * Captures the Express Request object via AsyncLocalStorage so the audit
 * service can access request context without manual parameter passing.
 *
 * Mount this ONCE in app.ts, BEFORE all routes. It works with any auth
 * middleware that sets `req.user` — regardless of ordering.
 */
export function auditContextMiddleware(req: Request, _res: Response, next: NextFunction): void {
  auditContextStorage.run({ req }, () => next());
}
