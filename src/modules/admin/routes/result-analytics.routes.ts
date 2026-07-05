import { Router, Request, Response, NextFunction } from 'express';
import { resultAnalyticsService } from '../services/result-analytics.service';
import { requireScope } from '../utils/scope-context';
import {
  assertExamSessionInScope,
  assertExamInScope,
  assertGroupInScope,
  assertSubjectInScope,
} from '../utils/exam-scope';

const router = Router();

const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };

router.get('/analytics', asyncHandler(async (req: Request, res: Response) => {
  const scope = await requireScope(req, res);
  if (!scope) return;

  const sessionId = (req.query.sessionId as string) || undefined;
  const examId = (req.query.examId as string) || undefined;
  const classId = (req.query.classId as string) || undefined;
  const subjectId = (req.query.subjectId as string) || undefined;

  if (sessionId) await assertExamSessionInScope(sessionId, scope);
  if (examId) await assertExamInScope(examId, scope);
  if (classId) await assertGroupInScope(classId, scope);
  if (subjectId) await assertSubjectInScope(subjectId, scope);

  const data = await resultAnalyticsService.getAnalytics(scope, {
    sessionId,
    examId,
    classId,
    subjectId,
  });
  res.json({ success: true, data });
}));

export default router;
