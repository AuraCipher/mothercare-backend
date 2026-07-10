import { prisma } from '../../../lib/prisma';
import { ensureRoomMembership } from './chat-access.service';
import {
  ensureSchoolAnnouncementRoom,
} from './chat-community.bootstrap';
import {
  syncSchoolAnnouncementMembers,
  syncTeacherAnnouncementMembers,
} from './chat-branch-settings.service';
import { isBranchChatAdmin } from './chat-permissions.service';

type EnsureRoomInput = {
  academicYearId: string;
  branchId: string;
  kind: import('@prisma/client').ChatRoomKind;
  name: string;
  singletonKey: string;
  source?: import('@prisma/client').ChatRoomSource;
  communityId?: string;
  classGroupId?: string;
  onlyStaffCanPost?: boolean;
  studentsCanPost?: boolean;
  description?: string;
};

async function ensureRoom(input: EnsureRoomInput) {
  const existing = await prisma.chatRoom.findUnique({ where: { singletonKey: input.singletonKey } });
  if (existing) return existing;
  return prisma.chatRoom.create({
    data: {
      academicYearId: input.academicYearId,
      branchId: input.branchId,
      kind: input.kind,
      name: input.name,
      singletonKey: input.singletonKey,
      source: input.source ?? 'system_bootstrap',
      communityId: input.communityId,
      classGroupId: input.classGroupId,
      onlyStaffCanPost: input.onlyStaffCanPost ?? false,
      studentsCanPost: input.studentsCanPost ?? false,
      description: input.description,
    },
  });
}

export async function ensureTeacherAnnouncementRoom(branchId: string, academicYearId: string) {
  return ensureRoom({
    academicYearId,
    branchId,
    kind: 'teacher_announcement',
    name: 'Teachers Announcement',
    singletonKey: `ay:${academicYearId}:branch:${branchId}:teacher_announcement`,
    onlyStaffCanPost: true,
    studentsCanPost: false,
    description: 'Staff-only announcements for teachers',
  });
}

function groupLabel(name: string, section: string | null) {
  return section ? `${name} · ${section}` : name;
}

async function ensureGroupChatStructureForStaff(input: {
  userId: string;
  branchId: string;
  academicYearId: string;
  groupId: string;
  groupLabel: string;
}) {
  let community = await prisma.chatCommunity.findUnique({ where: { groupId: input.groupId } });
  if (!community) {
    community = await prisma.chatCommunity.create({
      data: { academicYearId: input.academicYearId, groupId: input.groupId },
    });
  }

  const classRoom = await ensureRoom({
    academicYearId: input.academicYearId,
    branchId: input.branchId,
    kind: 'class_announcement',
    name: `${input.groupLabel} Announcements`,
    singletonKey: `ay:${input.academicYearId}:group:${input.groupId}:class_announcement`,
    communityId: community.id,
    classGroupId: input.groupId,
    onlyStaffCanPost: true,
    studentsCanPost: false,
  });

  await ensureRoomMembership(classRoom.id, input.userId, { access: 'moderator', canPost: true });

  const assignments = await prisma.teacherAssignment.findMany({
    where: { groupId: input.groupId, academicYearId: input.academicYearId },
    include: { subject: { select: { id: true, name: true } } },
  });

  for (const assignment of assignments) {
    const subjectKey = `ay:${input.academicYearId}:assignment:${assignment.id}:group_chat`;
    const subjectRoom = await ensureRoom({
      academicYearId: input.academicYearId,
      branchId: input.branchId,
      kind: 'group_chat',
      name: assignment.subject.name,
      singletonKey: subjectKey,
      source: 'subject_assignment',
      communityId: community.id,
      classGroupId: input.groupId,
      studentsCanPost: true,
      description: `Subject group — ${assignment.subject.name}`,
    });
    await prisma.chatRoom.update({
      where: { id: subjectRoom.id },
      data: { teacherAssignmentId: assignment.id, subjectId: assignment.subject.id },
    });
    await ensureRoomMembership(subjectRoom.id, input.userId, { access: 'moderator', canPost: true });
    await ensureRoomMembership(subjectRoom.id, assignment.teacherId, {
      access: 'moderator',
      canPost: true,
      displayTitle: 'Teacher',
    });
  }

  const classTeachers = await prisma.teacherAssignment.findMany({
    where: { groupId: input.groupId, academicYearId: input.academicYearId },
    select: { teacherId: true },
  });
  for (const ta of classTeachers) {
    if (ta.teacherId === input.userId) continue;
    await ensureRoomMembership(classRoom.id, ta.teacherId, { access: 'moderator', canPost: true });
  }

  return { communityId: community.id, classRoomId: classRoom.id };
}

/** Bootstrap all branch chat rooms for branch admin staff on landing. */
export async function ensureStaffChatBootstrap(input: {
  userId: string;
  branchId: string;
  academicYearId: string;
}) {
  const isAdmin = await isBranchChatAdmin(input.userId, input.branchId);
  if (!isAdmin) {
    throw { status: 403, message: 'Branch admin access required for staff chat bootstrap' };
  }

  await ensureSchoolAnnouncementRoom(input.branchId, input.academicYearId);
  await syncSchoolAnnouncementMembers(input.branchId, input.academicYearId);
  await ensureTeacherAnnouncementRoom(input.branchId, input.academicYearId);
  await syncTeacherAnnouncementMembers(input.branchId, input.academicYearId);

  const groups = await prisma.group.findMany({
    where: { academicYearId: input.academicYearId, isActive: true },
    orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }, { section: 'asc' }],
    select: { id: true, name: true, section: true, displayOrder: true },
  });

  for (const group of groups) {
    await ensureGroupChatStructureForStaff({
      userId: input.userId,
      branchId: input.branchId,
      academicYearId: input.academicYearId,
      groupId: group.id,
      groupLabel: groupLabel(group.name, group.section),
    });
  }
}

export { groupLabel };
