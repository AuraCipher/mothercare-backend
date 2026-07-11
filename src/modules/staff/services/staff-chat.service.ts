import { prisma } from '../../../lib/prisma';
import { listRoomsForUser, type RoomSummary } from '../../chat/services/chat-access.service';
import { ensureStaffChatBootstrap, groupLabel } from '../../chat/services/staff-chat-bootstrap.service';
import { ensureDirectMessageRoom } from '../../chat/services/chat-dm.service';

export type StaffChatContact = {
  userId: string;
  name: string;
  role: string;
  branchRole: string | null;
  dmRoomId: string | null;
};

export type StaffClassCommunity = {
  groupId: string;
  groupLabel: string;
  displayOrder: number;
  section: string | null;
  unreadCount: number;
  rooms: RoomSummary[];
};

export type StaffChatLandingSection = {
  key: string;
  title: string;
  rooms?: Array<{
    id: string;
    kind: string;
    name: string;
    unreadCount: number;
    lastMessageAt: string | null;
    canPost: boolean;
  }>;
  communities?: StaffClassCommunity[];
  contacts?: StaffChatContact[];
};

async function listBranchChatContacts(
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

export async function getStaffChatLanding(input: {
  userId: string;
  branchId: string;
  academicYearId: string;
}) {
  await ensureStaffChatBootstrap(input);

  const rooms = await listRoomsForUser(input.userId, input.academicYearId);
  const roomMap = rooms.map(mapRoom);

  const groups = await prisma.group.findMany({
    where: { academicYearId: input.academicYearId, isActive: true },
    orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }, { section: 'asc' }],
    select: { id: true, name: true, section: true, displayOrder: true },
  });

  const communities: StaffClassCommunity[] = groups.map((g) => {
    const label = groupLabel(g.name, g.section);
    const groupRooms = rooms.filter(
      (r) => r.classGroupId === g.id && (r.kind === 'class_announcement' || r.kind === 'group_chat'),
    );
    return {
      groupId: g.id,
      groupLabel: label,
      displayOrder: g.displayOrder,
      section: g.section,
      unreadCount: groupRooms.reduce((sum, r) => sum + r.unreadCount, 0),
      rooms: groupRooms,
    };
  }).filter((c) => c.rooms.length > 0);

  const contacts: StaffChatContact[] = [];

  const pick = (kinds: string[]) => roomMap.filter((r) => kinds.includes(r.kind));

  const sections: StaffChatLandingSection[] = [
    { key: 'school', title: 'School Announcement', rooms: pick(['school_announcement']) },
    { key: 'teachers', title: 'Teachers Announcement', rooms: pick(['teacher_announcement']) },
    { key: 'classes', title: 'Class Communities', communities },
    { key: 'dm', title: 'Messages', rooms: pick(['direct_message']) },
  ].filter((s) => {
    if (s.communities?.length) return true;
    if (s.rooms?.length) return true;
    return false;
  });

  return {
    sections,
    rooms: roomMap,
    communities,
    contacts,
  };
}

export async function getStaffChatContacts(input: {
  userId: string;
  branchId: string;
  academicYearId: string;
}) {
  const { getAdminContactPicker } = await import('../../chat/services/chat-contact-picker.service');
  return getAdminContactPicker(input);
}

export async function openStaffDirectMessage(input: {
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
