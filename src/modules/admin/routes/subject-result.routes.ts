import { Router, Request, Response, NextFunction } from 'express';
import { subjectResultService } from '../services/subject-result.service';

const router = Router();

const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };

// ═══════════════════════════════════════════════════════════════════
// POST /admin/exam-sessions/:id/compute-results
// Compute results for all classes + subjects in a session
// ═══════════════════════════════════════════════════════════════════
router.post('/exam-sessions/:id/compute-results', asyncHandler(async (req: Request, res: Response) => {
  const result = await subjectResultService.computeForSession(req.params.id);
  res.json({ success: true, data: result });
}));

// ═══════════════════════════════════════════════════════════════════
// POST /admin/exam-sessions/:id/classes/:classId/subjects/:subjectId/compute
// Compute results for one class + subject
// ═══════════════════════════════════════════════════════════════════
router.post('/exam-sessions/:id/classes/:classId/subjects/:subjectId/compute', asyncHandler(async (req: Request, res: Response) => {
  const results = await subjectResultService.computeForClass(
    req.params.classId,
    req.params.id,
    req.params.subjectId,
  );
  res.json({ success: true, data: results });
}));

// ═══════════════════════════════════════════════════════════════════
// GET /admin/students/:studentId/exam-sessions/:sessionId/subjects/:subjectId/result
// Get a stored subject result
// ═══════════════════════════════════════════════════════════════════
router.get('/students/:studentId/exam-sessions/:sessionId/subjects/:subjectId/result', asyncHandler(async (req: Request, res: Response) => {
  const result = await subjectResultService.getResult(
    req.params.studentId,
    req.params.sessionId,
    req.params.subjectId,
  );
  res.json({ success: true, data: result });
}));

export default router;
