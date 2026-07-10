import { prisma } from '../../../lib/prisma';
import type { ChatMessageType, ChatRoomKind, ChatRoomSource } from '@prisma/client';
import { ensureRoomMembership } from './chat-access.service';
import { syncSchoolAnnouncementMembers } from './chat-branch-settings.service';

type EnsureRoomInput = {
  academicYearId: string;
  branchId: string;
  kind: ChatRoomKind;
  name: string;
  singletonKey: string;
  source?: ChatRoomSource;
  communityId?: string;
  classGroupId?: string;
  studentId?: string;
  onlyStaffCanPost?: boolean;
  studentsCanPost?: boolean;
  description?: string;
};

async function ensureRoom(input: EnsureRoomInput) {
  const existing = await prisma.chatRoom.findUnique({ where: { singletonKey: input.singletonKey } });
  if (existing) {
    if (existing.name === 'Whole School' && input.name === 'School Announcement') {
      return prisma.chatRoom.update({
        where: { id: existing.id },
        data: { name: input.name },
      });
    }
    return existing;
  }

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
      studentId: input.studentId,
      onlyStaffCanPost: input.onlyStaffCanPost ?? false,
      studentsCanPost: input.studentsCanPost ?? false,
      description: input.description,
    },
  });
}

/** Ensure the singleton school announcement room for a branch + academic year. */
export async function ensureSchoolAnnouncementRoom(branchId: string, academicYearId: string) {
  return ensureRoom({
    academicYearId,
    branchId,
    kind: 'school_announcement',
    name: 'School Announcement',
    singletonKey: `ay:${academicYearId}:branch:${branchId}:school_announcement`,
    onlyStaffCanPost: true,
    studentsCanPost: false,
    description: 'School-wide announcements',
  });
}

export type StudentChatBootstrapInput = {
  userId: string;
  studentId: string;
  groupId: string;
  groupLabel: string;
  academicYearId: string;
  branchId: string;
  studentName: string;
};

/** Auto-derive chat structure from class / branch / student enrollment. */
export async function ensureStudentChatBootstrap(input: StudentChatBootstrapInput) {
  const group = await prisma.group.findUnique({
    where: { id: input.groupId },
    select: { id: true, name: true, section: true },
  });
  const classLabel = input.groupLabel || (group ? `${group.name}${group.section ? ` · ${group.section}` : ''}` : 'Class');

  let community = await prisma.chatCommunity.findUnique({ where: { groupId: input.groupId } });
  if (!community) {
    community = await prisma.chatCommunity.create({
      data: {
        academicYearId: input.academicYearId,
        groupId: input.groupId,
      },
    });
  }

  const schoolRoom = await ensureSchoolAnnouncementRoom(input.branchId, input.academicYearId);

  const classRoom = await ensureRoom({
    academicYearId: input.academicYearId,
    branchId: input.branchId,
    kind: 'class_announcement',
    name: `${classLabel} Announcements`,
    singletonKey: `ay:${input.academicYearId}:group:${input.groupId}:class_announcement`,
    communityId: community.id,
    classGroupId: input.groupId,
    onlyStaffCanPost: true,
    studentsCanPost: false,
  });

  const attendanceRoom = await ensureRoom({
    academicYearId: input.academicYearId,
    branchId: input.branchId,
    kind: 'system_attendance',
    name: 'Attendance',
    singletonKey: `ay:${input.academicYearId}:student:${input.studentId}:attendance`,
    studentId: input.studentId,
    onlyStaffCanPost: true,
    studentsCanPost: false,
    description: 'Daily attendance updates',
  });

  const paymentRoom = await ensureRoom({
    academicYearId: input.academicYearId,
    branchId: input.branchId,
    kind: 'system_payment',
    name: 'Payments & Receipts',
    singletonKey: `ay:${input.academicYearId}:student:${input.studentId}:payment`,
    studentId: input.studentId,
    onlyStaffCanPost: true,
    studentsCanPost: false,
    description: 'Fee payments and receipts',
  });

  // Student memberships (read-only on broadcasts / system feeds)
  await ensureRoomMembership(schoolRoom.id, input.userId, { access: 'observer', canPost: false });
  await ensureRoomMembership(classRoom.id, input.userId, { access: 'member', canPost: false });
  await ensureRoomMembership(attendanceRoom.id, input.userId, { access: 'observer', canPost: false });
  await ensureRoomMembership(paymentRoom.id, input.userId, { access: 'observer', canPost: false });

  // Class teachers → moderators on class announcement
  const classTeachers = await prisma.teacherAssignment.findMany({
    where: { groupId: input.groupId, academicYearId: input.academicYearId },
    select: { teacherId: true },
  });
  for (const ta of classTeachers) {
    await ensureRoomMembership(classRoom.id, ta.teacherId, { access: 'moderator', canPost: true });
    await ensureRoomMembership(schoolRoom.id, ta.teacherId, { access: 'observer', canPost: false });
  }

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
    await ensureRoomMembership(subjectRoom.id, input.userId, { access: 'member', canPost: true });
    await ensureRoomMembership(subjectRoom.id, assignment.teacherId, {
      access: 'moderator',
      canPost: true,
      displayTitle: 'Teacher',
    });
  }

  const parentLinks = await prisma.studentParent.findMany({
    where: { studentId: input.studentId },
    select: { parent: { select: { userId: true } } },
  });
  for (const link of parentLinks) {
    const parentUserId = link.parent.userId;
    if (!parentUserId) continue;
    await ensureRoomMembership(schoolRoom.id, parentUserId, { access: 'observer', canPost: false });
    await ensureRoomMembership(classRoom.id, parentUserId, { access: 'observer', canPost: false });
  }

  await syncSchoolAnnouncementMembers(input.branchId, input.academicYearId);

  return { communityId: community.id };
}

export type ChatLandingSection = {
  key: string;
  title: string;
  rooms: Array<{
    id: string;
    kind: ChatRoomKind;
    name: string;
    unreadCount: number;
    lastMessageAt: string | null;
    canPost: boolean;
  }>;
};

export function groupRoomsForStudentLanding(
  rooms: Awaited<ReturnType<typeof import('./chat-access.service').listRoomsForUser>>,
): ChatLandingSection[] {
  const pick = (kinds: ChatRoomKind[]) =>
    rooms
      .filter((r) => kinds.includes(r.kind))
      .map((r) => ({
        id: r.id,
        kind: r.kind,
        name: r.name,
        unreadCount: r.unreadCount,
        lastMessageAt: r.lastMessageAt,
        canPost: r.canPost,
      }));

  return [
    { key: 'school', title: 'School Announcement', rooms: pick(['school_announcement']) },
    { key: 'class', title: 'Class Community', rooms: pick(['class_announcement', 'group_chat']) },
    { key: 'system', title: 'Updates', rooms: pick(['system_attendance', 'system_payment']) },
    { key: 'dm', title: 'Messages', rooms: pick(['direct_message']) },
  ].filter((s) => s.rooms.length > 0);
}
