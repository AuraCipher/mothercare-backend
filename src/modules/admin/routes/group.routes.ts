import { Router, Request, Response, NextFunction } from 'express';
import { groupService } from '../services/group.service';

const router = Router();

const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };

// ═══════════════════════════════════════════════════════════════════
// GROUPS / CLASSES — Scoped under Academic Year
// ═══════════════════════════════════════════════════════════════════

// GET /admin/academic-years/:ayId/groups — List groups for an AY
router.get('/academic-years/:ayId/groups', asyncHandler(async (req: Request, res: Response) => {
  const groups = await groupService.findByAcademicYear(req.params.ayId);
  res.json({ success: true, data: groups });
}));

// POST /admin/academic-years/:ayId/groups — Create group under an AY
router.post('/academic-years/:ayId/groups', asyncHandler(async (req: Request, res: Response) => {
  const { name, section, displayOrder, capacity } = req.body;

  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    res.status(400).json({ success: false, message: 'Group name is required' });
    return;
  }

  const group = await groupService.create({
    academicYearId: req.params.ayId,
    name: name.trim(),
    section: section?.trim() || undefined,
    displayOrder: displayOrder ? parseInt(displayOrder, 10) : undefined,
    capacity: capacity ? parseInt(capacity, 10) : undefined,
  });

  res.status(201).json({ success: true, data: group });
}));

// GET /admin/groups/:id — Get group detail
router.get('/groups/:id', asyncHandler(async (req: Request, res: Response) => {
  const group = await groupService.findById(req.params.id);
  res.json({ success: true, data: group });
}));

// PUT /admin/groups/:id — Update group
router.put('/groups/:id', asyncHandler(async (req: Request, res: Response) => {
  const { name, section, displayOrder, capacity } = req.body;
  const group = await groupService.update(req.params.id, { name, section, displayOrder, capacity });
  res.json({ success: true, data: group });
}));

// DELETE /admin/groups/:id — Soft delete (blocks if students enrolled)
router.delete('/groups/:id', asyncHandler(async (req: Request, res: Response) => {
  const result = await groupService.delete(req.params.id);
  res.json({ success: true, message: result.message });
}));

export default router;
