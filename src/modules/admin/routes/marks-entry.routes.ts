import { Router, Request, Response, NextFunction } from 'express';
import { marksEntryService } from '../services/marks-entry.service';
import { requireScope } from '../utils/scope-context';
import { assertExamClassSubjectInScope } from '../utils/exam-scope';

const router = Router();

const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };

router.get('/exam-class-subjects/:id/marks-grid', asyncHandler(async (req: Request, res: Response) => {
  const scope = await requireScope(req, res);
  if (!scope) return;
  await assertExamClassSubjectInScope(req.params.id, scope);
  const grid = await marksEntryService.getMarksGrid(req.params.id);
  res.json({ success: true, data: grid });
}));

router.post('/exam-class-subjects/:id/marks', asyncHandler(async (req: Request, res: Response) => {
  const scope = await requireScope(req, res);
  if (!scope) return;
  await assertExamClassSubjectInScope(req.params.id, scope);

  const { totalMarks, passingMarks, entries } = req.body;

  if (totalMarks !== undefined) {
    if (typeof totalMarks !== 'number' || totalMarks <= 0 || !Number.isInteger(totalMarks)) {
      res.status(400).json({ success: false, message: 'Total marks must be a positive integer' });
      return;
    }
  }

  if (passingMarks !== undefined && totalMarks === undefined) {
    if (typeof passingMarks !== 'number' || passingMarks < 0 || !Number.isInteger(passingMarks)) {
      res.status(400).json({ success: false, message: 'Passing marks must be a non-negative integer' });
      return;
    }
  }

  if (!entries || !Array.isArray(entries) || entries.length === 0) {
    res.status(400).json({ success: false, message: 'At least one student entry is required' });
    return;
  }

  const userId = (req as any).user?.id;
  if (!userId) {
    res.status(401).json({ success: false, message: 'Authentication required' });
    return;
  }

  const result = await marksEntryService.saveMarks(req.params.id, { totalMarks, passingMarks, entries }, userId);
  res.json({ success: true, data: result });
}));

router.delete('/marks-entries/:id', asyncHandler(async (req: Request, res: Response) => {
  const scope = await requireScope(req, res);
  if (!scope) return;

  const entry = await marksEntryService.getEntryForScopeCheck(req.params.id);
  if (!entry) {
    res.status(404).json({ success: false, message: 'Marks entry not found' });
    return;
  }
  await assertExamClassSubjectInScope(entry.examClassSubjectId, scope);

  const result = await marksEntryService.deleteMarksEntry(req.params.id);
  res.json({ success: true, message: result.message });
}));

export default router;
