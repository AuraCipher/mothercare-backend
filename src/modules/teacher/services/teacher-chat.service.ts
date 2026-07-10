import { prisma } from '../../../lib/prisma';
import { listRoomsForUser, type RoomSummary } from '../../chat/services/chat-access.service';
import { ensureTeacherChatBootstrap, groupLabel } from '../../chat/services/teacher-chat-bootstrap.service';
import { ensureDirectMessageRoom } from '../../chat/services/chat-dm.service';
import type { StaffChatContact, StaffClassCommunity } from '../../staff/services/staff-chat.service';

async function listTeacherChatContacts(
  branchId: string,
  userId: string,
  academicYearId: string,
): Promise<StaffChatContact[]> {
  const members = await prisma.branchMember.findMany({
    where: {
      branchId,
      isActive: true,
      userId: { not: userId },
      role: { in: ['teacher', 'branch_admin', 'sub_admin', 'management'] },
    },
    include: {
      user: { select: { id: true, name: true, role: true, status: true } },
    },
    orderBy: { user: { name: 'asc' } },
  });

  const dmThreads = await prisma.chatDmThread.findMany({
    where: {
      academicYearId,
      OR: [{ participantAId: userId }, { participantBId: userId }],
    },
    select: { roomId: true, participantAId: true, participantBId: true },
  });
  const dmByUser = new Map<string, string>();
  for (const t of dmThreads) {
    const other = t.participantAId === userId ? t.participantBId : t.participantAId;
    dmByUser.set(other, t.roomId);
  }

  return members
    .filter((m) => m.user.status === 'active')
    .map((m) => ({
      userId: m.user.id,
      name: m.user.name,
      role: m.user.role,
      branchRole: m.role,
      dmRoomId: dmByUser.get(m.user.id) ?? null,
    }));
}

function mapRoom(r: RoomSummary) {
  return {
    id: r.id,
    kind: r.kind,
    name: r.name,
    unreadCount: r.unreadCount,
    lastMessageAt: r.lastMessageAt,
    canPost: r.canPost,
    classGroupId: r.classGroupId,
  };
}

export async function getTeacherChatLanding(input: {
  userId: string;
  branchId: string;
  academicYearId: string;
}) {
  await ensureTeacherChatBootstrap(input);

  const assignments = await prisma.teacherAssignment.findMany({
    where: { teacherId: input.userId, academicYearId: input.academicYearId },
    select: { id: true, groupId: true },
  });
  const assignmentIds = new Set(assignments.map((a) => a.id));
  const taughtGroupIds = [...new Set(assignments.map((a) => a.groupId))];

  const rooms = await listRoomsForUser(input.userId, input.academicYearId);
  const roomMap = rooms.map(mapRoom);

  const roomAssignmentMap = new Map<string, string | null>();
  const groupChatRooms = rooms.filter((r) => r.kind === 'group_chat');
  if (groupChatRooms.length > 0) {
    const fullRooms = await prisma.chatRoom.findMany({
      where: { id: { in: groupChatRooms.map((r) => r.id) } },
      select: { id: true, teacherAssignmentId: true },
    });
    for (const fr of fullRooms) {
      roomAssignmentMap.set(fr.id, fr.teacherAssignmentId);
    }
  }

  const groups = await prisma.group.findMany({
    where: { id: { in: taughtGroupIds }, isActive: true },
    orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }, { section: 'asc' }],
    select: { id: true, name: true, section: true, displayOrder: true },
  });

  const communities: StaffClassCommunity[] = [];
  for (const g of groups) {
    const label = groupLabel(g.name, g.section);
    const validRooms = rooms.filter((r) => {
      if (r.classGroupId !== g.id) return false;
      if (r.kind === 'class_announcement') return true;
      if (r.kind === 'group_chat') {
        const assignId = roomAssignmentMap.get(r.id);
        return assignId != null && assignmentIds.has(assignId);
      }
      return false;
    });
    if (validRooms.length === 0) continue;
    communities.push({
      groupId: g.id,
      groupLabel: label,
      displayOrder: g.displayOrder,
      section: g.section,
      unreadCount: validRooms.reduce((sum, r) => sum + r.unreadCount, 0),
      rooms: validRooms,
    });
  }

  const contacts = await listTeacherChatContacts(input.branchId, input.userId, input.academicYearId);
  const pick = (kinds: string[]) => roomMap.filter((r) => kinds.includes(r.kind));

  const sections = [
    { key: 'school', title: 'School Announcement', rooms: pick(['school_announcement']) },
    { key: 'teachers', title: 'Teachers Announcement', rooms: pick(['teacher_announcement']) },
    { key: 'classes', title: 'My Classes', communities },
    { key: 'contacts', title: 'Contacts', contacts },
    { key: 'dm', title: 'Messages', rooms: pick(['direct_message']) },
  ].filter((s) => {
    if ('communities' in s && s.communities?.length) return true;
    if ('contacts' in s && s.contacts?.length) return true;
    if ('rooms' in s && s.rooms?.length) return true;
    return false;
  });

  return {
    sections,
    rooms: roomMap,
    communities,
    contacts,
  };
}

export async function openTeacherDirectMessage(input: {
  userId: string;
  branchId: string;
  academicYearId: string;
  participantUserId: string;
}) {
  const room = await ensureDirectMessageRoom({
    academicYearId: input.academicYearId,
    branchId: input.branchId,
    userId: input.userId,
    participantUserId: input.participantUserId,
  });
  return { roomId: room.id, name: room.name };
}
