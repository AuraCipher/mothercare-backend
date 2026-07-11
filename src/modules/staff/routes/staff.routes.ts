import { Router, Request, Response, NextFunction } from 'express';
import auth from '../../../middleware/auth/auth.middleware';
import { staffAdminRoleMiddleware } from '../middleware/staff-role.middleware';
import { getStaffChatLanding, openStaffDirectMessage, getStaffChatContacts } from '../services/staff-chat.service';
import { getStaffSelfProfile } from '../services/staff-profile.service';
import {
  getCampusAttendanceToday,
  getCampusFeesSummary,
  getCampusOverview,
  getCampusResultsSummary,
  listCampusStaff,
} from '../services/staff-campus.service';

const router = Router();

const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch((err) => {
      if (err?.status && err?.message) {
        res.status(err.status).json({ success: false, message: err.message });
        return;
      }
      next(err);
    });
  };

router.use(auth);
router.use(staffAdminRoleMiddleware);

router.get(
  '/chat/landing',
  asyncHandler(async (req, res) => {
    const userId = (req as any).user.id;
    const branchId = req.query.branchId as string;
    const academicYearId = req.query.academicYearId as string;

    if (!branchId || !academicYearId) {
      res.status(400).json({ success: false, message: 'branchId and academicYearId are required' });
      return;
    }

    const data = await getStaffChatLanding({ userId, branchId, academicYearId });
    res.json({ success: true, data });
  }),
);

router.get(
  '/chat/contacts',
  asyncHandler(async (req, res) => {
    const userId = (req as any).user.id;
    const branchId = req.query.branchId as string;
    const academicYearId = req.query.academicYearId as string;
    if (!branchId || !academicYearId) {
      res.status(400).json({ success: false, message: 'branchId and academicYearId are required' });
      return;
    }
    const data = await getStaffChatContacts({ userId, branchId, academicYearId });
    res.json({ success: true, data });
  }),
);

router.get(
  '/profile',
  asyncHandler(async (req, res) => {
    const userId = (req as any).user.id;
    const branchId = req.query.branchId as string;
    if (!branchId) {
      res.status(400).json({ success: false, message: 'branchId is required' });
      return;
    }
    const data = await getStaffSelfProfile(userId, branchId);
    res.json({ success: true, data });
  }),
);

router.get(
  '/campus/overview',
  asyncHandler(async (req, res) => {
    const branchId = req.query.branchId as string;
    const academicYearId = req.query.academicYearId as string;
    if (!branchId || !academicYearId) {
      res.status(400).json({ success: false, message: 'branchId and academicYearId are required' });
      return;
    }
    const data = await getCampusOverview(branchId, academicYearId);
    res.json({ success: true, data });
  }),
);

router.get(
  '/campus/fees',
  asyncHandler(async (req, res) => {
    const branchId = req.query.branchId as string;
    const academicYearId = req.query.academicYearId as string;
    if (!branchId || !academicYearId) {
      res.status(400).json({ success: false, message: 'branchId and academicYearId are required' });
      return;
    }
    const data = await getCampusFeesSummary(branchId, academicYearId);
    res.json({ success: true, data });
  }),
);

router.get(
  '/campus/staff',
  asyncHandler(async (req, res) => {
    const branchId = req.query.branchId as string;
    if (!branchId) {
      res.status(400).json({ success: false, message: 'branchId is required' });
      return;
    }
    const data = await listCampusStaff(branchId);
    res.json({ success: true, data });
  }),
);

router.get(
  '/campus/attendance',
  asyncHandler(async (req, res) => {
    const branchId = req.query.branchId as string;
    const academicYearId = req.query.academicYearId as string;
    const date = req.query.date as string | undefined;
    if (!branchId || !academicYearId) {
      res.status(400).json({ success: false, message: 'branchId and academicYearId are required' });
      return;
    }
    const data = await getCampusAttendanceToday(branchId, academicYearId, date);
    res.json({ success: true, data });
  }),
);

router.get(
  '/campus/results',
  asyncHandler(async (req, res) => {
    const branchId = req.query.branchId as string;
    const academicYearId = req.query.academicYearId as string;
    if (!branchId || !academicYearId) {
      res.status(400).json({ success: false, message: 'branchId and academicYearId are required' });
      return;
    }
    const data = await getCampusResultsSummary(branchId, academicYearId);
    res.json({ success: true, data });
  }),
);

router.post(
  '/chat/dm',
  asyncHandler(async (req, res) => {
    const userId = (req as any).user.id;
    const { branchId, academicYearId, participantUserId } = req.body;

    if (!branchId || !academicYearId || !participantUserId) {
      res.status(400).json({
        success: false,
        message: 'branchId, academicYearId, and participantUserId are required',
      });
      return;
    }

    const data = await openStaffDirectMessage({
      userId,
      branchId,
      academicYearId,
      participantUserId,
    });
    res.status(201).json({ success: true, data });
  }),
);

export default router;
