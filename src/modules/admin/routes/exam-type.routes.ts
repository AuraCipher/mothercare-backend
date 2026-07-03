import { Router, Request, Response, NextFunction } from 'express';
import { examTypeService } from '../services/exam-type.service';

const router = Router();

const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };

// ═══════════════════════════════════════════════════════════════════
// GET /admin/exam-types — List all exam types
// ═══════════════════════════════════════════════════════════════════
router.get('/exam-types', asyncHandler(async (_req: Request, res: Response) => {
  const types = await examTypeService.findAll();
  res.json({ success: true, data: types });
}));

// ═══════════════════════════════════════════════════════════════════
// GET /admin/exam-types/:id — Get one exam type
// ═══════════════════════════════════════════════════════════════════
router.get('/exam-types/:id', asyncHandler(async (req: Request, res: Response) => {
  const type = await examTypeService.findById(req.params.id);
  res.json({ success: true, data: type });
}));

// ═══════════════════════════════════════════════════════════════════
// POST /admin/exam-types — Create a new exam type
// ═══════════════════════════════════════════════════════════════════
router.post('/exam-types', asyncHandler(async (req: Request, res: Response) => {
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
    { name, defaultWeight: defaultWeight ?? undefined },
    (req as any).user?.id,
  );

  res.status(201).json({ success: true, data: type });
}));

// ═══════════════════════════════════════════════════════════════════
// PATCH /admin/exam-types/:id — Update an exam type
// ═══════════════════════════════════════════════════════════════════
router.patch('/exam-types/:id', asyncHandler(async (req: Request, res: Response) => {
  const { name, defaultWeight } = req.body;

  // Validation
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
// DELETE /admin/exam-types/:id — Delete an exam type (blocked if in use)
// ═══════════════════════════════════════════════════════════════════
router.delete('/exam-types/:id', asyncHandler(async (req: Request, res: Response) => {
  const result = await examTypeService.delete(req.params.id);
  res.json({ success: true, message: result.message });
}));

export default router;
