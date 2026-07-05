import { Request, Response, NextFunction } from 'express';
import { prisma } from '../../lib/prisma';
import { staffService } from '../admin/services/staff.service';

export type CanteenAccessLevel = 'admin' | 'sales';

const ADMIN_BRANCH_ROLES = new Set([
  'branch_admin',
  'sub_admin',
  'management',
]);

function resolveBranchId(req: Request): string | undefined {
  return (
    (req.query.branchId as string) ||
    req.body?.branchId ||
    req.params.branchId ||
    undefined
  );
}

/** Require branchId and branch membership; sets req.canteenBranchId and req.canteenAccessLevel. */
export async function requireCanteenBranch(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const user = (req as any).user;
    if (!user?.id) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    const branchId = resolveBranchId(req);
    if (!branchId) {
      return res.status(400).json({ success: false, message: 'branchId is required' });
    }

    if (user.role === 'super_admin') {
      (req as any).canteenBranchId = branchId;
      (req as any).canteenAccessLevel = 'admin';
      return next();
    }

    if (user.branchIds && !user.branchIds.includes(branchId)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied: you do not have access to this branch',
      });
    }

    const membership = await prisma.branchMember.findUnique({
      where: { branchId_userId: { branchId, userId: user.id } },
    });

    if (!membership?.isActive) {
      return res.status(403).json({
        success: false,
        message: 'You are not an active member of this branch',
      });
    }

    const access = await staffService.resolveUserAccess(user.id, branchId, user.role);
    if (access.isRestricted) {
      const canteen = access.permissions.find((p) => p.module === 'CANTEEN');
      if (!canteen?.canRead) {
        return res.status(403).json({
          success: false,
          message: 'No canteen module access for this branch',
        });
      }
      const level: CanteenAccessLevel =
        canteen.canUpdate || canteen.canDelete ? 'admin' : 'sales';
      (req as any).canteenBranchId = branchId;
      (req as any).canteenAccessLevel = level;
      (req as any).branchMember = membership;
      return next();
    }

    if (ADMIN_BRANCH_ROLES.has(membership.role)) {
      (req as any).canteenBranchId = branchId;
      (req as any).canteenAccessLevel = 'admin';
      (req as any).branchMember = membership;
      return next();
    }

    if (membership.role === 'canteen_staff') {
      (req as any).canteenBranchId = branchId;
      (req as any).canteenAccessLevel = 'sales';
      (req as any).branchMember = membership;
      return next();
    }

    return res.status(403).json({
      success: false,
      message: 'Canteen access requires admin or canteen_staff role at this branch',
    });
  } catch (err) {
    next(err);
  }
}

export function requireCanteenAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  if ((req as any).canteenAccessLevel === 'admin') return next();
  return res.status(403).json({
    success: false,
    message: 'Admin canteen access required',
  });
}

export function requireCanteenSales(
  _req: Request,
  _res: Response,
  next: NextFunction,
) {
  next();
}

export function getCanteenBranchId(req: Request): string {
  return (req as any).canteenBranchId as string;
}

export function getCanteenUserId(req: Request): string | undefined {
  return (req as any).user?.id;
}
