import { Request, Response, NextFunction } from 'express';
import { prisma } from '../../lib/prisma';
import {
  actionAllowed,
  httpMethodToAction,
  resolveModuleForPath,
} from '../../modules/admin/staff-permissions.constants';
import { staffService } from '../../modules/admin/services/staff.service';

const SKIP_PREFIXES = [
  '/admin/staff',
  '/admin/users',
  '/admin/branches',
  '/admin/calendars',
  '/admin/academic-years',
  '/admin/teachers',
  '/admin/groups',
  '/admin/sections',
  '/admin/subjects',
  '/admin/classes',
  '/me/',
];

function shouldSkipPath(path: string): boolean {
  if (path === '/admin' || path === '/admin/') return true;
  return SKIP_PREFIXES.some((p) => path.startsWith(p));
}

function getBranchId(req: Request): string | null {
  const q = req.query.branchId as string | undefined;
  const b = req.body?.branchId as string | undefined;
  const user = (req as any).user;
  if (q) return q;
  if (b) return b;
  if (user?.branchIds?.length === 1) return user.branchIds[0];
  return null;
}

async function resolveRequestAyArchived(req: Request, branchId: string): Promise<boolean> {
  const ayId = (req.query.academicYearId as string | undefined) || req.body?.academicYearId;
  if (!ayId) return false;
  const ay = await prisma.academicYear.findUnique({
    where: { id: ayId },
    select: { status: true, branchId: true },
  });
  if (!ay || ay.branchId !== branchId) return false;
  return ay.status === 'ARCHIVED';
}

export async function staffPermissionMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const user = (req as any).user;
    if (!user) {
      res.status(401).json({ success: false, message: 'Authentication required' });
      return;
    }

    const path = req.originalUrl.split('?')[0];
    if (shouldSkipPath(path)) {
      next();
      return;
    }

    const module = resolveModuleForPath(path);
    if (!module) {
      next();
      return;
    }

    const branchId = getBranchId(req);
    if (!branchId) {
      res.status(400).json({ success: false, message: 'branchId is required' });
      return;
    }

    const access = await staffService.resolveUserAccess(user.id, branchId, user.role);
    if (!access.isRestricted || access.isFullAdmin) {
      next();
      return;
    }

    const action = httpMethodToAction(req.method);
    const isArchived = await resolveRequestAyArchived(req, branchId);
    if (actionAllowed(access.permissions, module, action, { archived: isArchived })) {
      (req as any).staffPermissions = access.permissions;
      (req as any).scopeIsArchived = isArchived;
      next();
      return;
    }

    res.status(403).json({
      success: false,
      message: `No ${action} permission for ${module.toLowerCase()}${isArchived ? ' (archived year)' : ''}`,
    });
  } catch (err) {
    next(err);
  }
}
