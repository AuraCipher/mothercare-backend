import { Router, Request, Response, NextFunction } from 'express';
import { staffService } from '../services/staff.service';
import { requireScope } from '../utils/scope-context';
import type { ModulePermissionInput } from '../staff-permissions.constants';

const router = Router();

const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };

async function assertStaffAdmin(req: Request, res: Response): Promise<{ branchId: string } | null> {
  const scope = await requireScope(req, res);
  if (!scope) return null;
  const user = (req as any).user;
  if (user?.role === 'super_admin') return { branchId: scope.branchId };

  const access = await staffService.resolveUserAccess(user.id, scope.branchId, user.role);
  if (access.isRestricted) {
    res.status(403).json({ success: false, message: 'Staff management requires full admin access' });
    return null;
  }
  return { branchId: scope.branchId };
}

router.get('/', asyncHandler(async (req, res) => {
  const ctx = await assertStaffAdmin(req, res);
  if (!ctx) return;
  const search = req.query.search as string | undefined;
  const status = req.query.status as string | undefined;
  const data = await staffService.listBranchStaff(ctx.branchId, { search, status });
  res.json({ success: true, data, meta: { total: data.length } });
}));

router.post('/', asyncHandler(async (req, res) => {
  const ctx = await assertStaffAdmin(req, res);
  if (!ctx) return;
  const { name, username, password, email, phone, permissions } = req.body;
  if (!name?.trim() || !username?.trim()) {
    res.status(400).json({ success: false, message: 'Name and username are required' });
    return;
  }
  if (!Array.isArray(permissions) || permissions.length === 0) {
    res.status(400).json({ success: false, message: 'Select at least one module' });
    return;
  }
  const data = await staffService.createStaff(
    ctx.branchId,
    {
      name,
      username,
      password,
      email,
      phone,
      permissions: permissions as ModulePermissionInput[],
    },
    (req as any).user?.id,
  );
  res.status(201).json({ success: true, data });
}));

router.get('/:userId/permissions', asyncHandler(async (req, res) => {
  const ctx = await assertStaffAdmin(req, res);
  if (!ctx) return;
  const data = await staffService.getStaffPermissions(ctx.branchId, req.params.userId);
  res.json({ success: true, data });
}));

router.put('/:userId/permissions', asyncHandler(async (req, res) => {
  const ctx = await assertStaffAdmin(req, res);
  if (!ctx) return;
  const { permissions } = req.body;
  if (!Array.isArray(permissions) || permissions.length === 0) {
    res.status(400).json({ success: false, message: 'Select at least one module' });
    return;
  }
  const data = await staffService.setStaffPermissions(
    ctx.branchId,
    req.params.userId,
    permissions as ModulePermissionInput[],
  );
  res.json({ success: true, data });
}));

router.get('/:userId', asyncHandler(async (req, res) => {
  const ctx = await assertStaffAdmin(req, res);
  if (!ctx) return;
  const data = await staffService.getStaffDetail(ctx.branchId, req.params.userId);
  res.json({ success: true, data });
}));

router.patch('/:userId', asyncHandler(async (req, res) => {
  const ctx = await assertStaffAdmin(req, res);
  if (!ctx) return;
  const { name, email, phone } = req.body;
  const data = await staffService.updateStaffProfile(ctx.branchId, req.params.userId, {
    name,
    email,
    phone,
  });
  res.json({ success: true, data });
}));

router.post('/:userId/deactivate', asyncHandler(async (req, res) => {
  const ctx = await assertStaffAdmin(req, res);
  if (!ctx) return;
  const data = await staffService.deactivateStaff(ctx.branchId, req.params.userId);
  res.json({ success: true, data });
}));

router.post('/:userId/reactivate', asyncHandler(async (req, res) => {
  const ctx = await assertStaffAdmin(req, res);
  if (!ctx) return;
  const data = await staffService.reactivateStaff(ctx.branchId, req.params.userId);
  res.json({ success: true, data });
}));

export default router;
