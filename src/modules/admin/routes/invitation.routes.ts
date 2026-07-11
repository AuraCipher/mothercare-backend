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

/** Protected — super_admin only (must be before /:token) */
router.post('/', auth, roleMiddleware(['super_admin']), asyncHandler(async (req: Request, res: Response) => {
  const { email, branchId } = req.body;

  if (!email || !branchId) {
    res.status(400).json({ success: false, message: 'Email and branchId are required' });
    return;
  }

  const result = await invitationService.createInvitation(email, branchId, (req as any).user?.id);
  res.status(201).json({ success: true, data: result });
}));

router.get('/', auth, roleMiddleware(['super_admin']), asyncHandler(async (_req: Request, res: Response) => {
  const [pendingInvitations, admins] = await Promise.all([
    invitationService.listPendingInvitations(),
    invitationService.listAdmins(),
  ]);
  res.json({
    success: true,
    data: { pendingInvitations, admins },
  });
}));

router.get('/admins/:userId', auth, roleMiddleware(['super_admin']), asyncHandler(async (req: Request, res: Response) => {
  const data = await invitationService.getAdminDetail(req.params.userId);
  res.json({ success: true, data });
}));

router.put('/admins/:userId', auth, roleMiddleware(['super_admin']), asyncHandler(async (req: Request, res: Response) => {
  const data = await invitationService.updateAdminProfile(req.params.userId, req.body ?? {});
  res.json({ success: true, data });
}));

/** Public — validate invitation token */
router.get('/:token', asyncHandler(async (req: Request, res: Response) => {
  const { token } = req.params;
  const result = await invitationService.validateInvitation(token);

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

/** Public — complete registration */
router.post('/:token/complete', asyncHandler(async (req: Request, res: Response) => {
  const { token } = req.params;
  const {
    name, username, password, phone, employeeId, qualification, specialization,
    joiningDate, address, emergencyContact, workRole, bio,
  } = req.body;

  if (!name || !username || !password) {
    res.status(400).json({ success: false, message: 'Name, username, and password are required' });
    return;
  }

  const user = await invitationService.completeRegistration(token, {
    name,
    username,
    password,
    phone,
    employeeId,
    qualification,
    specialization,
    joiningDate,
    address,
    emergencyContact,
    workRole,
    bio,
  });
  res.status(201).json({
    success: true,
    message: 'Admin registered successfully',
    data: user,
  });
}));

export default router;
