import { Router, Request, Response, NextFunction } from 'express';
import { branchMemberService } from '../services/branch-member.service';
import { branchAdminService } from '../services/branch-admin.service';

const router = Router();

const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };

// POST /admin/branches/:branchId/members — Add member with role
router.post('/:branchId/members', asyncHandler(async (req: Request, res: Response) => {
  const { userId, role, keepTeacherRole } = req.body;

  if (!userId) {
    res.status(400).json({ success: false, message: 'userId is required' });
    return;
  }
  if (!role) {
    res.status(400).json({ success: false, message: 'role is required' });
    return;
  }

  const validRoles = ['branch_admin', 'sub_admin', 'management', 'teacher', 'parent'];
  if (!validRoles.includes(role)) {
    res.status(400).json({ success: false, message: `Invalid role. Must be one of: ${validRoles.join(', ')}` });
    return;
  }

  // Only super_admin can create branch_admin
  if (role === 'branch_admin' && (req as any).user?.role !== 'super_admin') {
    res.status(403).json({ success: false, message: 'Only super_admin can assign the branch_admin role' });
    return;
  }

  const member = await branchMemberService.addMember({
    branchId: req.params.branchId,
    userId,
    role,
    keepTeacherRole,
    assignedById: (req as any).user?.id,
  });

  res.status(201).json({ success: true, data: member });
}));

// PUT /admin/branches/:branchId/members/:userId — Update member role
router.put('/:branchId/members/:userId', asyncHandler(async (req: Request, res: Response) => {
  const { role, keepTeacherRole } = req.body;

  // Only super_admin can set branch_admin role
  if (role === 'branch_admin' && (req as any).user?.role !== 'super_admin') {
    res.status(403).json({ success: false, message: 'Only super_admin can assign the branch_admin role' });
    return;
  }

  const member = await branchMemberService.updateRole(req.params.branchId, req.params.userId, { role, keepTeacherRole });
  res.json({ success: true, data: member });
}));

// DELETE /admin/branches/:branchId/members/:userId — Remove member
router.delete('/:branchId/members/:userId', asyncHandler(async (req: Request, res: Response) => {
  await branchMemberService.removeMember(req.params.branchId, req.params.userId);
  res.status(204).json({ success: true, message: 'Member removed' });
}));

// POST /admin/branches/:branchId/members/:userId/promote — Promote to branch_admin
router.post('/:branchId/members/:userId/promote', asyncHandler(async (req: Request, res: Response) => {
  if ((req as any).user?.role !== 'super_admin') {
    res.status(403).json({ success: false, message: 'Only super_admin can promote to branch_admin' });
    return;
  }

  const { keepTeacherRole } = req.body;
  const result = await branchAdminService.promoteToAdmin(
    req.params.branchId,
    req.params.userId,
    keepTeacherRole !== false,
  );

  res.json({ success: true, data: result });
}));

export default router;
