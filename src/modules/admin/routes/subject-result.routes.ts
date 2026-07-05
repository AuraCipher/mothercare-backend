import { Router, Request, Response, NextFunction } from 'express';
import { subjectResultService } from '../services/subject-result.service';
import { requireScope } from '../utils/scope-context';
import {
  assertExamSessionInScope,
  assertGroupInScope,
  assertSubjectInScope,
} from '../utils/exam-scope';

const router = Router();

const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };

router.post('/sessions/:sessionId/compute-results', asyncHandler(async (req: Request, res: Response) => {
  const scope = await requireScope(req, res);
  if (!scope) return;
  await assertExamSessionInScope(req.params.sessionId, scope);
  const result = await subjectResultService.computeForSession(req.params.sessionId, scope);
  res.json({ success: true, data: result });
}));

router.post('/sessions/:sessionId/classes/:classId/subjects/:subjectId/compute', asyncHandler(async (req: Request, res: Response) => {
  const scope = await requireScope(req, res);
  if (!scope) return;
  await assertExamSessionInScope(req.params.sessionId, scope);
  await assertGroupInScope(req.params.classId, scope);
  await assertSubjectInScope(req.params.subjectId, scope);
  const results = await subjectResultService.computeForClass(
    req.params.classId,
    req.params.sessionId,
    req.params.subjectId,
    scope,
  );
  res.json({ success: true, data: results });
}));

router.get('/sessions/:sessionId/classes/:classId/results', asyncHandler(async (req: Request, res: Response) => {
  const scope = await requireScope(req, res);
  if (!scope) return;
  await assertExamSessionInScope(req.params.sessionId, scope);
  await assertGroupInScope(req.params.classId, scope);
  const sheet = await subjectResultService.getClassResults(
    req.params.classId,
    req.params.sessionId,
    scope,
  );
  res.json({ success: true, data: sheet });
}));

router.get('/students/:studentId/sessions/:sessionId/subjects/:subjectId', asyncHandler(async (req: Request, res: Response) => {
  const scope = await requireScope(req, res);
  if (!scope) return;
  const result = await subjectResultService.getResult(
    req.params.studentId,
    req.params.sessionId,
    req.params.subjectId,
    scope,
  );
  res.json({ success: true, data: result });
}));

export default router;
