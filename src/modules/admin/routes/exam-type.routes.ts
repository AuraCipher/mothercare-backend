import { Router, Request, Response, NextFunction } from 'express';
import { examTypeService } from '../services/exam-type.service';
import { requireScope } from '../utils/scope-context';
import { assertExamSessionInScope } from '../utils/exam-scope';

const router = Router();

const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };

router.get('/sessions/:sessionId/types', asyncHandler(async (req: Request, res: Response) => {
  const scope = await requireScope(req, res);
  if (!scope) return;
  await assertExamSessionInScope(req.params.sessionId, scope);
  const types = await examTypeService.findAll(req.params.sessionId);
  res.json({ success: true, data: types });
}));

router.post('/sessions/:sessionId/types', asyncHandler(async (req: Request, res: Response) => {
  const scope = await requireScope(req, res);
  if (!scope) return;
  await assertExamSessionInScope(req.params.sessionId, scope);
  const { name, defaultWeight } = req.body;

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

router.patch('/sessions/:sessionId/types/:typeId', asyncHandler(async (req: Request, res: Response) => {
  const scope = await requireScope(req, res);
  if (!scope) return;
  await assertExamSessionInScope(req.params.sessionId, scope);
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

  const type = await examTypeService.update(req.params.typeId, { name, defaultWeight });
  res.json({ success: true, data: type });
}));

router.delete('/sessions/:sessionId/types/:typeId', asyncHandler(async (req: Request, res: Response) => {
  const scope = await requireScope(req, res);
  if (!scope) return;
  await assertExamSessionInScope(req.params.sessionId, scope);
  const result = await examTypeService.delete(req.params.typeId);
  res.json({ success: true, message: result.message });
}));

export default router;
