import { Router, Request, Response, NextFunction } from 'express';
import auth from '../../middleware/auth.middleware';
import { requireBranchAdmin, requireBranchRole } from '../../middleware/branch-role.middleware';
import { branchMemberService } from './services/branch-member.service';
import { branchAdminService } from './services/branch-admin.service';

const router = Router();

const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };

// All routes require auth + branch membership
router.use(auth);

// GET /branches/:branchId/staff — List staff (principal or sub_admin can view)
router.get('/:branchId/staff', requireBranchRole('branch_admin', 'sub_admin'), asyncHandler(async (req: Request, res: Response) => {
  const { role } = req.query;
  const staff = await branchMemberService.listStaff(req.params.branchId, role as string | undefined);
  res.json({ success: true, data: staff });
}));

// POST /branches/:branchId/staff — Add staff (principal only)
router.post('/:branchId/staff', requireBranchAdmin(), asyncHandler(async (req: Request, res: Response) => {
  const { userId, role, keepTeacherRole } = req.body;

  if (!userId || !role) {
    res.status(400).json({ success: false, message: 'userId and role are required' });
    return;
  }

  // Principal cannot create another branch_admin
  if (role === 'branch_admin') {
    res.status(403).json({ success: false, message: 'Principal cannot assign the branch_admin role' });
    return;
  }

  const validRoles = ['sub_admin', 'management', 'teacher', 'parent'];
  if (!validRoles.includes(role)) {
    res.status(400).json({ success: false, message: `Invalid role. Principal can assign: ${validRoles.join(', ')}` });
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

// PUT /branches/:branchId/staff/:userId — Update staff role (principal only)
router.put('/:branchId/staff/:userId', requireBranchAdmin(), asyncHandler(async (req: Request, res: Response) => {
  const { role, keepTeacherRole } = req.body;

  if (role === 'branch_admin') {
    res.status(403).json({ success: false, message: 'Principal cannot promote to branch_admin' });
    return;
  }

  const member = await branchMemberService.updateRole(req.params.branchId, req.params.userId, { role, keepTeacherRole });
  res.json({ success: true, data: member });
}));

// DELETE /branches/:branchId/staff/:userId — Remove staff (principal only)
router.delete('/:branchId/staff/:userId', requireBranchAdmin(), asyncHandler(async (req: Request, res: Response) => {
  await branchMemberService.removeMember(req.params.branchId, req.params.userId);
  res.status(204).json({ success: true, message: 'Staff removed' });
}));

// POST /branches/:branchId/admin/resign — Principal resigns with succession
router.post('/:branchId/admin/resign', requireBranchAdmin(), asyncHandler(async (req: Request, res: Response) => {
  const { successorUserId, demoteToRole } = req.body;

  if (!successorUserId) {
    res.status(400).json({ success: false, message: 'successorUserId is required' });
    return;
  }

  const result = await branchAdminService.resign(
    req.params.branchId,
    (req as any).user.id,
    successorUserId,
    demoteToRole || 'teacher',
  );

  res.json({ success: true, data: result });
}));

export default router;
