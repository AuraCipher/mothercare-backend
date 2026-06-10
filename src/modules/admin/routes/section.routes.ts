import { Router, Request, Response, NextFunction } from 'express';
import { sectionService } from '../services/section.service';

const router = Router();

const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };

// ═══════════════════════════════════════════════════════════════════
// SECTIONS — Branch-scoped under academic years
// ═══════════════════════════════════════════════════════════════════

// POST /admin/branches/:branchId/academic-years/:ayId/sections — Create
router.post('/branches/:branchId/academic-years/:ayId/sections', asyncHandler(async (req: Request, res: Response) => {
  const { name, section, displayOrder, capacity } = req.body;

  if (!name || displayOrder === undefined || displayOrder === null) {
    res.status(400).json({ success: false, message: 'name and displayOrder are required' });
    return;
  }

  const result = await sectionService.create(req.params.ayId, { name, section, displayOrder, capacity });
  res.status(201).json({ success: true, data: result });
}));

// GET /admin/branches/:branchId/academic-years/:ayId/sections — List
router.get('/branches/:branchId/academic-years/:ayId/sections', asyncHandler(async (req: Request, res: Response) => {
  const sections = await sectionService.findAll(req.params.ayId);
  res.json({ success: true, data: sections });
}));

// PUT /admin/branches/:branchId/sections/:id — Update
router.put('/branches/:branchId/sections/:id', asyncHandler(async (req: Request, res: Response) => {
  const { name, section, displayOrder, capacity } = req.body;
  const result = await sectionService.update(req.params.id, { name, section, displayOrder, capacity });
  res.json({ success: true, data: result });
}));

// DELETE /admin/branches/:branchId/sections/:id — Soft delete
router.delete('/branches/:branchId/sections/:id', asyncHandler(async (req: Request, res: Response) => {
  await sectionService.delete(req.params.id);
  res.json({ success: true, message: 'Section deactivated' });
}));

export default router;
