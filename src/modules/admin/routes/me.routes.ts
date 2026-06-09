import { Router, Request, Response, NextFunction } from 'express';
import { academicYearService } from '../services/academic-year.service';
import { branchMemberService } from '../services/branch-member.service';

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

// GET /me/branches — User's branch memberships
router.get('/branches', asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const memberships = await branchMemberService.listUserBranches(userId);
  res.json({ success: true, data: memberships });
}));

export default router;
