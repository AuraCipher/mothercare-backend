import { Router, Request, Response, NextFunction } from 'express';
import { examTypeService } from '../services/exam-type.service';

const router = Router();

const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };

// ═══════════════════════════════════════════════════════════════════
// GET /admin/exam-sessions/:sessionId/exam-types
// List exam types in a session
// ═══════════════════════════════════════════════════════════════════
router.get('/exam-sessions/:sessionId/exam-types', asyncHandler(async (req: Request, res: Response) => {
  const types = await examTypeService.findAll(req.params.sessionId);
  res.json({ success: true, data: types });
}));

// ═══════════════════════════════════════════════════════════════════
// POST /admin/exam-sessions/:sessionId/exam-types
// Create an exam type within a session
// ═══════════════════════════════════════════════════════════════════
router.post('/exam-sessions/:sessionId/exam-types', asyncHandler(async (req: Request, res: Response) => {
  const { name, defaultWeight } = req.body;

  // Validation
  if (!name || typeof name !== 'string' || !name.trim()) {
    res.status(400).json({ success: false, message: 'Exam type name is required' });
    return;
  }

  if (defaultWeight !== undefined && defaultWeight !== null) {
    const w = Number(defaultWeight);
    if (isNaN(w) || w < 0 || w > 100) {
      res.status(400).json({ success: false, message: 'Default weight must be between 0 and 100' });
      return;
    }
  }

  const type = await examTypeService.create(
    req.params.sessionId,
    { name, defaultWeight: defaultWeight ?? undefined },
    (req as any).user?.id,
  );

  res.status(201).json({ success: true, data: type });
}));

// ═══════════════════════════════════════════════════════════════════
// PATCH /admin/exam-sessions/:sessionId/exam-types/:id
// Update an exam type
// ═══════════════════════════════════════════════════════════════════
router.patch('/exam-sessions/:sessionId/exam-types/:id', asyncHandler(async (req: Request, res: Response) => {
  const { name, defaultWeight } = req.body;

  if (name !== undefined && (typeof name !== 'string' || !name.trim())) {
    res.status(400).json({ success: false, message: 'Exam type name cannot be empty' });
    return;
  }

  if (defaultWeight !== undefined && defaultWeight !== null) {
    const w = Number(defaultWeight);
    if (isNaN(w) || w < 0 || w > 100) {
      res.status(400).json({ success: false, message: 'Default weight must be between 0 and 100' });
      return;
    }
  }

  const type = await examTypeService.update(req.params.id, { name, defaultWeight });
  res.json({ success: true, data: type });
}));

// ═══════════════════════════════════════════════════════════════════
// DELETE /admin/exam-sessions/:sessionId/exam-types/:id
// Delete an exam type (blocked if referenced by exams)
// ═══════════════════════════════════════════════════════════════════
router.delete('/exam-sessions/:sessionId/exam-types/:id', asyncHandler(async (req: Request, res: Response) => {
  const result = await examTypeService.delete(req.params.id);
  res.json({ success: true, message: result.message });
}));

export default router;
