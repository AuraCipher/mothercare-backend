import { Router, Request, Response, NextFunction } from 'express';
import { examStructureService } from '../services/exam-structure.service';
import { requireScope } from '../utils/scope-context';
import { assertExamInScope, assertExamClassSubjectInScope, assertExamClassInScope } from '../utils/exam-scope';

const router = Router();

const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };

router.post('/exams/:id/structure', asyncHandler(async (req: Request, res: Response) => {
  const scope = await requireScope(req, res);
  if (!scope) return;
  await assertExamInScope(req.params.id, scope);
  const structure = await examStructureService.generateStructure(
    req.params.id,
    (req as any).user?.id,
  );
  res.status(201).json({ success: true, data: structure });
}));

router.get('/exams/:id/structure', asyncHandler(async (req: Request, res: Response) => {
  const scope = await requireScope(req, res);
  if (!scope) return;
  await assertExamInScope(req.params.id, scope);
  const structure = await examStructureService.getStructure(req.params.id);
  res.json({ success: true, data: structure });
}));

router.patch('/exam-classes/:id', asyncHandler(async (req: Request, res: Response) => {
  const scope = await requireScope(req, res);
  if (!scope) return;
  await assertExamClassInScope(req.params.id, scope);
  const { isActive } = req.body;

  if (typeof isActive !== 'boolean') {
    res.status(400).json({ success: false, message: 'isActive must be a boolean' });
    return;
  }

  const result = await examStructureService.toggleClass(req.params.id, isActive);
  res.json({ success: true, data: result });
}));

router.patch('/exam-class-subjects/:id', asyncHandler(async (req: Request, res: Response) => {
  const scope = await requireScope(req, res);
  if (!scope) return;
  await assertExamClassSubjectInScope(req.params.id, scope);
  const { isActive } = req.body;

  if (typeof isActive !== 'boolean') {
    res.status(400).json({ success: false, message: 'isActive must be a boolean' });
    return;
  }

  const result = await examStructureService.toggleSubject(req.params.id, isActive);
  res.json({ success: true, data: result });
}));

export default router;
