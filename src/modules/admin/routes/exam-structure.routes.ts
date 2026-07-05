import { Router, Request, Response, NextFunction } from 'express';
import { examStructureService } from '../services/exam-structure.service';
import { requireScope } from '../utils/scope-context';
import { assertExamInScope, assertExamClassSubjectInScope, assertExamClassInScope } from '../utils/exam-scope';

const router = Router();

const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };

router.post('/exams/:examId/structure', asyncHandler(async (req: Request, res: Response) => {
  const scope = await requireScope(req, res);
  if (!scope) return;
  await assertExamInScope(req.params.examId, scope);
  const structure = await examStructureService.generateStructure(
    req.params.examId,
    (req as any).user?.id,
    req.body?.selections ? { selections: req.body.selections } : undefined,
  );
  res.status(201).json({ success: true, data: structure });
}));

router.get('/exams/:examId/structure', asyncHandler(async (req: Request, res: Response) => {
  const scope = await requireScope(req, res);
  if (!scope) return;
  await assertExamInScope(req.params.examId, scope);
  const structure = await examStructureService.getStructure(req.params.examId);
  res.json({ success: true, data: structure });
}));

router.patch('/structure/classes/:linkId', asyncHandler(async (req: Request, res: Response) => {
  const scope = await requireScope(req, res);
  if (!scope) return;
  await assertExamClassInScope(req.params.linkId, scope);
  const { isActive } = req.body;

  if (typeof isActive !== 'boolean') {
    res.status(400).json({ success: false, message: 'isActive must be a boolean' });
    return;
  }

  const result = await examStructureService.toggleClass(req.params.linkId, isActive);
  res.json({ success: true, data: result });
}));

router.patch('/structure/subjects/:linkId', asyncHandler(async (req: Request, res: Response) => {
  const scope = await requireScope(req, res);
  if (!scope) return;
  await assertExamClassSubjectInScope(req.params.linkId, scope);
  const { isActive } = req.body;

  if (typeof isActive !== 'boolean') {
    res.status(400).json({ success: false, message: 'isActive must be a boolean' });
    return;
  }

  const result = await examStructureService.toggleSubject(req.params.linkId, isActive);
  res.json({ success: true, data: result });
}));

export default router;
