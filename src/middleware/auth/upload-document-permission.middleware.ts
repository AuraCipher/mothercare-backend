import { Request, Response, NextFunction } from 'express';
import { actionAllowed } from '../../modules/admin/staff-permissions.constants';
import { staffService } from '../../modules/admin/services/staff.service';
import type { CrudAction } from '../../modules/admin/staff-permissions.constants';

function documentActionForRequest(req: Request): CrudAction | null {
  const path = req.path;
  const method = req.method.toUpperCase();

  if (path === '/upload' && method === 'POST') return 'create';
  if (path === '/uploads' && method === 'GET') return 'read';
  if (path.match(/^\/uploads\/[^/]+$/) && method === 'GET') return 'read';
  if (path.match(/^\/uploads\/[^/]+\/meta$/) && method === 'GET') return 'read';
  if (path.match(/^\/uploads\/[^/]+\/rename$/) && method === 'PUT') return 'update';
  if (path.match(/^\/uploads\/[^/]+$/) && method === 'DELETE') return 'delete';
  return null;
}

function getBranchId(req: Request): string | null {
  const q = req.query.branchId as string | undefined;
  const user = (req as any).user;
  if (q) return q;
  if (user?.branchIds?.length === 1) return user.branchIds[0];
  if (user?.branchIds?.length > 0) return user.branchIds[0];
  return null;
}

/** Enforce DOCUMENTS module CRUD for restricted branch staff on /api/upload routes. */
export async function uploadDocumentPermissionMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const user = (req as any).user;
    if (!user) {
      next();
      return;
    }

    const action = documentActionForRequest(req);
    if (!action) {
      next();
      return;
    }

    const branchId = getBranchId(req);
    const access = await staffService.resolveUserAccess(
      user.id,
      branchId || user.branchIds?.[0] || '',
      user.role,
    );
    if (!access.isRestricted || access.isFullAdmin) {
      next();
      return;
    }

    if (!branchId && !user.branchIds?.length) {
      res.status(400).json({ success: false, message: 'branchId is required for document access' });
      return;
    }

    if (actionAllowed(access.permissions, 'DOCUMENTS', action)) {
      next();
      return;
    }

    res.status(403).json({
      success: false,
      message: `No document ${action} permission`,
    });
  } catch (err) {
    next(err);
  }
}
