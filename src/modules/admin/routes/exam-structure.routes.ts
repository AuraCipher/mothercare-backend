import { Router, Request, Response, NextFunction } from 'express';
import { examStructureService } from '../services/exam-structure.service';

const router = Router();

const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };

// ═══════════════════════════════════════════════════════════════════
// POST /admin/exams/:id/structure — Generate structure for an exam
// ═══════════════════════════════════════════════════════════════════
router.post('/exams/:id/structure', asyncHandler(async (req: Request, res: Response) => {
  const structure = await examStructureService.generateStructure(
    req.params.id,
    (req as any).user?.id,
  );
  res.status(201).json({ success: true, data: structure });
}));

// ═══════════════════════════════════════════════════════════════════
// GET /admin/exams/:id/structure — Get the structure tree
// ═══════════════════════════════════════════════════════════════════
router.get('/exams/:id/structure', asyncHandler(async (req: Request, res: Response) => {
  const structure = await examStructureService.getStructure(req.params.id);
  res.json({ success: true, data: structure });
}));

// ═══════════════════════════════════════════════════════════════════
// PATCH /admin/exam-classes/:id — Toggle a class on/off
// ═══════════════════════════════════════════════════════════════════
router.patch('/exam-classes/:id', asyncHandler(async (req: Request, res: Response) => {
  const { isActive } = req.body;

  if (typeof isActive !== 'boolean') {
    res.status(400).json({ success: false, message: 'isActive must be a boolean' });
    return;
  }

  const result = await examStructureService.toggleClass(req.params.id, isActive);
  res.json({ success: true, data: result });
}));

// ═══════════════════════════════════════════════════════════════════
// PATCH /admin/exam-class-subjects/:id — Toggle a subject on/off
// ═══════════════════════════════════════════════════════════════════
router.patch('/exam-class-subjects/:id', asyncHandler(async (req: Request, res: Response) => {
  const { isActive } = req.body;

  if (typeof isActive !== 'boolean') {
    res.status(400).json({ success: false, message: 'isActive must be a boolean' });
    return;
  }

  const result = await examStructureService.toggleSubject(req.params.id, isActive);
  res.json({ success: true, data: result });
}));

export default router;
