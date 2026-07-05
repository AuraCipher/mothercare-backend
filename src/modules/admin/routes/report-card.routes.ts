import { Router, Request, Response, NextFunction } from 'express';
import { reportCardService } from '../services/report-card.service';
import { requireScope } from '../utils/scope-context';
import {
  assertExamSessionInScope,
  assertGroupInScope,
} from '../utils/exam-scope';

const router = Router();

const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };

router.post('/sessions/:sessionId/compute-report-cards', asyncHandler(async (req: Request, res: Response) => {
  const scope = await requireScope(req, res);
  if (!scope) return;
  await assertExamSessionInScope(req.params.sessionId, scope);
  const result = await reportCardService.computeForSession(req.params.sessionId, scope);
  res.json({ success: true, data: result });
}));

router.post('/sessions/:sessionId/classes/:classId/compute-report-cards', asyncHandler(async (req: Request, res: Response) => {
  const scope = await requireScope(req, res);
  if (!scope) return;
  await assertExamSessionInScope(req.params.sessionId, scope);
  await assertGroupInScope(req.params.classId, scope);
  const results = await reportCardService.computeForClass(
    req.params.classId,
    req.params.sessionId,
    scope,
  );
  res.json({ success: true, data: results });
}));

router.get('/sessions/:sessionId/classes/:classId/report-cards', asyncHandler(async (req: Request, res: Response) => {
  const scope = await requireScope(req, res);
  if (!scope) return;
  await assertExamSessionInScope(req.params.sessionId, scope);
  await assertGroupInScope(req.params.classId, scope);
  const cards = await reportCardService.getClassReportCards(
    req.params.classId,
    req.params.sessionId,
    scope,
  );
  res.json({ success: true, data: cards });
}));

router.post('/report-cards/:id/publish', asyncHandler(async (req: Request, res: Response) => {
  const scope = await requireScope(req, res);
  if (!scope) return;
  const card = await reportCardService.publish(req.params.id, scope);
  res.json({ success: true, data: card });
}));

router.get('/students/:studentId/sessions/:sessionId/report-card', asyncHandler(async (req: Request, res: Response) => {
  const scope = await requireScope(req, res);
  if (!scope) return;
  const card = await reportCardService.getReportCard(
    req.params.studentId,
    req.params.sessionId,
    scope,
  );
  res.json({ success: true, data: card });
}));

export default router;
