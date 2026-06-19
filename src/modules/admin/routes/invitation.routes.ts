import { Router, Request, Response, NextFunction } from 'express';
import auth from '../../../middleware/auth/auth.middleware';
import { roleMiddleware } from '../../../middleware/auth/role.middleware';
import invitationService from '../services/invitation.service';
import { adminInvitationEmailHtml } from '../../../emails/templates';
import env from '../../../config/env';

const router = Router();

const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };

// ─── Public routes (no auth) ─────────────────────────

/**
 * GET /admin/invitations/:token
 * Validate an invitation token — returns email + branch info.
 * Supports ?html=1 to return the full email template as HTML.
 */
router.get('/invitations/:token', asyncHandler(async (req: Request, res: Response) => {
  const { token } = req.params;
  const result = await invitationService.validateInvitation(token);

  // If ?html=1, render the email template
  if (req.query.html === '1') {
    const frontendUrl = env.FRONTEND_URL || 'http://localhost:3000';
    const html = adminInvitationEmailHtml(
      token,
      result.email,
      result.branchName,
      result.branchCode,
      { frontendUrl, schoolName: env.SCHOOL_NAME },
    );
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
    return;
  }

  res.json({ success: true, data: result });
}));

/**
 * POST /admin/invitations/:token/complete
 * Complete registration with name, username, password, phone.
 */
router.post('/invitations/:token/complete', asyncHandler(async (req: Request, res: Response) => {
  const { token } = req.params;
  const { name, username, password, phone } = req.body;

  if (!name || !username || !password) {
    res.status(400).json({ success: false, message: 'Name, username, and password are required' });
    return;
  }

  const user = await invitationService.completeRegistration(token, { name, username, password, phone });
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

  const result = await invitationService.createInvitation(email, branchId, (req as any).user?.id);
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