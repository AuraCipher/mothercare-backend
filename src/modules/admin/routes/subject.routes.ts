import { Router, Request, Response, NextFunction } from 'express';
import { subjectService } from '../services/subject.service';

const router = Router();

const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };

// ═══════════════════════════════════════════════════════════════════
// SUBJECT CRUD — Branch + AY scoped
// ═══════════════════════════════════════════════════════════════════

// POST /admin/branches/:branchId/academic-years/:ayId/subjects — Create
router.post('/branches/:branchId/academic-years/:ayId/subjects', asyncHandler(async (req: Request, res: Response) => {
  const { name, code, description, totalMarks, passingMarks, isElective, hodId } = req.body;

  if (!name) {
    res.status(400).json({ success: false, message: 'Subject name is required' });
    return;
  }

  const subject = await subjectService.create(req.params.ayId, {
    name, code, description, totalMarks, passingMarks, isElective, hodId,
  });

  res.status(201).json({ success: true, data: subject });
}));

// GET /admin/branches/:branchId/academic-years/:ayId/subjects — List
router.get('/branches/:branchId/academic-years/:ayId/subjects', asyncHandler(async (req: Request, res: Response) => {
  const subjects = await subjectService.findAll(req.params.ayId);
  res.json({ success: true, data: subjects });
}));

// GET /admin/branches/:branchId/subjects/:id — Get by ID
router.get('/branches/:branchId/subjects/:id', asyncHandler(async (req: Request, res: Response) => {
  const subject = await subjectService.findById(req.params.id);
  res.json({ success: true, data: subject });
}));

// PUT /admin/branches/:branchId/subjects/:id — Update
router.put('/branches/:branchId/subjects/:id', asyncHandler(async (req: Request, res: Response) => {
  const { name, code, description, totalMarks, passingMarks, isElective, hodId } = req.body;
  const subject = await subjectService.update(req.params.id, {
    name, code, description, totalMarks, passingMarks, isElective, hodId,
  });
  res.json({ success: true, data: subject });
}));

// DELETE /admin/branches/:branchId/subjects/:id — Delete (blocks if linked)
router.delete('/branches/:branchId/subjects/:id', asyncHandler(async (req: Request, res: Response) => {
  const result = await subjectService.delete(req.params.id);
  res.json({ success: true, message: result.message });
}));

// ═══════════════════════════════════════════════════════════════════
// GROUP-SUBJECT LINKING
// ═══════════════════════════════════════════════════════════════════

// POST /admin/branches/:branchId/subjects/:id/link — Link to groups
router.post('/branches/:branchId/subjects/:id/link', asyncHandler(async (req: Request, res: Response) => {
  const { groupIds } = req.body;
  if (!groupIds || !Array.isArray(groupIds)) {
    res.status(400).json({ success: false, message: 'groupIds array is required' });
    return;
  }
  const result = await subjectService.linkGroups(req.params.id, groupIds);
  res.json({ success: true, data: result });
}));

// DELETE /admin/branches/:branchId/subjects/:id/unlink/:groupId — Unlink from group
router.delete('/branches/:branchId/subjects/:id/unlink/:groupId', asyncHandler(async (req: Request, res: Response) => {
  const result = await subjectService.unlinkGroup(req.params.id, req.params.groupId);
  res.json({ success: true, message: result.message });
}));

export default router;
