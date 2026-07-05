import { Router, Request, Response, NextFunction } from 'express';
import { examService } from '../services/exam.service';
import { examSessionService } from '../services/exam-session.service';
import { requireScope } from '../utils/scope-context';
import { assertExamSessionInScope, assertExamInScope } from '../utils/exam-scope';

const router = Router();

const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };

router.get('/sessions/:sessionId/summary', asyncHandler(async (req: Request, res: Response) => {
  const scope = await requireScope(req, res);
  if (!scope) return;
  await assertExamSessionInScope(req.params.sessionId, scope);
  const summary = await examSessionService.getSummary(req.params.sessionId);
  res.json({ success: true, data: summary });
}));

router.get('/sessions/:sessionId/exams', asyncHandler(async (req: Request, res: Response) => {
  const scope = await requireScope(req, res);
  if (!scope) return;
  await assertExamSessionInScope(req.params.sessionId, scope);
  const exams = await examService.findAllBySession(req.params.sessionId);
  res.json({ success: true, data: exams });
}));

router.post('/sessions/:sessionId/exams', asyncHandler(async (req: Request, res: Response) => {
  const scope = await requireScope(req, res);
  if (!scope) return;
  await assertExamSessionInScope(req.params.sessionId, scope);
  const { name, examTypeId, weightOverride, startDate, endDate } = req.body;

  if (!name || typeof name !== 'string' || !name.trim()) {
    res.status(400).json({ success: false, message: 'Exam name is required' });
    return;
  }
  if (!examTypeId) {
    res.status(400).json({ success: false, message: 'Exam type is required' });
    return;
  }
  if (!startDate) {
    res.status(400).json({ success: false, message: 'Start date is required' });
    return;
  }
  if (endDate && new Date(endDate) < new Date(startDate)) {
    res.status(400).json({ success: false, message: 'End date cannot be before start date' });
    return;
  }
  if (weightOverride !== undefined && weightOverride !== null) {
    const w = Number(weightOverride);
    if (isNaN(w) || w < 0 || w > 100) {
      res.status(400).json({ success: false, message: 'Weight override must be between 0 and 100' });
      return;
    }
  }

  const exam = await examService.create(
    req.params.sessionId,
    {
      name,
      examTypeId,
      weightOverride: weightOverride ?? undefined,
      startDate: new Date(startDate),
      endDate: endDate ? new Date(endDate) : undefined,
    },
    (req as any).user?.id,
  );

  res.status(201).json({ success: true, data: exam });
}));

router.get('/exams/:examId', asyncHandler(async (req: Request, res: Response) => {
  const scope = await requireScope(req, res);
  if (!scope) return;
  await assertExamInScope(req.params.examId, scope);
  const exam = await examService.findById(req.params.examId);
  res.json({ success: true, data: exam });
}));

router.patch('/exams/:examId', asyncHandler(async (req: Request, res: Response) => {
  const scope = await requireScope(req, res);
  if (!scope) return;
  await assertExamInScope(req.params.examId, scope);
  const { name, examTypeId, weightOverride, startDate, endDate, status } = req.body;

  if (name !== undefined && (typeof name !== 'string' || !name.trim())) {
    res.status(400).json({ success: false, message: 'Exam name cannot be empty' });
    return;
  }
  if (startDate && endDate && new Date(endDate) < new Date(startDate)) {
    res.status(400).json({ success: false, message: 'End date cannot be before start date' });
    return;
  }
  if (weightOverride !== undefined && weightOverride !== null) {
    const w = Number(weightOverride);
    if (isNaN(w) || w < 0 || w > 100) {
      res.status(400).json({ success: false, message: 'Weight override must be between 0 and 100' });
      return;
    }
  }

  const exam = await examService.update(req.params.examId, {
    ...(name !== undefined && { name }),
    ...(examTypeId !== undefined && { examTypeId }),
    ...(weightOverride !== undefined && { weightOverride }),
    ...(startDate !== undefined && { startDate: new Date(startDate) }),
    ...(endDate !== undefined && { endDate: endDate ? new Date(endDate) : null }),
    ...(status !== undefined && { status }),
  });

  res.json({ success: true, data: exam });
}));

router.delete('/exams/:examId', asyncHandler(async (req: Request, res: Response) => {
  const scope = await requireScope(req, res);
  if (!scope) return;
  await assertExamInScope(req.params.examId, scope);
  const result = await examService.delete(req.params.examId);
  res.json({ success: true, message: result.message });
}));

export default router;
