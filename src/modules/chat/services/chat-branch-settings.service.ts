import { prisma } from '../../../lib/prisma';
import { ensureRoomMembership } from './chat-access.service';
import { getOrCreateBranchChatSettings } from './chat-permissions.service';

export type BranchChatSettingsDto = {
  branchId: string;
  schoolAnnouncementPosterUserIds: string[];
  teacherAnnouncementPosterUserIds: string[];
  allowAllTeachersTeacherAnnouncement: boolean;
  schoolAnnouncementPosters: Array<{ id: string; name: string; username: string | null }>;
};

async function validateSchoolPosterUserIds(branchId: string, userIds: string[]): Promise<void> {
  if (userIds.length === 0) return;

  const unique = [...new Set(userIds)];
  if (unique.length !== userIds.length) {
    throw { status: 400, message: 'Duplicate user IDs in schoolAnnouncementPosterUserIds' };
  }

  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: {
      id: true,
      role: true,
      status: true,
      branchMembers: { where: { branchId, isActive: true }, select: { id: true } },
    },
  });

  if (users.length !== userIds.length) {
    throw { status: 400, message: 'One or more appointed poster user IDs were not found' };
  }

  for (const user of users) {
    if (user.role !== 'teacher' || user.status !== 'active') {
      throw { status: 400, message: 'School announcement posters must be active teachers' };
    }
    if (user.branchMembers.length === 0) {
      throw { status: 400, message: 'Appointed teachers must be active members of this branch' };
    }
  }
}

/** Sync school room memberships after settings change or bootstrap. */
export async function syncSchoolAnnouncementMembers(branchId: string, academicYearId: string) {
  const settings = await getOrCreateBranchChatSettings(branchId);
  const schoolRoom = await prisma.chatRoom.findFirst({
    where: {
      branchId,
      academicYearId,
      kind: 'school_announcement',
      singletonKey: `ay:${academicYearId}:branch:${branchId}:school_announcement`,
    },
  });
  if (!schoolRoom) return null;

  const branchAdmins = await prisma.branchMember.findMany({
    where: { branchId, isActive: true, role: { in: ['branch_admin', 'sub_admin'] } },
    select: { userId: true },
  });

  const superAdmins = await prisma.user.findMany({
    where: {
      role: 'super_admin',
      status: 'active',
      branchMembers: { some: { branchId, isActive: true } },
    },
    select: { id: true },
  });

  const adminUserIds = new Set([
    ...branchAdmins.map((m) => m.userId),
    ...superAdmins.map((u) => u.id),
  ]);
  const posterUserIds = new Set(settings.schoolAnnouncementPosterUserIds);

  for (const adminId of adminUserIds) {
    await ensureRoomMembership(schoolRoom.id, adminId, { access: 'moderator', canPost: true });
  }

  for (const posterId of posterUserIds) {
    if (!adminUserIds.has(posterId)) {
      await ensureRoomMembership(schoolRoom.id, posterId, { access: 'moderator', canPost: true });
    }
  }

  const members = await prisma.chatRoomMember.findMany({
    where: { roomId: schoolRoom.id, leftAt: null },
    select: { userId: true },
  });

  for (const m of members) {
    if (adminUserIds.has(m.userId) || posterUserIds.has(m.userId)) continue;
    const user = await prisma.user.findUnique({
      where: { id: m.userId },
      select: { role: true },
    });
    if (user?.role === 'teacher') {
      await ensureRoomMembership(schoolRoom.id, m.userId, { access: 'observer', canPost: false });
    }
  }

  return schoolRoom;
}

/** Sync teachers announcement room memberships. */
export async function syncTeacherAnnouncementMembers(branchId: string, academicYearId: string) {
  const settings = await getOrCreateBranchChatSettings(branchId);
  const teacherRoom = await prisma.chatRoom.findFirst({
    where: {
      branchId,
      academicYearId,
      kind: 'teacher_announcement',
      singletonKey: `ay:${academicYearId}:branch:${branchId}:teacher_announcement`,
    },
  });
  if (!teacherRoom) return null;

  const branchAdmins = await prisma.branchMember.findMany({
    where: { branchId, isActive: true, role: { in: ['branch_admin', 'sub_admin'] } },
    select: { userId: true },
  });
  const superAdmins = await prisma.user.findMany({
    where: {
      role: 'super_admin',
      status: 'active',
      branchMembers: { some: { branchId, isActive: true } },
    },
    select: { id: true },
  });
  const adminUserIds = new Set([
    ...branchAdmins.map((m) => m.userId),
    ...superAdmins.map((u) => u.id),
  ]);
  const posterUserIds = new Set(settings.teacherAnnouncementPosterUserIds);

  const activeTeachers = await prisma.branchMember.findMany({
    where: { branchId, isActive: true, role: 'teacher' },
    select: { userId: true },
  });

  for (const adminId of adminUserIds) {
    await ensureRoomMembership(teacherRoom.id, adminId, { access: 'moderator', canPost: true });
  }

  for (const teacher of activeTeachers) {
    if (adminUserIds.has(teacher.userId)) continue;
    const canPost =
      settings.allowAllTeachersTeacherAnnouncement || posterUserIds.has(teacher.userId);
    await ensureRoomMembership(teacherRoom.id, teacher.userId, {
      access: canPost ? 'moderator' : 'member',
      canPost,
    });
  }

  for (const posterId of posterUserIds) {
    if (!adminUserIds.has(posterId)) {
      await ensureRoomMembership(teacherRoom.id, posterId, { access: 'moderator', canPost: true });
    }
  }

  return teacherRoom;
}

export async function getBranchChatSettings(branchId: string): Promise<BranchChatSettingsDto> {
  const settings = await getOrCreateBranchChatSettings(branchId);
  const posterIds = settings.schoolAnnouncementPosterUserIds;

  const posters =
    posterIds.length === 0
      ? []
      : await prisma.user.findMany({
          where: { id: { in: posterIds } },
          select: { id: true, name: true, username: true },
        });

  return {
    branchId,
    schoolAnnouncementPosterUserIds: settings.schoolAnnouncementPosterUserIds,
    teacherAnnouncementPosterUserIds: settings.teacherAnnouncementPosterUserIds,
    allowAllTeachersTeacherAnnouncement: settings.allowAllTeachersTeacherAnnouncement,
    schoolAnnouncementPosters: posters,
  };
}

export async function updateBranchChatSettings(
  branchId: string,
  academicYearId: string,
  input: {
    schoolAnnouncementPosterUserIds?: string[];
    teacherAnnouncementPosterUserIds?: string[];
    allowAllTeachersTeacherAnnouncement?: boolean;
  },
): Promise<BranchChatSettingsDto> {
  if (input.schoolAnnouncementPosterUserIds !== undefined) {
    await validateSchoolPosterUserIds(branchId, input.schoolAnnouncementPosterUserIds);
  }

  await prisma.branchChatSettings.upsert({
    where: { branchId },
    create: {
      branchId,
      schoolAnnouncementPosterUserIds: input.schoolAnnouncementPosterUserIds ?? [],
      teacherAnnouncementPosterUserIds: input.teacherAnnouncementPosterUserIds ?? [],
      allowAllTeachersTeacherAnnouncement: input.allowAllTeachersTeacherAnnouncement ?? false,
    },
    update: {
      ...(input.schoolAnnouncementPosterUserIds !== undefined
        ? { schoolAnnouncementPosterUserIds: input.schoolAnnouncementPosterUserIds }
        : {}),
      ...(input.teacherAnnouncementPosterUserIds !== undefined
        ? { teacherAnnouncementPosterUserIds: input.teacherAnnouncementPosterUserIds }
        : {}),
      ...(input.allowAllTeachersTeacherAnnouncement !== undefined
        ? { allowAllTeachersTeacherAnnouncement: input.allowAllTeachersTeacherAnnouncement }
        : {}),
    },
  });

  await syncSchoolAnnouncementMembers(branchId, academicYearId);
  if (input.teacherAnnouncementPosterUserIds !== undefined || input.allowAllTeachersTeacherAnnouncement !== undefined) {
    await syncTeacherAnnouncementMembers(branchId, academicYearId);
  }
  return getBranchChatSettings(branchId);
}
