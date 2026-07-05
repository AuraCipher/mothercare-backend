import { Router, Request, Response, NextFunction } from 'express';
import { examSessionService } from '../services/exam-session.service';
import { requireScope } from '../utils/scope-context';
import { assertExamSessionInScope } from '../utils/exam-scope';

const router = Router();

const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };

// GET /admin/exam-sessions — List sessions for scoped academic year
router.get('/exam-sessions', asyncHandler(async (req: Request, res: Response) => {
  const scope = await requireScope(req, res);
  if (!scope) return;
  const sessions = await examSessionService.findAll(scope.academicYearId);
  res.json({ success: true, data: sessions });
}));

// POST /admin/exam-sessions — Create session
router.post('/exam-sessions', asyncHandler(async (req: Request, res: Response) => {
  const scope = await requireScope(req, res);
  if (!scope) return;
  const { name, startDate, endDate } = req.body;

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
    scope.academicYearId,
    { name, startDate: new Date(startDate), endDate: new Date(endDate) },
    (req as any).user?.id,
  );

  res.status(201).json({ success: true, data: session });
}));

// GET /admin/exam-sessions/:sessionId
router.get('/exam-sessions/:sessionId', asyncHandler(async (req: Request, res: Response) => {
  const scope = await requireScope(req, res);
  if (!scope) return;
  await assertExamSessionInScope(req.params.sessionId, scope);
  const session = await examSessionService.findById(req.params.sessionId);
  res.json({ success: true, data: session });
}));

// PATCH /admin/exam-sessions/:sessionId
router.patch('/exam-sessions/:sessionId', asyncHandler(async (req: Request, res: Response) => {
  const scope = await requireScope(req, res);
  if (!scope) return;
  await assertExamSessionInScope(req.params.sessionId, scope);
  const { name, startDate, endDate } = req.body;

  if (name !== undefined && (typeof name !== 'string' || !name.trim())) {
    res.status(400).json({ success: false, message: 'Exam session name cannot be empty' });
    return;
  }
  if (startDate && endDate && new Date(startDate) > new Date(endDate)) {
    res.status(400).json({ success: false, message: 'Start date must be before end date' });
    return;
  }

  const session = await examSessionService.update(req.params.sessionId, {
    ...(name !== undefined && { name }),
    ...(startDate !== undefined && { startDate: new Date(startDate) }),
    ...(endDate !== undefined && { endDate: new Date(endDate) }),
  });

  res.json({ success: true, data: session });
}));

// DELETE /admin/exam-sessions/:sessionId
router.delete('/exam-sessions/:sessionId', asyncHandler(async (req: Request, res: Response) => {
  const scope = await requireScope(req, res);
  if (!scope) return;
  await assertExamSessionInScope(req.params.sessionId, scope);
  const result = await examSessionService.delete(req.params.sessionId);
  res.json({ success: true, message: result.message });
}));

export default router;
