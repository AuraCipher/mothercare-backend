import { Router, Request, Response, NextFunction } from 'express';
import auth from '../../../middleware/auth/auth.middleware';
import { teacherRoleMiddleware } from '../middleware/teacher-role.middleware';
import { teacherActiveMiddleware } from '../middleware/teacher-active.middleware';
import {
  teacherScopeMiddleware,
  teacherReadOnlyGuard,
} from '../middleware/teacher-scope.middleware';
import { buildBootstrapResponse } from '../services/teacher-bootstrap.service';
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
import { getTeacherContext, TeacherAccessError } from '../utils/teacher-assignment.guard';
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

/** GET routes below — read-only guard does not block GET. */
router.get(
  '/profile',
  asyncHandler(async (req, res) => {
    const user = (req as any).teacherUser;
    const data = await getTeacherProfile(user.id);
    res.json({ success: true, data });
  }),
);

router.get(
  '/timetable',
  asyncHandler(async (req, res) => {
    const ctx = getTeacherContext(req);
    const data = await getTeacherTimetable(ctx.userId, ctx.academicYearId);
    res.json({ success: true, data });
  }),
);

router.get(
  '/classes/:groupId/students',
  asyncHandler(async (req, res) => {
    const ctx = getTeacherContext(req);
    const data = await getClassStudents(ctx, req.params.groupId);
    res.json({ success: true, data });
  }),
);

router.get(
  '/attendance',
  asyncHandler(async (req, res) => {
    const ctx = getTeacherContext(req);
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
    const data = await listTeacherExamSubjects(ctx);
    res.json({ success: true, data });
  }),
);

router.get(
  '/marks/grid/:examClassSubjectId',
  asyncHandler(async (req, res) => {
    const ctx = getTeacherContext(req);
    const data = await getTeacherMarksGrid(ctx, req.params.examClassSubjectId);
    res.json({ success: true, data });
  }),
);

/** Writes — blocked when AY is read-only. */
router.use(teacherReadOnlyGuard);

router.post(
  '/attendance/batch',
  asyncHandler(async (req, res) => {
    const ctx = getTeacherContext(req);
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
