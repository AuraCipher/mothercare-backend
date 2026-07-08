import { prisma } from '../../../lib/prisma';
import {
  TEACHER_PERMISSION_CATALOG,
  GLOBAL_PORTAL_MODES,
  HOD_SCOPE_OPTIONS,
  PERMISSION_LEVEL_OPTIONS,
} from '../../teacher/permissions/teacher-permissions.catalog';
import {
  normalizeStoredPermissions,
  resolveTeacherPermissions,
  syncLegacyFieldsFromPermissions,
} from '../../teacher/permissions/teacher-permissions.resolver';
import type { TeacherPortalPermissionsStored } from '../../teacher/permissions/teacher-permissions.types';
import { resolveHodSubjectIds } from '../../teacher/utils/teacher-hod.guard';

export async function getTeacherPortalPermissionsAdmin(teacherProfileId: string, branchId: string) {
  const profile = await prisma.teacherProfile.findUnique({
    where: { id: teacherProfileId },
    select: {
      id: true,
      userId: true,
      portalAccess: true,
      portalPermissions: true,
      canViewParentContact: true,
      hodParentContactScope: true,
    },
  });
  if (!profile) throw { status: 404, message: 'Teacher profile not found' };

  const branch = await prisma.branch.findUnique({
    where: { id: branchId },
    select: {
      id: true,
      name: true,
      teacherParentContactEnabled: true,
      teachersCanMarkAttendance: true,
      teachersCanEnterMarks: true,
    },
  });
  if (!branch) throw { status: 404, message: 'Branch not found' };

  const activeAy = await prisma.academicYear.findFirst({
    where: { branchId, status: 'ACTIVE' },
    select: { id: true },
  });

  let isHod = false;
  if (activeAy) {
    const assignments = await prisma.teacherAssignment.findMany({
      where: { teacherId: profile.userId, academicYearId: activeAy.id },
      select: { subjectId: true, role: true, groupId: true, isClassTeacher: true },
    });
    const hodIds = await resolveHodSubjectIds(profile.userId, activeAy.id, assignments as any);
    isHod = hodIds.length > 0;
  }

  const stored = normalizeStoredPermissions(profile.portalPermissions, {
    canViewParentContact: profile.canViewParentContact,
    hodParentContactScope: profile.hodParentContactScope,
  });

  const effective = resolveTeacherPermissions({
    portalAccess: profile.portalAccess,
    isReadOnly: profile.portalAccess === 'READ_ONLY',
    isHod,
    stored,
    legacy: {
      canViewParentContact: profile.canViewParentContact,
      hodParentContactScope: profile.hodParentContactScope,
    },
    branch,
  });

  return {
    teacherProfileId: profile.id,
    userId: profile.userId,
    portalAccess: profile.portalAccess,
    stored,
    effective,
    isHod,
    branch: {
      id: branch.id,
      name: branch.name,
      teacherParentContactEnabled: branch.teacherParentContactEnabled,
      teachersCanMarkAttendance: branch.teachersCanMarkAttendance,
      teachersCanEnterMarks: branch.teachersCanEnterMarks,
    },
    catalog: TEACHER_PERMISSION_CATALOG,
    options: {
      portalModes: GLOBAL_PORTAL_MODES,
      levels: PERMISSION_LEVEL_OPTIONS,
      hodScopes: HOD_SCOPE_OPTIONS,
    },
  };
}

export async function updateTeacherPortalPermissionsAdmin(
  teacherProfileId: string,
  data: {
    portalAccess?: 'FULL' | 'READ_ONLY' | 'FROZEN';
    portalPermissions?: TeacherPortalPermissionsStored;
    updatedById?: string;
  },
) {
  const existing = await prisma.teacherProfile.findUnique({ where: { id: teacherProfileId } });
  if (!existing) throw { status: 404, message: 'Teacher profile not found' };

  const stored = data.portalPermissions
    ? normalizeStoredPermissions(data.portalPermissions, {
        canViewParentContact: existing.canViewParentContact,
        hodParentContactScope: existing.hodParentContactScope,
      })
    : normalizeStoredPermissions(existing.portalPermissions, {
        canViewParentContact: existing.canViewParentContact,
        hodParentContactScope: existing.hodParentContactScope,
      });

  const legacy = syncLegacyFieldsFromPermissions(stored);

  return prisma.teacherProfile.update({
    where: { id: teacherProfileId },
    data: {
      ...(data.portalAccess !== undefined && { portalAccess: data.portalAccess }),
      portalPermissions: stored,
      canViewParentContact: legacy.canViewParentContact,
      hodParentContactScope: legacy.hodParentContactScope,
      updatedById: data.updatedById,
    },
    select: {
      id: true,
      portalAccess: true,
      portalPermissions: true,
      canViewParentContact: true,
      hodParentContactScope: true,
    },
  });
}
