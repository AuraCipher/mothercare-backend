import { Router, Request, Response, NextFunction } from 'express';
import { examSessionService } from '../services/exam-session.service';

const router = Router();

const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };

// ═══════════════════════════════════════════════════════════════════
// GET /admin/branches/:branchId/academic-years/:ayId/exam-sessions
// List all exam sessions in an academic year
// ═══════════════════════════════════════════════════════════════════
router.get('/branches/:branchId/academic-years/:ayId/exam-sessions', asyncHandler(async (req: Request, res: Response) => {
  const sessions = await examSessionService.findAll(req.params.ayId);
  res.json({ success: true, data: sessions });
}));

// ═══════════════════════════════════════════════════════════════════
// POST /admin/branches/:branchId/academic-years/:ayId/exam-sessions
// Create a new exam session
// ═══════════════════════════════════════════════════════════════════
router.post('/branches/:branchId/academic-years/:ayId/exam-sessions', asyncHandler(async (req: Request, res: Response) => {
  const { name, startDate, endDate } = req.body;

  // Validation
  if (!name || typeof name !== 'string' || !name.trim()) {
    res.status(400).json({ success: false, message: 'Exam session name is required' });
    return;
  }
  if (!startDate) {
    res.status(400).json({ success: false, message: 'Start date is required' });
    return;
  }
  if (!endDate) {
    res.status(400).json({ success: false, message: 'End date is required' });
    return;
  }
  if (new Date(startDate) > new Date(endDate)) {
    res.status(400).json({ success: false, message: 'Start date must be before end date' });
    return;
  }

  const session = await examSessionService.create(
    req.params.ayId,
    { name, startDate: new Date(startDate), endDate: new Date(endDate) },
    (req as any).user?.id,
  );

  res.status(201).json({ success: true, data: session });
}));

// ═══════════════════════════════════════════════════════════════════
// GET /admin/branches/:branchId/exam-sessions/:id
// Get an exam session by ID
// ═══════════════════════════════════════════════════════════════════
router.get('/branches/:branchId/exam-sessions/:id', asyncHandler(async (req: Request, res: Response) => {
  const session = await examSessionService.findById(req.params.id);
  res.json({ success: true, data: session });
}));

// ═══════════════════════════════════════════════════════════════════
// PATCH /admin/branches/:branchId/exam-sessions/:id
// Update an exam session
// ═══════════════════════════════════════════════════════════════════
router.patch('/branches/:branchId/exam-sessions/:id', asyncHandler(async (req: Request, res: Response) => {
  const { name, startDate, endDate } = req.body;

  if (name !== undefined && (typeof name !== 'string' || !name.trim())) {
    res.status(400).json({ success: false, message: 'Exam session name cannot be empty' });
    return;
  }
  if (startDate && endDate && new Date(startDate) > new Date(endDate)) {
    res.status(400).json({ success: false, message: 'Start date must be before end date' });
    return;
  }

  const session = await examSessionService.update(req.params.id, {
    ...(name !== undefined && { name }),
    ...(startDate !== undefined && { startDate: new Date(startDate) }),
    ...(endDate !== undefined && { endDate: new Date(endDate) }),
  });

  res.json({ success: true, data: session });
}));

// ═══════════════════════════════════════════════════════════════════
// DELETE /admin/branches/:branchId/exam-sessions/:id
// Delete an exam session (blocked if exams or results exist)
// ═══════════════════════════════════════════════════════════════════
router.delete('/branches/:branchId/exam-sessions/:id', asyncHandler(async (req: Request, res: Response) => {
  const result = await examSessionService.delete(req.params.id);
  res.json({ success: true, message: result.message });
}));

export default router;
