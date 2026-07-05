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

// POST /admin/exam-sessions/:id/compute-report-cards
router.post('/exam-sessions/:id/compute-report-cards', asyncHandler(async (req: Request, res: Response) => {
  const scope = await requireScope(req, res);
  if (!scope) return;
  await assertExamSessionInScope(req.params.id, scope);
  const result = await reportCardService.computeForSession(req.params.id, scope);
  res.json({ success: true, data: result });
}));

// POST /admin/exam-sessions/:id/classes/:classId/compute-report-cards
router.post('/exam-sessions/:id/classes/:classId/compute-report-cards', asyncHandler(async (req: Request, res: Response) => {
  const scope = await requireScope(req, res);
  if (!scope) return;
  await assertExamSessionInScope(req.params.id, scope);
  await assertGroupInScope(req.params.classId, scope);
  const results = await reportCardService.computeForClass(
    req.params.classId,
    req.params.id,
    scope,
  );
  res.json({ success: true, data: results });
}));

// POST /admin/report-cards/:id/publish
router.post('/report-cards/:id/publish', asyncHandler(async (req: Request, res: Response) => {
  const scope = await requireScope(req, res);
  if (!scope) return;
  const card = await reportCardService.publish(req.params.id, scope);
  res.json({ success: true, data: card });
}));

// GET /admin/students/:id/exam-sessions/:sessionId/report-card
router.get('/students/:studentId/exam-sessions/:sessionId/report-card', asyncHandler(async (req: Request, res: Response) => {
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
