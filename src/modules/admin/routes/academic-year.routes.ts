import { Router, Request, Response, NextFunction } from 'express';
import { academicYearService } from '../services/academic-year.service';
import { prisma } from '../../../lib/prisma';
import batchPromotionRoutes from './batch-promotion.routes';

const router = Router();

const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };

/** Middleware: reject mutations on ARCHIVED academic years */
async function requireNotArchived(req: Request, res: Response, next: NextFunction) {
  try {
    const ayId = req.params.id || req.params.ayId;
    if (!ayId) return next();

    const ay = await prisma.academicYear.findUnique({
      where: { id: ayId },
      select: { status: true },
    });

    if (!ay) {
      return res.status(404).json({ success: false, message: 'Academic year not found' });
    }

    if (ay.status === 'ARCHIVED') {
      return res.status(400).json({ success: false, message: 'Cannot modify an archived academic year' });
    }

    next();
  } catch (err) {
    next(err);
  }
}

// ═══════════════════════════════════════════════════════════════════
// Academic Year CRUD (scoped under branch)
// ═══════════════════════════════════════════════════════════════════

// POST /admin/branches/:branchId/academic-years — Create AY (BA-015)
router.post('/branches/:branchId/academic-years', asyncHandler(async (req: Request, res: Response) => {
  const { calendarId, previousAcademicYearId, directToArchived } = req.body;

  if (!calendarId) {
    res.status(400).json({ success: false, message: 'calendarId is required' });
    return;
  }

  const academicYear = await academicYearService.create({
    branchId: req.params.branchId,
    calendarId,
    previousAcademicYearId,
    directToArchived: directToArchived === true,
    createdById: (req as any).user?.id,
  });

  res.status(201).json({ success: true, data: academicYear });
}));

// GET /admin/branches/:branchId/academic-years — List AYs (BA-016)
router.get('/branches/:branchId/academic-years', asyncHandler(async (req: Request, res: Response) => {
  const { status } = req.query;
  const academicYears = await academicYearService.findAll(
    req.params.branchId,
    status as string | undefined,
  );
  res.json({ success: true, data: academicYears });
}));

// ═══════════════════════════════════════════════════════════════════
// Academic Year CRUD (by ID) — Branch-scoped for RBAC
// ═══════════════════════════════════════════════════════════════════

// GET /admin/branches/:branchId/academic-years/:id — Full detail (BA-017)
router.get('/branches/:branchId/academic-years/:id', asyncHandler(async (req: Request, res: Response) => {
  const academicYear = await academicYearService.findById(req.params.id);
  res.json({ success: true, data: academicYear });
}));

// PUT /admin/branches/:branchId/academic-years/:id — Update AY (BA-018)
router.put('/branches/:branchId/academic-years/:id', requireNotArchived, asyncHandler(async (req: Request, res: Response) => {
  const { previousAcademicYearId } = req.body;
  const academicYear = await academicYearService.update(req.params.id, { previousAcademicYearId });
  res.json({ success: true, data: academicYear });
}));

// PATCH /admin/branches/:branchId/academic-years/:id/publish — Publish AY (BA-019)
router.patch('/branches/:branchId/academic-years/:id/pause', requireNotArchived, asyncHandler(async (req: Request, res: Response) => {
  const result = await academicYearService.pause(req.params.id);
  res.json({ success: true, data: result });
}));

router.patch('/branches/:branchId/academic-years/:id/resume', asyncHandler(async (req: Request, res: Response) => {
  const result = await academicYearService.resume(req.params.id);
  res.json({ success: true, data: result });
}));

router.patch('/branches/:branchId/academic-years/:id/publish', requireNotArchived, asyncHandler(async (req: Request, res: Response) => {
  const academicYear = await academicYearService.publish(req.params.id);
  res.json({ success: true, data: academicYear });
}));

// PATCH /admin/branches/:branchId/academic-years/:id/archive — Archive AY
router.patch('/branches/:branchId/academic-years/:id/archive', requireNotArchived, asyncHandler(async (req: Request, res: Response) => {
  const academicYear = await academicYearService.archive(req.params.id);
  res.json({ success: true, data: academicYear });
}));

// Batch promotion wizard (branch + source AY scoped)
router.use(
  '/branches/:branchId/academic-years/:sourceAcademicYearId/promotion',
  batchPromotionRoutes,
);

// DELETE /admin/branches/:branchId/academic-years/:id — Delete AY (BA-020)
router.delete('/branches/:branchId/academic-years/:id', requireNotArchived, asyncHandler(async (req: Request, res: Response) => {
  await academicYearService.delete(req.params.id);
  res.status(204).json({ success: true, message: 'Academic year deleted' });
}));

// ═══════════════════════════════════════════════════════════════════
// AcademicYear Members (BA-021) — Branch-scoped
// ═══════════════════════════════════════════════════════════════════

// POST /admin/branches/:branchId/academic-years/:ayId/members — Add member
router.post('/branches/:branchId/academic-years/:ayId/members', requireNotArchived, asyncHandler(async (req: Request, res: Response) => {
  const { userId, role } = req.body;

  if (!userId) {
    res.status(400).json({ success: false, message: 'userId is required' });
    return;
  }

  const member = await academicYearService.addMember(req.params.ayId, userId, role || 'teacher');
  res.status(201).json({ success: true, data: member });
}));

// DELETE /admin/branches/:branchId/academic-years/:ayId/members/:userId — Remove member
router.delete('/branches/:branchId/academic-years/:ayId/members/:userId', requireNotArchived, asyncHandler(async (req: Request, res: Response) => {
  await academicYearService.removeMember(req.params.ayId, req.params.userId);
  res.status(204).json({ success: true, message: 'Member removed' });
}));

export default router;
