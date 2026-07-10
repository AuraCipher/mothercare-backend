import type { ChatRoomKind } from '@prisma/client';
import { prisma } from '../../../lib/prisma';
import { resolveTeacherPermissions } from '../../teacher/permissions/teacher-permissions.resolver';
import type { AppChatPermissions } from '../../teacher/permissions/teacher-permissions.types';

export async function loadTeacherAppChatPermissions(
  userId: string,
  branchId: string,
): Promise<AppChatPermissions | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true, status: true },
  });
  if (!user || user.status !== 'active' || user.role !== 'teacher') return null;

  const profile = await prisma.teacherProfile.findUnique({
    where: { userId },
    select: {
      portalAccess: true,
      portalPermissions: true,
      canViewParentContact: true,
      hodParentContactScope: true,
    },
  });
  if (!profile) return null;

  const branch = await prisma.branch.findUnique({
    where: { id: branchId },
    select: {
      teacherParentContactEnabled: true,
      teachersCanMarkAttendance: true,
      teachersCanEnterMarks: true,
    },
  });
  if (!branch) return null;

  const resolved = resolveTeacherPermissions({
    portalAccess: profile.portalAccess,
    isReadOnly: profile.portalAccess === 'READ_ONLY',
    isHod: false,
    stored: profile.portalPermissions as import('../../teacher/permissions/teacher-permissions.types').TeacherPortalPermissionsStored,
    legacy: {
      canViewParentContact: profile.canViewParentContact,
      hodParentContactScope: profile.hodParentContactScope,
    },
    branch,
  });

  return resolved.features.app;
}

export function appChatAllowsPost(app: AppChatPermissions, roomKind: ChatRoomKind): boolean {
  if (!app.allowed) return false;
  switch (roomKind) {
    case 'school_announcement':
      return app.canSchoolAnnouncementPost;
    case 'teacher_announcement':
      return app.canTeachersAnnouncementPost;
    case 'class_announcement':
      return app.canClassAnnouncementPost;
    case 'group_chat':
      return app.canSubjectGroupPost;
    case 'direct_message':
      return app.canDirectMessages;
    default:
      return true;
  }
}

/** Returns true when no teacher app gate applies or the app permission allows posting. */
export async function teacherAppChatAllowsPost(
  userId: string,
  branchId: string | null | undefined,
  roomKind: ChatRoomKind,
): Promise<boolean> {
  if (!branchId) return true;
  const app = await loadTeacherAppChatPermissions(userId, branchId);
  if (!app) return true;
  return appChatAllowsPost(app, roomKind);
}

export async function teacherAppChatAllowsAttachments(
  userId: string,
  branchId: string,
): Promise<boolean> {
  const app = await loadTeacherAppChatPermissions(userId, branchId);
  if (!app) return true;
  return app.allowed && app.canAttachments;
}
