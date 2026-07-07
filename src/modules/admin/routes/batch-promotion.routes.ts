import { Router, Request, Response, NextFunction } from 'express';
import { batchPromotionService } from '../services/batch-promotion.service';
import { staffService } from '../services/staff.service';
import { FIXED_STUDENT_RULES } from '../batch-promotion.constants';

const router = Router({ mergeParams: true });

const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };

async function requirePromotionAdmin(req: Request, res: Response): Promise<boolean> {
  const user = (req as any).user;
  const branchId = (req.params as { branchId: string }).branchId;
  const access = await staffService.resolveUserAccess(user.id, branchId, user.role);
  if (access.isRestricted) {
    res.status(403).json({ success: false, message: 'Batch promotion requires branch admin access' });
    return false;
  }
  return true;
}

router.get('/preconditions', asyncHandler(async (req: Request, res: Response) => {
  if (!(await requirePromotionAdmin(req, res))) return;
  const { branchId, sourceAcademicYearId } = req.params as { branchId: string; sourceAcademicYearId: string };
  const data = await batchPromotionService.getPreconditions(branchId, sourceAcademicYearId);
  res.json({
    success: true,
    data: {
      ...data,
      fixedStudentRules: FIXED_STUDENT_RULES,
    },
  });
}));

router.get('/runs', asyncHandler(async (req: Request, res: Response) => {
  const { branchId } = req.params as { branchId: string };
  const data = await batchPromotionService.listRuns(branchId);
  res.json({ success: true, data });
}));

router.post('/start', asyncHandler(async (req: Request, res: Response) => {
  if (!(await requirePromotionAdmin(req, res))) return;
  const { branchId, sourceAcademicYearId } = req.params as { branchId: string; sourceAcademicYearId: string };
  const userId = (req as any).user?.id;
  const data = await batchPromotionService.startRun({
    branchId,
    sourceAcademicYearId,
    targetAcademicYearId: req.body.targetAcademicYearId,
    calendarId: req.body.calendarId,
    previousAcademicYearId: req.body.previousAcademicYearId,
    carryOptions: req.body.carryOptions,
    notes: req.body.notes,
    promotedById: userId,
  });
  res.status(201).json({ success: true, data });
}));

router.get('/runs/:runId', asyncHandler(async (req: Request, res: Response) => {
  const { branchId, runId } = req.params as { branchId: string; runId: string };
  const data = await batchPromotionService.getRun(runId, branchId);
  res.json({ success: true, data });
}));

router.post('/runs/:runId/snapshot', asyncHandler(async (req: Request, res: Response) => {
  if (!(await requirePromotionAdmin(req, res))) return;
  const { branchId, runId } = req.params as { branchId: string; runId: string };
  const userId = (req as any).user?.id;
  const data = await batchPromotionService.snapshotRun(runId, branchId, userId);
  res.json({ success: true, data });
}));

router.post('/runs/:runId/apply', asyncHandler(async (req: Request, res: Response) => {
  if (!(await requirePromotionAdmin(req, res))) return;
  const { branchId, runId } = req.params as { branchId: string; runId: string };
  const data = await batchPromotionService.applyCarry(runId, branchId);
  res.json({ success: true, data });
}));

router.post('/runs/:runId/publish', asyncHandler(async (req: Request, res: Response) => {
  if (!(await requirePromotionAdmin(req, res))) return;
  const { branchId, runId } = req.params as { branchId: string; runId: string };
  const data = await batchPromotionService.publish(runId, branchId);
  res.json({ success: true, data });
}));

export default router;
