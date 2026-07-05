import { Request, Response, NextFunction } from 'express';
import { prisma } from '../../lib/prisma';

type BranchRole = 'branch_admin' | 'sub_admin' | 'management' | 'teacher' | 'parent' | 'canteen_staff';

/**
 * Middleware that checks if the authenticated user has one of the
 * allowed roles at the branch identified by branchId.
 *
 * branchId is resolved from (in order):
 *   1. req.params.branchId
 *   2. req.body.branchId
 *   3. req.query.branchId as string
 */
export function requireBranchRole(...allowedRoles: BranchRole[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = (req as any).user?.id;
      if (!userId) {
        return res.status(401).json({ success: false, message: 'Authentication required' });
      }

      const branchId = req.params.branchId || req.body?.branchId || (req.query?.branchId as string);
      if (!branchId) {
        return res.status(400).json({ success: false, message: 'branchId is required' });
      }

      const membership = await prisma.branchMember.findUnique({
        where: { branchId_userId: { branchId, userId } },
      });

      if (!membership || !membership.isActive) {
        return res.status(403).json({
          success: false,
          message: 'You are not an active member of this branch',
        });
      }

      if (!allowedRoles.includes(membership.role as BranchRole)) {
        return res.status(403).json({
          success: false,
          message: `Access denied. Required role at this branch: ${allowedRoles.join(' or ')}`,
        });
      }

      // Attach membership for downstream use
      (req as any).branchMember = membership;
      next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Convenience: requires branch_admin role at the branch
 */
export function requireBranchAdmin() {
  return requireBranchRole('branch_admin');
}
