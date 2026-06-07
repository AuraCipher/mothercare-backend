import { Router, Request, Response, NextFunction } from 'express';
import { branchService } from './services/branch.service';
import { academicYearService } from './services/academic-year.service';

const router = Router();

// Helper to wrap async route handlers
const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };

// ─── Branch CRUD ──────────────────────────────────────────────

// POST /admin/branches — Create branch (BA-002)
router.post('/', asyncHandler(async (req: Request, res: Response) => {
  const { name, code, address, phone, email, logoUrl } = req.body;

  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    res.status(400).json({ success: false, message: 'Branch name is required' });
    return;
  }

  if (!code || typeof code !== 'string' || code.trim().length === 0) {
    res.status(400).json({ success: false, message: 'Branch code is required' });
    return;
  }

  const branch = await branchService.create({
    name: name.trim(),
    code: code.trim().toUpperCase(),
    address,
    phone,
    email,
    logoUrl,
  });

  res.status(201).json({ success: true, data: branch });
}));

// GET /admin/branches — List branches (BA-003)
router.get('/', asyncHandler(async (req: Request, res: Response) => {
  const branches = await branchService.findAll();
  res.json({ success: true, data: branches });
}));

// GET /admin/branches/:id — Get branch detail (BA-004)
router.get('/:id', asyncHandler(async (req: Request, res: Response) => {
  const branch = await branchService.findById(req.params.id);
  res.json({ success: true, data: branch });
}));

// PUT /admin/branches/:id — Update branch (BA-005)
router.put('/:id', asyncHandler(async (req: Request, res: Response) => {
  const { name, address, phone, email, logoUrl } = req.body;

  if (name !== undefined && (typeof name !== 'string' || name.trim().length === 0)) {
    res.status(400).json({ success: false, message: 'Branch name cannot be empty' });
    return;
  }

  const branch = await branchService.update(req.params.id, { name, address, phone, email, logoUrl });
  res.json({ success: true, data: branch });
}));

// DELETE /admin/branches/:id — Deactivate branch (BA-006)
router.delete('/:id', asyncHandler(async (req: Request, res: Response) => {
  const result = await branchService.deactivate(req.params.id);
  res.json({ success: true, message: result.message, data: { action: result.action } });
}));

// ─── Branch Members (BA-022) ───────────────────────────────────

// POST /admin/branches/:branchId/members — Add user to branch
router.post('/:branchId/members', asyncHandler(async (req: Request, res: Response) => {
  const { userId } = req.body;

  if (!userId) {
    res.status(400).json({ success: false, message: 'userId is required' });
    return;
  }

  const member = await academicYearService.addBranchMember(req.params.branchId, userId);
  res.status(201).json({ success: true, data: member });
}));

// DELETE /admin/branches/:branchId/members/:userId — Remove user from branch
router.delete('/:branchId/members/:userId', asyncHandler(async (req: Request, res: Response) => {
  await academicYearService.removeBranchMember(req.params.branchId, req.params.userId);
  res.status(204).json({ success: true, message: 'Member removed' });
}));

export default router;
