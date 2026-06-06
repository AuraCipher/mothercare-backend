import { Router, Request, Response, NextFunction } from 'express';
import { academicYearService } from './services/academic-year.service';

const router = Router();

const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };

// ═══════════════════════════════════════════════════════════════════
// Academic Year CRUD (scoped under branch)
// ═══════════════════════════════════════════════════════════════════

// POST /admin/branches/:branchId/academic-years — Create AY (BA-015)
router.post('/branches/:branchId/academic-years', asyncHandler(async (req: Request, res: Response) => {
  const { calendarId, previousAcademicYearId } = req.body;

  if (!calendarId) {
    res.status(400).json({ success: false, message: 'calendarId is required' });
    return;
  }

  const academicYear = await academicYearService.create({
    branchId: req.params.branchId,
    calendarId,
    previousAcademicYearId,
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
// Academic Year CRUD (by ID)
// ═══════════════════════════════════════════════════════════════════

// GET /admin/academic-years/:id — Full detail (BA-017)
router.get('/academic-years/:id', asyncHandler(async (req: Request, res: Response) => {
  const academicYear = await academicYearService.findById(req.params.id);
  res.json({ success: true, data: academicYear });
}));

// PUT /admin/academic-years/:id — Update AY (BA-018)
router.put('/academic-years/:id', asyncHandler(async (req: Request, res: Response) => {
  const { previousAcademicYearId } = req.body;
  const academicYear = await academicYearService.update(req.params.id, { previousAcademicYearId });
  res.json({ success: true, data: academicYear });
}));

// PATCH /admin/academic-years/:id/publish — Publish AY (BA-019)
router.patch('/academic-years/:id/publish', asyncHandler(async (req: Request, res: Response) => {
  const academicYear = await academicYearService.publish(req.params.id);
  res.json({ success: true, data: academicYear });
}));

// PATCH /admin/academic-years/:id/archive — Archive AY
router.patch('/academic-years/:id/archive', asyncHandler(async (req: Request, res: Response) => {
  const academicYear = await academicYearService.archive(req.params.id);
  res.json({ success: true, data: academicYear });
}));

// DELETE /admin/academic-years/:id — Delete AY (BA-020)
router.delete('/academic-years/:id', asyncHandler(async (req: Request, res: Response) => {
  await academicYearService.delete(req.params.id);
  res.status(204).json({ success: true, message: 'Academic year deleted' });
}));

// ═══════════════════════════════════════════════════════════════════
// AcademicYear Members (BA-021)
// ═══════════════════════════════════════════════════════════════════

// POST /admin/academic-years/:ayId/members — Add member
router.post('/academic-years/:ayId/members', asyncHandler(async (req: Request, res: Response) => {
  const { userId, role } = req.body;

  if (!userId) {
    res.status(400).json({ success: false, message: 'userId is required' });
    return;
  }

  const member = await academicYearService.addMember(req.params.ayId, userId, role || 'teacher');
  res.status(201).json({ success: true, data: member });
}));

// DELETE /admin/academic-years/:ayId/members/:userId — Remove member
router.delete('/academic-years/:ayId/members/:userId', asyncHandler(async (req: Request, res: Response) => {
  await academicYearService.removeMember(req.params.ayId, req.params.userId);
  res.status(204).json({ success: true, message: 'Member removed' });
}));

export default router;
