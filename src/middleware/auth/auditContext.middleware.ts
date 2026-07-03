import { Request, Response, NextFunction } from 'express';
import { AsyncLocalStorage } from 'async_hooks';

export type AuditContext = {
  userId: string;
  ipAddress: string;
  userAgent: string;
};

export const auditContextStorage = new AsyncLocalStorage<AuditContext>();

/**
 * Captures authenticated request context (userId, IP, userAgent) via AsyncLocalStorage
 * so the audit service can log without manual parameter passing.
 *
 * Must be registered AFTER auth middleware so req.user is populated.
 * Safe to mount globally — reads whatever is available, defaults to 'SYSTEM'.
 */
export function auditContextMiddleware(req: Request, _res: Response, next: NextFunction): void {
  const context: AuditContext = {
    userId: (req as any).user?.id ?? 'SYSTEM',
    ipAddress: req.ip ?? req.socket?.remoteAddress ?? '',
    userAgent: (req.headers['user-agent'] as string) ?? '',
  };
  auditContextStorage.run(context, () => next());
}
