import { Request, Response, NextFunction } from 'express';

/**
 * Middleware that verifies the requesting user or API key has access
 * to the branch they're trying to access.
 *
 * branchId is resolved from (in order):
 *   1. req.params.branchId
 *   2. req.params.id (for /admin/branches/:id patterns)
 *   3. req.body.branchId
 *   4. req.query.branchId as string
 *
 * If no branchId is found in the request, the middleware skips
 * (the route is likely a CEO-only route like /admin/stats).
 *
 * For JWT auth: checks req.user.branchIds array
 * For API key auth: checks key.branchId (null = global access)
 */
export function branchScopeMiddleware(req: Request, res: Response, next: NextFunction) {
  try {
    // Extract branchId from request
    const branchId = req.params.branchId ||
      req.params.id ||
      req.body?.branchId ||
      (req.query?.branchId as string);

    // No branchId in this request → not a branch-scoped route → skip
    if (!branchId) {
      return next();
    }

    // ─── JWT Auth Check ────────────────────────────────────────────
    const user = (req as any).user;
    if (user && user.branchIds) {
      if (user.branchIds.includes(branchId)) {
        return next();
      }

      // Allow super_admin even if branchId not in their list
      if (user.role === 'super_admin') {
        return next();
      }

      return res.status(403).json({
        success: false,
        message: 'Access denied: you do not have access to this branch',
      });
    }

    // ─── API Key Auth Check ───────────────────────────────────────
    const apiKey = (req as any).apiKey;
    if (apiKey) {
      // Global key (no branch scope) → allow
      if (!apiKey.branchId) {
        return next();
      }
      // Scoped key → must match
      if (apiKey.branchId === branchId) {
        return next();
      }
      return res.status(403).json({
        success: false,
        message: 'Access denied: this API key is scoped to a different branch',
      });
    }

    // No auth context → let auth middleware handle it
    next();
  } catch (err) {
    next(err);
  }
}
