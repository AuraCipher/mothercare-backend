import { Request, Response, NextFunction } from 'express';
import { prisma } from '../../../lib/prisma';
import { TEACHER_READ_ONLY_AY_STATUSES, TEACHER_PORTAL_ACCESS } from '../teacher.constants';
import type { TeacherContext } from '../services/teacher-context.service';
import { resolveHodSubjectIds } from '../utils/teacher-hod.guard';
import {
  normalizeStoredPermissions,
  resolveTeacherPermissions,
} from '../permissions/teacher-permissions.resolver';

function extractBranchId(req: Request): string | undefined {
  return (
    (req.query.branchId as string) ||
    req.body?.branchId ||
    req.params.branchId ||
    undefined
  );
}

function extractAcademicYearId(req: Request): string | undefined {
  return (
    (req.query.academicYearId as string) ||
    req.body?.academicYearId ||
    req.params.ayId ||
    req.params.academicYearId ||
    undefined
  );
}

/**
 * Requires branchId + academicYearId, validates AY belongs to branch,
 * and attaches TeacherContext on req.teacherContext.
 */
export async function teacherScopeMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const userId = (req as any).teacherUser?.id || (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    const academicYearId = extractAcademicYearId(req);
    if (!academicYearId) {
      return res.status(400).json({
        success: false,
        message: 'academicYearId is required',
      });
    }

    const ay = await prisma.academicYear.findUnique({
      where: { id: academicYearId },
      select: {
        id: true,
        branchId: true,
        status: true,
        calendar: { select: { label: true } },
        branch: {
          select: {
            id: true,
            name: true,
            code: true,
            teacherParentContactEnabled: true,
            teachersCanMarkAttendance: true,
            teachersCanEnterMarks: true,
          },
        },
      },
    });

    if (!ay) {
      return res.status(404).json({ success: false, message: 'Academic year not found' });
    }

    const explicitBranchId = extractBranchId(req);
    const branchId = explicitBranchId || ay.branchId;

    if (explicitBranchId && explicitBranchId !== ay.branchId) {
      return res.status(400).json({
        success: false,
        message: 'academicYearId does not belong to the specified branch',
      });
    }

    const jwtUser = (req as any).user;
    if (jwtUser?.branchIds && !jwtUser.branchIds.includes(branchId)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied: you do not have access to this branch',
      });
    }

    const membership = await prisma.branchMember.findUnique({
      where: { branchId_userId: { branchId, userId } },
      select: { id: true, role: true, isActive: true },
    });

    if (!membership?.isActive || membership.role !== 'teacher') {
      return res.status(403).json({
        success: false,
        message: 'You are not an active teacher at this branch',
      });
    }

    const now = new Date();
    const assignments = await prisma.teacherAssignment.findMany({
      where: {
        teacherId: userId,
        academicYearId,
        OR: [{ validTo: null }, { validTo: { gt: now } }],
      },
      select: {
        id: true,
        academicYearId: true,
        groupId: true,
        subjectId: true,
        isClassTeacher: true,
        role: true,
        group: { select: { id: true, name: true, section: true } },
        subject: { select: { id: true, name: true, code: true } },
      },
      orderBy: [{ group: { displayOrder: 'asc' } }, { subject: { name: 'asc' } }],
    });

    const profile = await prisma.teacherProfile.findUnique({
      where: { userId },
      select: {
        portalAccess: true,
        portalPermissions: true,
        canViewParentContact: true,
        hodParentContactScope: true,
      },
    });
    const portalAccess = (profile?.portalAccess || TEACHER_PORTAL_ACCESS.FULL) as TeacherContext['portalAccess'];
    const hodSubjectIds =
      portalAccess === TEACHER_PORTAL_ACCESS.FROZEN
        ? []
        : await resolveHodSubjectIds(userId, academicYearId, assignments);

    const classTeacherGroupIds = assignments
      .filter((a) => a.isClassTeacher)
      .map((a) => a.groupId);

    const ayReadOnly = TEACHER_READ_ONLY_AY_STATUSES.has(ay.status);
    const portalReadOnly = portalAccess === TEACHER_PORTAL_ACCESS.READ_ONLY;
    const isReadOnly = ayReadOnly || portalReadOnly;
    const freezeReason =
      portalAccess === TEACHER_PORTAL_ACCESS.FROZEN
        ? 'Teacher portal access is frozen by administration.'
        : portalReadOnly
          ? 'Teacher portal is read-only by administration.'
          : ayReadOnly
            ? `Academic year is ${ay.status}`
            : undefined;

    const canViewParentContact = profile?.canViewParentContact ?? false;
    const hodParentContactScope = profile?.hodParentContactScope ?? 'ASSIGNED_ONLY';
    const portalPermissions = normalizeStoredPermissions(profile?.portalPermissions, {
      canViewParentContact,
      hodParentContactScope,
    });
    const isHod = hodSubjectIds.length > 0;
    const permissions = resolveTeacherPermissions({
      portalAccess,
      isReadOnly,
      isHod,
      stored: portalPermissions,
      legacy: { canViewParentContact, hodParentContactScope },
      branch: ay.branch,
    });

    const ctx: TeacherContext = {
      userId,
      teacherProfileId: (req as any).teacherProfileId,
      branchId,
      academicYearId,
      academicYearStatus: ay.status,
      academicYearLabel: ay.calendar?.label || academicYearId,
      branch: ay.branch,
      portalAccess,
      portalPermissions,
      permissions,
      isReadOnly,
      freezeReason,
      canViewParentContact,
      hodParentContactScope,
      hodSubjectIds,
      isHod,
      assignments: portalAccess === TEACHER_PORTAL_ACCESS.FROZEN ? [] : assignments,
      classTeacherGroupIds: portalAccess === TEACHER_PORTAL_ACCESS.FROZEN ? [] : classTeacherGroupIds,
      assignmentGroupIds:
        portalAccess === TEACHER_PORTAL_ACCESS.FROZEN
          ? []
          : [...new Set(assignments.map((a) => a.groupId))],
    };

    (req as any).teacherContext = ctx;
    next();
  } catch (err) {
    next(err);
  }
}

/** Block mutating methods when portal is read-only for this AY. */
export function teacherReadOnlyGuard(req: Request, res: Response, next: NextFunction) {
  const method = req.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    return next();
  }
  const ctx = (req as any).teacherContext as TeacherContext | undefined;
  if (ctx?.isReadOnly) {
    return res.status(403).json({
      success: false,
      message: `Portal is read-only while academic year is ${ctx.academicYearStatus}`,
    });
  }
  next();
}
