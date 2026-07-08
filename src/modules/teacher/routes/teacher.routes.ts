import { Router, Request, Response, NextFunction } from 'express';
import auth from '../../../middleware/auth/auth.middleware';
import { teacherRoleMiddleware } from '../middleware/teacher-role.middleware';
import { teacherActiveMiddleware } from '../middleware/teacher-active.middleware';
import {
  teacherScopeMiddleware,
  teacherReadOnlyGuard,
} from '../middleware/teacher-scope.middleware';
import { teacherPortalAccessGuard } from '../middleware/teacher-portal-access.middleware';
import { buildBootstrapResponse } from '../services/teacher-bootstrap.service';
import { listTeacherAnnouncements } from '../services/teacher-announcements.service';
import { getTeacherTimetable } from '../services/teacher-timetable.service';
import { getClassStudents } from '../services/teacher-class.service';
import {
  getGroupAttendance,
  saveGroupAttendanceBatch,
} from '../services/teacher-attendance.service';
import { getTeacherProfile } from '../services/teacher-profile.service';
import {
  getTeacherMarksGrid,
  listTeacherExamSubjects,
  saveTeacherMarks,
} from '../services/teacher-marks.service';
import { getHodDepartmentOverview, listHodExamSubjects } from '../services/teacher-hod.service';
import {
  listTeacherNotifications,
  markAllTeacherNotificationsRead,
  markTeacherNotificationRead,
} from '../services/teacher-notifications.service';
import { getTeacherContext, TeacherAccessError } from '../utils/teacher-assignment.guard';
import { assertFeatureAllowed } from '../permissions/teacher-feature.guard';
import type { TeacherContext } from '../services/teacher-context.service';
import { prisma } from '../../../lib/prisma';

const router = Router();

const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch((err) => {
      if (err instanceof TeacherAccessError) {
        res.status(err.status).json({ success: false, message: err.message });
        return;
      }
      if (err?.status && err?.message) {
        res.status(err.status).json({ success: false, message: err.message });
        return;
      }
      next(err);
    });
  };

router.use(auth);
router.use(teacherRoleMiddleware);
router.use(teacherActiveMiddleware);

/**
 * GET /teacher/bootstrap?branchId=&academicYearId=
 */
router.get(
  '/bootstrap',
  teacherScopeMiddleware,
  asyncHandler(async (req, res) => {
    const ctx = (req as any).teacherContext as TeacherContext;
    const user = (req as any).teacherUser;

    const profile = await prisma.teacherProfile.findUnique({
      where: { userId: user.id },
      select: { id: true, employeeId: true },
    });

    const payload = buildBootstrapResponse(ctx, {
      id: user.id,
      name: user.name,
      email: user.email,
      username: user.username,
      role: user.role,
      profilePhotoId: user.profilePhotoId,
    });
    payload.teacherProfile.employeeId = profile?.employeeId ?? null;

    res.json({ success: true, data: payload });
  }),
);

router.use(teacherScopeMiddleware);
router.use(teacherPortalAccessGuard);

/** GET routes below — read-only guard does not block GET. */
router.get(
  '/announcements',
  asyncHandler(async (req, res) => {
    const ctx = getTeacherContext(req);
    assertFeatureAllowed(ctx.permissions, 'announcements');
    const data = await listTeacherAnnouncements(ctx);
    res.json({ success: true, data });
  }),
);

router.get(
  '/profile',
  asyncHandler(async (req, res) => {
    const ctx = getTeacherContext(req);
    assertFeatureAllowed(ctx.permissions, 'profile');
    const user = (req as any).teacherUser;
    const data = await getTeacherProfile(user.id);
    res.json({ success: true, data });
  }),
);

router.get(
  '/timetable',
  asyncHandler(async (req, res) => {
    const ctx = getTeacherContext(req);
    assertFeatureAllowed(ctx.permissions, 'timetable');
    const data = await getTeacherTimetable(ctx.userId, ctx.academicYearId);
    res.json({ success: true, data });
  }),
);

router.get(
  '/classes/:groupId/students',
  asyncHandler(async (req, res) => {
    const ctx = getTeacherContext(req);
    assertFeatureAllowed(ctx.permissions, 'classes');
    assertFeatureAllowed(ctx.permissions, 'roster');
    const data = await getClassStudents(ctx, req.params.groupId);
    res.json({ success: true, data });
  }),
);

router.get(
  '/attendance',
  asyncHandler(async (req, res) => {
    const ctx = getTeacherContext(req);
    assertFeatureAllowed(ctx.permissions, 'attendance', 'view');
    const groupId = req.query.groupId as string;
    const date = req.query.date as string;
    if (!groupId || !date) {
      res.status(400).json({ success: false, message: 'groupId and date are required' });
      return;
    }
    const data = await getGroupAttendance(ctx, groupId, date);
    res.json({ success: true, data });
  }),
);

router.get(
  '/marks/subjects',
  asyncHandler(async (req, res) => {
    const ctx = getTeacherContext(req);
    assertFeatureAllowed(ctx.permissions, 'marks', 'view');
    const data = await listTeacherExamSubjects(ctx);
    res.json({ success: true, data });
  }),
);

router.get(
  '/marks/grid/:examClassSubjectId',
  asyncHandler(async (req, res) => {
    const ctx = getTeacherContext(req);
    assertFeatureAllowed(ctx.permissions, 'marks', 'view');
    const data = await getTeacherMarksGrid(ctx, req.params.examClassSubjectId);
    res.json({ success: true, data });
  }),
);

router.get(
  '/hod/department',
  asyncHandler(async (req, res) => {
    const ctx = getTeacherContext(req);
    assertFeatureAllowed(ctx.permissions, 'hod', 'view');
    const data = await getHodDepartmentOverview(ctx);
    res.json({ success: true, data });
  }),
);

router.get(
  '/hod/marks/subjects',
  asyncHandler(async (req, res) => {
    const ctx = getTeacherContext(req);
    assertFeatureAllowed(ctx.permissions, 'hod', 'view');
    const data = await listHodExamSubjects(ctx);
    res.json({ success: true, data });
  }),
);

router.get(
  '/notifications',
  asyncHandler(async (req, res) => {
    const ctx = getTeacherContext(req);
    assertFeatureAllowed(ctx.permissions, 'notifications');
    const user = (req as any).teacherUser;
    const unreadOnly = req.query.unreadOnly === 'true';
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const data = await listTeacherNotifications(user.id, { unreadOnly, limit });
    res.json({ success: true, data });
  }),
);

router.patch(
  '/notifications/:id/read',
  asyncHandler(async (req, res) => {
    const ctx = getTeacherContext(req);
    assertFeatureAllowed(ctx.permissions, 'notifications', 'markRead');
    const user = (req as any).teacherUser;
    const data = await markTeacherNotificationRead(user.id, req.params.id);
    res.json({ success: true, data });
  }),
);

router.post(
  '/notifications/read-all',
  asyncHandler(async (req, res) => {
    const ctx = getTeacherContext(req);
    assertFeatureAllowed(ctx.permissions, 'notifications', 'markRead');
    const user = (req as any).teacherUser;
    const data = await markAllTeacherNotificationsRead(user.id);
    res.json({ success: true, data });
  }),
);

/** Writes — blocked when AY is read-only. */
router.use(teacherReadOnlyGuard);

router.post(
  '/attendance/batch',
  asyncHandler(async (req, res) => {
    const ctx = getTeacherContext(req);
    assertFeatureAllowed(ctx.permissions, 'attendance', 'mark');
    const user = (req as any).teacherUser;
    const { groupId, date, records } = req.body ?? {};
    if (!groupId || !date) {
      res.status(400).json({ success: false, message: 'groupId and date are required' });
      return;
    }
    const data = await saveGroupAttendanceBatch(ctx, groupId, date, records ?? [], user.id);
    res.json({ success: true, data });
  }),
);

router.post(
  '/marks/grid/:examClassSubjectId',
  asyncHandler(async (req, res) => {
    const ctx = getTeacherContext(req);
    assertFeatureAllowed(ctx.permissions, 'marks', 'enter');
    const user = (req as any).teacherUser;
    const { totalMarks, passingMarks, entries } = req.body ?? {};
    const data = await saveTeacherMarks(
      ctx,
      req.params.examClassSubjectId,
      { totalMarks, passingMarks, entries: entries ?? [] },
      user.id,
    );
    res.json({ success: true, data });
  }),
);

export default router;
