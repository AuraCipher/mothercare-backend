import { Router, Request, Response, NextFunction } from 'express';
import auth from '../../../middleware/auth/auth.middleware';
import { roleMiddleware } from '../../../middleware/auth/role.middleware';
import invitationService from '../services/invitation.service';

const router = Router();

const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };

// ─── Public routes (no auth) ─────────────────────────

/**
 * GET /admin/invitations/:token
 * Validate an invitation token — returns email + branch info.
 */
router.get('/invitations/:token', asyncHandler(async (req: Request, res: Response) => {
  const { token } = req.params;
  const result = await invitationService.validateInvitation(token);
  res.json({ success: true, data: result });
}));

/**
 * POST /admin/invitations/:token/complete
 * Complete registration with name, password, phone.
 */
router.post('/invitations/:token/complete', asyncHandler(async (req: Request, res: Response) => {
  const { token } = req.params;
  const { name, password, phone } = req.body;

  if (!name || !password) {
    res.status(400).json({ success: false, message: 'Name and password are required' });
    return;
  }

  const user = await invitationService.completeRegistration(token, { name, password, phone });
  res.status(201).json({
    success: true,
    message: 'Admin registered successfully',
    data: user,
  });
}));

// ─── Protected routes (super_admin only) ─────────────
router.use(auth);
router.use(roleMiddleware(['super_admin']));

/**
 * POST /admin/invitations
 * Create a new invitation for a branch admin.
 */
router.post('/invitations', asyncHandler(async (req: Request, res: Response) => {
  const { email, branchId } = req.body;

  if (!email || !branchId) {
    res.status(400).json({ success: false, message: 'Email and branchId are required' });
    return;
  }

  const result = await invitationService.createInvitation(email, branchId);
  res.status(201).json({ success: true, data: result });
}));

/**
 * GET /admin/invitations
 * List pending invitations and existing admins.
 */
router.get('/invitations', asyncHandler(async (_req: Request, res: Response) => {
  const [pendingInvitations, admins] = await Promise.all([
    invitationService.listPendingInvitations(),
    invitationService.listAdmins(),
  ]);
  res.json({
    success: true,
    data: { pendingInvitations, admins },
  });
}));

export default router;