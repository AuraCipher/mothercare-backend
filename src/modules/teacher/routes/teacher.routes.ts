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
import { getTeacherProfile, updateTeacherProfile } from '../services/teacher-profile.service';
import {
  getTeacherMarksGrid,
  listTeacherExamSubjects,
  saveTeacherMarks,
} from '../services/teacher-marks.service';
import { listTeacherMarksTable } from '../services/teacher-marks-table.service';
import { getHodDepartmentOverview, listHodExamSubjects } from '../services/teacher-hod.service';
import {
  listTeacherNotifications,
  markAllTeacherNotificationsRead,
  markTeacherNotificationRead,
} from '../services/teacher-notifications.service';
import { getTeacherContext, TeacherAccessError } from '../utils/teacher-assignment.guard';
import { expensesService } from '../../admin/services/expenses.service';
import { assertFeatureAllowed } from '../permissions/teacher-feature.guard';
import type { TeacherContext } from '../services/teacher-context.service';
import { getTeacherChatLanding, openTeacherDirectMessage } from '../services/teacher-chat.service';
import {
  assignClassRole,
  createClassRoleDefinition,
  deleteClassRoleDefinition,
  getActiveCommunityOrThrow,
  listClassRoleDefinitions,
  removeClassRoleAssignment,
  resolveCommunityByGroupId,
  updateClassRoleDefinition,
} from '../../chat/services/class-role.service';
import { assertClassTeacher } from '../utils/teacher-assignment.guard';
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

/** Writes — profile self-service (password uses /auth/password). */
router.put(
  '/profile',
  teacherReadOnlyGuard,
  asyncHandler(async (req, res) => {
    const ctx = getTeacherContext(req);
    assertFeatureAllowed(ctx.permissions, 'profile');
    const user = (req as any).teacherUser;
    const { phone, emergencyContact, address } = req.body ?? {};
    const data = await updateTeacherProfile(user.id, {
      phone,
      emergencyContact,
      address,
    });
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
  '/classes/:groupId/community',
  asyncHandler(async (req, res) => {
    const ctx = getTeacherContext(req);
    assertClassTeacher(ctx, req.params.groupId);
    const data = await resolveCommunityByGroupId(req.params.groupId, ctx.academicYearId);
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
  '/marks/table',
  asyncHandler(async (req, res) => {
    const ctx = getTeacherContext(req);
    assertFeatureAllowed(ctx.permissions, 'marks', 'view');
    const { sessionId, examTypeId, subjectId, studentId } = req.query;
    const data = await listTeacherMarksTable(ctx, {
      sessionId: sessionId as string | undefined,
      examTypeId: examTypeId as string | undefined,
      subjectId: subjectId as string | undefined,
      studentId: studentId as string | undefined,
    });
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
    const unreadOnly = req.query.unreadOnly === 'true';
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const data = await listTeacherNotifications(ctx, { unreadOnly, limit });
    res.json({ success: true, data });
  }),
);

router.patch(
  '/notifications/:id/read',
  asyncHandler(async (req, res) => {
    const ctx = getTeacherContext(req);
    assertFeatureAllowed(ctx.permissions, 'notifications', 'markRead');
    const data = await markTeacherNotificationRead(ctx, req.params.id);
    res.json({ success: true, data });
  }),
);

router.post(
  '/notifications/read-all',
  asyncHandler(async (req, res) => {
    const ctx = getTeacherContext(req);
    assertFeatureAllowed(ctx.permissions, 'notifications', 'markRead');
    const data = await markAllTeacherNotificationsRead(ctx);
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

router.get(
  '/chat/landing',
  teacherScopeMiddleware,
  asyncHandler(async (req, res) => {
    const ctx = (req as any).teacherContext as TeacherContext;
    const data = await getTeacherChatLanding({
      userId: ctx.userId,
      branchId: ctx.branchId,
      academicYearId: ctx.academicYearId,
    });
    res.json({ success: true, data });
  }),
);

router.post(
  '/chat/dm',
  teacherScopeMiddleware,
  asyncHandler(async (req, res) => {
    const ctx = (req as any).teacherContext as TeacherContext;
    const { participantUserId } = req.body;
    if (!participantUserId) {
      res.status(400).json({ success: false, message: 'participantUserId is required' });
      return;
    }
    const data = await openTeacherDirectMessage({
      userId: ctx.userId,
      branchId: ctx.branchId,
      academicYearId: ctx.academicYearId,
      participantUserId,
    });
    res.status(201).json({ success: true, data });
  }),
);

async function assertTeacherCommunityAccess(
  req: Request,
  res: Response,
  communityId: string,
): Promise<boolean> {
  const ctx = getTeacherContext(req);
  const community = await getActiveCommunityOrThrow(communityId);
  if (community.academicYearId !== ctx.academicYearId) {
    res.status(400).json({
      success: false,
      message: 'Community does not belong to the selected academic year',
    });
    return false;
  }
  assertClassTeacher(ctx, community.groupId);
  return true;
}

router.get(
  '/communities/:communityId/roles',
  asyncHandler(async (req, res) => {
    if (!(await assertTeacherCommunityAccess(req, res, req.params.communityId))) return;
    const data = await listClassRoleDefinitions(req.params.communityId);
    res.json({ success: true, data });
  }),
);

router.post(
  '/communities/:communityId/roles',
  teacherReadOnlyGuard,
  asyncHandler(async (req, res) => {
    if (!(await assertTeacherCommunityAccess(req, res, req.params.communityId))) return;
    const user = (req as any).teacherUser;
    const { name, description, canPostInGroups, canReceiveDms, canInitiateDms } = req.body ?? {};
    const data = await createClassRoleDefinition({
      communityId: req.params.communityId,
      name,
      description,
      canPostInGroups,
      canReceiveDms,
      canInitiateDms,
      createdById: user.id,
    });
    res.status(201).json({ success: true, data });
  }),
);

router.patch(
  '/communities/:communityId/roles/:roleId',
  teacherReadOnlyGuard,
  asyncHandler(async (req, res) => {
    if (!(await assertTeacherCommunityAccess(req, res, req.params.communityId))) return;
    const { name, description, canPostInGroups, canReceiveDms, canInitiateDms } = req.body ?? {};
    const data = await updateClassRoleDefinition({
      communityId: req.params.communityId,
      roleDefinitionId: req.params.roleId,
      name,
      description,
      canPostInGroups,
      canReceiveDms,
      canInitiateDms,
    });
    res.json({ success: true, data });
  }),
);

router.delete(
  '/communities/:communityId/roles/:roleId',
  teacherReadOnlyGuard,
  asyncHandler(async (req, res) => {
    if (!(await assertTeacherCommunityAccess(req, res, req.params.communityId))) return;
    await deleteClassRoleDefinition({
      communityId: req.params.communityId,
      roleDefinitionId: req.params.roleId,
    });
    res.json({ success: true, message: 'Role deleted' });
  }),
);

router.post(
  '/communities/:communityId/roles/:roleId/assign',
  teacherReadOnlyGuard,
  asyncHandler(async (req, res) => {
    if (!(await assertTeacherCommunityAccess(req, res, req.params.communityId))) return;
    const user = (req as any).teacherUser;
    const { studentId, publicDisplayName, isMessagingRestricted } = req.body ?? {};
    if (!studentId) {
      res.status(400).json({ success: false, message: 'studentId is required' });
      return;
    }
    const data = await assignClassRole({
      communityId: req.params.communityId,
      roleDefinitionId: req.params.roleId,
      studentId,
      publicDisplayName,
      isMessagingRestricted,
      assignedById: user.id,
    });
    res.status(201).json({ success: true, data });
  }),
);

router.delete(
  '/communities/:communityId/assignments/:assignmentId',
  teacherReadOnlyGuard,
  asyncHandler(async (req, res) => {
    if (!(await assertTeacherCommunityAccess(req, res, req.params.communityId))) return;
    const user = (req as any).teacherUser;
    await removeClassRoleAssignment({
      communityId: req.params.communityId,
      assignmentId: req.params.assignmentId,
      removedById: user.id,
    });
    res.json({ success: true, message: 'Assignment removed' });
  }),
);

router.get(
  '/my-attendance',
  teacherScopeMiddleware,
  asyncHandler(async (req, res) => {
    const ctx = (req as any).teacherContext as TeacherContext;
    const user = (req as any).teacherUser;
    const from = req.query.from as string | undefined;
    const to = req.query.to as string | undefined;
    const where: { teacherId: string; academicYearId: string; date?: { gte?: Date; lte?: Date } } = {
      teacherId: user.id,
      academicYearId: ctx.academicYearId,
    };
    if (from || to) {
      where.date = {};
      if (from) where.date.gte = new Date(from);
      if (to) where.date.lte = new Date(`${to}T23:59:59`);
    }
    const rows = await prisma.teacherAttendance.findMany({
      where,
      orderBy: { date: 'desc' },
      take: 120,
    });
    res.json({ success: true, data: rows });
  }),
);

router.get(
  '/my-payroll',
  teacherScopeMiddleware,
  asyncHandler(async (req, res) => {
    const ctx = (req as any).teacherContext as TeacherContext;
    const user = (req as any).teacherUser;
    const data = await expensesService.listPayrollHistory(ctx.branchId, user.id);
    res.json({ success: true, data });
  }),
);

export default router;
