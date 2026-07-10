import { prisma } from '../../../lib/prisma';
import { ensureRoomMembership } from './chat-access.service';
import {
  ensureSchoolAnnouncementRoom,
} from './chat-community.bootstrap';
import {
  syncSchoolAnnouncementMembers,
  syncTeacherAnnouncementMembers,
} from './chat-branch-settings.service';
import { ensureTeacherAnnouncementRoom, groupLabel } from './staff-chat-bootstrap.service';

type EnsureRoomInput = {
  academicYearId: string;
  branchId: string;
  kind: import('@prisma/client').ChatRoomKind;
  name: string;
  singletonKey: string;
  source?: import('@prisma/client').ChatRoomSource;
  communityId?: string;
  classGroupId?: string;
  teacherAssignmentId?: string;
  subjectId?: string;
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
      teacherAssignmentId: input.teacherAssignmentId,
      subjectId: input.subjectId,
      onlyStaffCanPost: input.onlyStaffCanPost ?? false,
      studentsCanPost: input.studentsCanPost ?? false,
      description: input.description,
    },
  });
}

/** Ensure class community rooms exist (without memberships). */
async function ensureGroupChatRoomsExist(input: {
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
      teacherAssignmentId: assignment.id,
      subjectId: assignment.subject.id,
      studentsCanPost: false,
      description: `Subject group — ${assignment.subject.name}`,
    });
    await prisma.chatRoom.update({
      where: { id: subjectRoom.id },
      data: { teacherAssignmentId: assignment.id, subjectId: assignment.subject.id },
    });
  }

  return { communityId: community.id, classRoomId: classRoom.id };
}

/** Bootstrap chat memberships for a teacher based on assignments. */
export async function ensureTeacherChatBootstrap(input: {
  userId: string;
  branchId: string;
  academicYearId: string;
}) {
  const assignments = await prisma.teacherAssignment.findMany({
    where: { teacherId: input.userId, academicYearId: input.academicYearId },
    include: { group: { select: { id: true, name: true, section: true, displayOrder: true } } },
  });

  if (assignments.length === 0) {
    throw { status: 400, message: 'No class assignments found for this teacher' };
  }

  await ensureSchoolAnnouncementRoom(input.branchId, input.academicYearId);
  await syncSchoolAnnouncementMembers(input.branchId, input.academicYearId);
  await ensureTeacherAnnouncementRoom(input.branchId, input.academicYearId);
  await syncTeacherAnnouncementMembers(input.branchId, input.academicYearId);

  const schoolRoom = await prisma.chatRoom.findFirst({
    where: {
      branchId: input.branchId,
      academicYearId: input.academicYearId,
      kind: 'school_announcement',
    },
  });
  if (schoolRoom) {
    await ensureRoomMembership(schoolRoom.id, input.userId, { access: 'observer', canPost: false });
  }

  const teacherRoom = await prisma.chatRoom.findFirst({
    where: {
      branchId: input.branchId,
      academicYearId: input.academicYearId,
      kind: 'teacher_announcement',
    },
  });
  if (teacherRoom) {
    const settings = await prisma.branchChatSettings.findUnique({ where: { branchId: input.branchId } });
    const canPostTeachers =
      settings?.allowAllTeachersTeacherAnnouncement ||
      settings?.teacherAnnouncementPosterUserIds.includes(input.userId);
    await ensureRoomMembership(teacherRoom.id, input.userId, {
      access: canPostTeachers ? 'moderator' : 'member',
      canPost: !!canPostTeachers,
    });
  }

  const groupIds = [...new Set(assignments.map((a) => a.groupId))];

  for (const groupId of groupIds) {
    const group = assignments.find((a) => a.groupId === groupId)!.group;
    const label = groupLabel(group.name, group.section);
    await ensureGroupChatRoomsExist({
      branchId: input.branchId,
      academicYearId: input.academicYearId,
      groupId,
      groupLabel: label,
    });

    const classRoom = await prisma.chatRoom.findFirst({
      where: {
        academicYearId: input.academicYearId,
        classGroupId: groupId,
        kind: 'class_announcement',
      },
    });
    if (!classRoom) continue;

    const isClassTeacher = assignments.some((a) => a.groupId === groupId && a.isClassTeacher);
    await ensureRoomMembership(classRoom.id, input.userId, {
      access: isClassTeacher ? 'moderator' : 'observer',
      canPost: isClassTeacher,
    });

    const teacherAssignmentsInGroup = assignments.filter((a) => a.groupId === groupId);
    for (const assignment of teacherAssignmentsInGroup) {
      const subjectRoom = await prisma.chatRoom.findFirst({
        where: {
          academicYearId: input.academicYearId,
          teacherAssignmentId: assignment.id,
          kind: 'group_chat',
        },
      });
      if (!subjectRoom) continue;
      await ensureRoomMembership(subjectRoom.id, input.userId, {
        access: 'moderator',
        canPost: true,
        displayTitle: 'Teacher',
      });
    }
  }
}

export { groupLabel };
