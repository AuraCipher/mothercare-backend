import { Router, Request, Response, NextFunction } from 'express';
import auth from '../../../middleware/auth/auth.middleware';
import { studentRoleMiddleware } from '../middleware/student-role.middleware';
import { studentActiveMiddleware } from '../middleware/student-active.middleware';
import {
  studentScopeMiddleware,
  studentReadOnlyGuard,
  getStudentContext,
} from '../middleware/student-scope.middleware';
import { buildBootstrapResponse } from '../services/student-bootstrap.service';
import { getStudentProfile } from '../services/student-profile.service';
import { getStudentFees } from '../services/student-fees.service';
import { getStudentAttendance } from '../services/student-attendance.service';
import { listStudentResultsTable } from '../services/student-results.service';
import { getStudentCanteen } from '../services/student-canteen.service';
import { getStudentTimetable } from '../services/student-timetable.service';
import { listStudentDatesheets } from '../services/student-datesheets.service';
import { listStudentAnnouncements } from '../services/student-announcements.service';
import { getStudentChatLanding, openStudentDirectMessage, getStudentChatContacts } from '../services/student-chat.service';

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
router.use(studentRoleMiddleware);
router.use(studentActiveMiddleware);
router.use(studentReadOnlyGuard);

/**
 * GET /student/bootstrap?academicYearId=
 */
router.get(
  '/bootstrap',
  studentScopeMiddleware,
  asyncHandler(async (req, res) => {
    const ctx = getStudentContext(req);
    const user = (req as any).studentUser;
    const payload = await buildBootstrapResponse(ctx, {
      id: user.id,
      name: user.name,
      email: user.email,
      username: user.username,
      role: user.role,
      profilePhotoId: user.profilePhotoId,
    });
    res.json({ success: true, data: payload });
  }),
);

router.use(studentScopeMiddleware);

router.get(
  '/profile',
  asyncHandler(async (req, res) => {
    const data = await getStudentProfile(getStudentContext(req));
    res.json({ success: true, data });
  }),
);

router.get(
  '/fees',
  asyncHandler(async (req, res) => {
    const data = await getStudentFees(getStudentContext(req));
    res.json({ success: true, data });
  }),
);

router.get(
  '/attendance',
  asyncHandler(async (req, res) => {
    const { from, to } = req.query;
    const data = await getStudentAttendance(getStudentContext(req), {
      from: from as string | undefined,
      to: to as string | undefined,
    });
    res.json({ success: true, data });
  }),
);

router.get(
  '/results/table',
  asyncHandler(async (req, res) => {
    const { sessionId, examTypeId, subjectId } = req.query;
    const data = await listStudentResultsTable(getStudentContext(req), {
      sessionId: sessionId as string | undefined,
      examTypeId: examTypeId as string | undefined,
      subjectId: subjectId as string | undefined,
    });
    res.json({ success: true, data });
  }),
);

router.get(
  '/canteen',
  asyncHandler(async (req, res) => {
    const data = await getStudentCanteen(getStudentContext(req));
    res.json({ success: true, data });
  }),
);

router.get(
  '/timetable',
  asyncHandler(async (req, res) => {
    const data = await getStudentTimetable(getStudentContext(req));
    res.json({ success: true, data });
  }),
);

router.get(
  '/datesheets',
  asyncHandler(async (req, res) => {
    const data = await listStudentDatesheets(getStudentContext(req));
    res.json({ success: true, data });
  }),
);

router.get(
  '/announcements',
  asyncHandler(async (req, res) => {
    const data = await listStudentAnnouncements(getStudentContext(req));
    res.json({ success: true, data });
  }),
);

router.get(
  '/chat/landing',
  asyncHandler(async (req, res) => {
    const data = await getStudentChatLanding(getStudentContext(req));
    res.json({ success: true, data });
  }),
);

router.get(
  '/chat/contacts',
  asyncHandler(async (req, res) => {
    const data = await getStudentChatContacts(getStudentContext(req));
    res.json({ success: true, data });
  }),
);

router.post(
  '/chat/dm',
  asyncHandler(async (req, res) => {
    const { participantUserId } = req.body ?? {};
    if (!participantUserId) {
      res.status(400).json({ success: false, message: 'participantUserId is required' });
      return;
    }
    const data = await openStudentDirectMessage(getStudentContext(req), participantUserId);
    res.status(201).json({ success: true, data });
  }),
);

export default router;
