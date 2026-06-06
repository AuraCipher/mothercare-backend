import { Router, Request, Response, NextFunction } from 'express';
import { academicYearService } from './services/academic-year.service';

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

export default router;
