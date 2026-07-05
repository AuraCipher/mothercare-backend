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

// POST /admin/exam-sessions/:id/compute-results
router.post('/exam-sessions/:id/compute-results', asyncHandler(async (req: Request, res: Response) => {
  const scope = await requireScope(req, res);
  if (!scope) return;
  await assertExamSessionInScope(req.params.id, scope);
  const result = await subjectResultService.computeForSession(req.params.id, scope);
  res.json({ success: true, data: result });
}));

// POST /admin/exam-sessions/:id/classes/:classId/subjects/:subjectId/compute
router.post('/exam-sessions/:id/classes/:classId/subjects/:subjectId/compute', asyncHandler(async (req: Request, res: Response) => {
  const scope = await requireScope(req, res);
  if (!scope) return;
  await assertExamSessionInScope(req.params.id, scope);
  await assertGroupInScope(req.params.classId, scope);
  await assertSubjectInScope(req.params.subjectId, scope);
  const results = await subjectResultService.computeForClass(
    req.params.classId,
    req.params.id,
    req.params.subjectId,
    scope,
  );
  res.json({ success: true, data: results });
}));

// GET /admin/students/:studentId/exam-sessions/:sessionId/subjects/:subjectId/result
router.get('/students/:studentId/exam-sessions/:sessionId/subjects/:subjectId/result', asyncHandler(async (req: Request, res: Response) => {
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
