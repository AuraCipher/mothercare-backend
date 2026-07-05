import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../../../lib/prisma';
import { academicYearService } from '../services/academic-year.service';
import { branchMemberService } from '../services/branch-member.service';
import { staffService } from '../services/staff.service';

const router = Router();

const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };

// GET /me/academic-year — Current user's ACTIVE academic year (BA-023)
router.get('/academic-year', asyncHandler(async (req: Request, res: Response) => {
  // req.user is set by auth middleware
  const userId = (req as any).user.id;
  const activeAy = await academicYearService.findCurrentAcademicYear(userId);
  res.json({ success: true, data: activeAy });
}));

// GET /me/branches — User's branch memberships (all branches for super_admin)
router.get('/branches', asyncHandler(async (req: Request, res: Response) => {
  const user = (req as any).user;
  if (user?.role === 'super_admin') {
    const allBranches = await prisma.branch.findMany({ where: { isActive: true } });
    res.json({
      success: true,
      data: allBranches.map(b => ({ branch: b, role: 'super_admin' })),
    });
    return;
  }
  const memberships = await branchMemberService.listUserBranches(user.id);
  res.json({ success: true, data: memberships });
}));

// GET /me/permissions — Module access for active branch (staff RBAC)
router.get('/permissions', asyncHandler(async (req: Request, res: Response) => {
  const user = (req as any).user;
  const branchId = (req.query.branchId as string) || user.branchIds?.[0];
  if (!branchId) {
    res.status(400).json({ success: false, message: 'branchId is required' });
    return;
  }
  const access = await staffService.resolveUserAccess(user.id, branchId, user.role);
  res.json({ success: true, data: { branchId, ...access } });
}));

export default router;
