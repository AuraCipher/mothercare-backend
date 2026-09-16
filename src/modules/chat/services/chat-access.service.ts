import { prisma } from '../../../lib/prisma';
import type { ChatMemberAccess, ChatRoomKind } from '@prisma/client';
import { resolveCanPost } from './chat-permissions.service';
import { appChatAllowsPost } from './teacher-app-chat-permissions.service';
import { resolveTeacherPermissions } from '../../teacher/permissions/teacher-permissions.resolver';
import type { TeacherPortalPermissionsStored } from '../../teacher/permissions/teacher-permissions.types';

export async function assertRoomMember(roomId: string, userId: string) {
  const member = await prisma.chatRoomMember.findFirst({
    where: { roomId, userId, leftAt: null, canRead: true },
    include: { room: { select: { isActive: true, academicYearId: true } } },
  });
  if (!member || !member.room.isActive) {
    throw { status: 403, message: 'Not a member of this room' };
  }
  return member;
}

export async function assertCanPost(roomId: string, userId: string) {
  const member = await assertRoomMember(roomId, userId);
  if (member.isPostingRestricted || member.isMuted) {
    throw { status: 403, message: 'Posting is restricted in this room' };
  }
  const room = await prisma.chatRoom.findUnique({ where: { id: roomId } });
  if (!room) {
    throw { status: 404, message: 'Room not found' };
  }
  const allowed = await resolveCanPost(userId, room, member);
  if (!allowed) {
    throw { status: 403, message: 'Posting is not allowed in this room' };
  }
  return member;
}

export async function ensureRoomMembership(
  roomId: string,
  userId: string,
  opts: {
    access?: ChatMemberAccess;
    canPost?: boolean;
    displayTitle?: string | null;
    classRoleAssignmentId?: string | null;
    isPostingRestricted?: boolean;
  } = {},
) {
  const update: Record<string, unknown> = {
    leftAt: null,
    canRead: true,
  };
  if (opts.access) update.access = opts.access;
  if (opts.canPost !== undefined) update.canPost = opts.canPost;
  if (opts.displayTitle !== undefined) update.displayTitle = opts.displayTitle;
  if (opts.classRoleAssignmentId !== undefined) {
    update.classRoleAssignmentId = opts.classRoleAssignmentId;
  }
  if (opts.isPostingRestricted !== undefined) {
    update.isPostingRestricted = opts.isPostingRestricted;
  }

  await prisma.chatRoomMember.upsert({
    where: { roomId_userId: { roomId, userId } },
    create: {
      roomId,
      userId,
      access: opts.access ?? 'member',
      canPost: opts.canPost ?? false,
      canRead: true,
      displayTitle: opts.displayTitle ?? undefined,
      classRoleAssignmentId: opts.classRoleAssignmentId ?? undefined,
      isPostingRestricted: opts.isPostingRestricted ?? false,
    },
    update,
  });
}

export async function listUserRoomIds(userId: string, academicYearId: string): Promise<string[]> {
  const rows = await prisma.chatRoomMember.findMany({
    where: {
      userId,
      leftAt: null,
      canRead: true,
      room: { academicYearId, isActive: true },
    },
    select: { roomId: true },
  });
  return rows.map((r) => r.roomId);
}

export type RoomSummary = {
  id: string;
  kind: ChatRoomKind;
  name: string;
  description: string | null;
  communityId: string | null;
  classGroupId: string | null;
  onlyStaffCanPost: boolean;
  studentsCanPost: boolean;
  canPost: boolean;
  lastMessageAt: string | null;
  unreadCount: number;
};

// ═══════════════════════════════════════════════════════════════════
// BATCH CONTEXT — eliminates N+1 query pattern
// ═══════════════════════════════════════════════════════════════════

type ChatListContext = {
  userRole: string;
  userStatus: string;
  branchMemberships: Map<string, { role: string; isActive: boolean }>;
  branchChatSettings: Map<string, {
    schoolAnnouncementPosterUserIds: string[];
    teacherAnnouncementPosterUserIds: string[];
    allowAllTeachersTeacherAnnouncement: boolean;
  }>;
  teacherProfiles: Map<string, {
    portalAccess: string;
    portalPermissions: unknown;
    canViewParentContact: boolean;
    hodParentContactScope: string;
  }>;
  branchRecords: Map<string, {
    teacherParentContactEnabled: boolean;
    teachersCanMarkAttendance: boolean;
    teachersCanEnterMarks: boolean;
  }>;
  teacherAssignments: Map<string, Set<string>>; // classGroupId -> Set<teacherId>
  classTeacherAssignments: Map<string, Set<string>>; // classGroupId -> Set<teacherId> (isClassTeacher)
  fullGroupRooms: Map<string, { teacherAssignmentId: string | null; communityId: string | null }>;
  classRolePostMap: Map<string, boolean>; // communityId -> user has canPostInGroups role
  readStates: Map<string, { lastReadAt: Date | null }>;
  messageCounts: Map<string, number>; // roomId -> total non-deleted count
  messageCountAfter: Map<string, number>; // roomId -> count after lastReadAt
};

const BRANCH_CHAT_ADMIN_ROLES = new Set(['branch_admin', 'sub_admin', 'management']);
const PORTAL_ADMIN_USER_ROLES = new Set(['super_admin', 'management']);
const STAFF_ROLES = new Set(['teacher', 'management', 'branch_admin', 'sub_admin', 'super_admin', 'staff']);

function isBranchChatAdminFromContext(
  userId: string,
  branchId: string,
  ctx: ChatListContext,
): boolean {
  if (ctx.userStatus !== 'active') return false;
  const membership = ctx.branchMemberships.get(branchId);
  if (!membership?.isActive) return false;
  if (ctx.userRole === 'super_admin') return true;
  if (!PORTAL_ADMIN_USER_ROLES.has(ctx.userRole)) return false;
  return BRANCH_CHAT_ADMIN_ROLES.has(membership.role);
}

function resolveTeacherAppChatPost(
  userId: string,
  branchId: string | null | undefined,
  roomKind: ChatRoomKind,
  ctx: ChatListContext,
): boolean {
  if (!branchId) return true;
  if (ctx.userRole !== 'teacher' || ctx.userStatus !== 'active') return true;
  const profile = ctx.teacherProfiles.get(userId);
  if (!profile) return true;
  const branch = ctx.branchRecords.get(branchId);
  if (!branch) return true;

  const resolved = resolveTeacherPermissions({
    portalAccess: profile.portalAccess as any,
    isReadOnly: profile.portalAccess === 'READ_ONLY',
    isHod: false,
    stored: profile.portalPermissions as TeacherPortalPermissionsStored,
    legacy: {
      canViewParentContact: profile.canViewParentContact,
      hodParentContactScope: profile.hodParentContactScope as any,
    },
    branch,
  });
  return appChatAllowsPost(resolved.features.app, roomKind);
}

function computeCanPostFromContext(
  userId: string,
  room: {
    id: string;
    kind: ChatRoomKind;
    branchId: string | null;
    classGroupId: string | null;
    academicYearId: string;
    onlyStaffCanPost: boolean;
  },
  member: {
    canPost: boolean;
    access: string;
    isMuted: boolean;
    isPostingRestricted: boolean;
    canRead: boolean;
  },
  ctx: ChatListContext,
): boolean {
  if (!member.canRead || member.isMuted || member.isPostingRestricted) return false;

  if (room.kind === 'school_announcement') {
    if (!room.branchId) return false;
    const settings = ctx.branchChatSettings.get(room.branchId);
    const isAdmin = isBranchChatAdminFromContext(userId, room.branchId, ctx);
    const posterIds = settings?.schoolAnnouncementPosterUserIds ?? [];
    const roomAllowed = isAdmin || posterIds.includes(userId);
    return resolveTeacherAppChatPost(userId, room.branchId, room.kind, ctx) && roomAllowed;
  }

  if (room.kind === 'teacher_announcement') {
    if (!room.branchId) return false;
    const settings = ctx.branchChatSettings.get(room.branchId);
    const isAdmin = isBranchChatAdminFromContext(userId, room.branchId, ctx);
    let roomAllowed = isAdmin;
    if (!roomAllowed) {
      const allowAll = settings?.allowAllTeachersTeacherAnnouncement ?? false;
      if (allowAll) {
        const membership = ctx.branchMemberships.get(room.branchId);
        if (membership?.isActive && membership.role === 'teacher') roomAllowed = true;
      }
      if (!roomAllowed) {
        const posterIds = settings?.teacherAnnouncementPosterUserIds ?? [];
        if (posterIds.includes(userId)) roomAllowed = true;
      }
    }
    return resolveTeacherAppChatPost(userId, room.branchId, room.kind, ctx) && roomAllowed;
  }

  if (room.kind === 'class_announcement') {
    let roomAllowed = false;
    if (room.branchId && isBranchChatAdminFromContext(userId, room.branchId, ctx)) {
      roomAllowed = true;
    }
    if (!roomAllowed && room.classGroupId) {
      const teachers = ctx.classTeacherAssignments.get(room.classGroupId);
      if (teachers?.has(userId)) roomAllowed = true;
    }
    return resolveTeacherAppChatPost(userId, room.branchId, room.kind, ctx) && roomAllowed;
  }

  if (room.kind === 'group_chat') {
    let roomAllowed = false;
    if (room.branchId && isBranchChatAdminFromContext(userId, room.branchId, ctx)) {
      roomAllowed = true;
    }
    if (!roomAllowed) {
      const full = ctx.fullGroupRooms.get(room.id);
      if (full?.teacherAssignmentId) {
        const teachers = ctx.teacherAssignments.get(full.teacherAssignmentId);
        if (teachers?.has(userId)) roomAllowed = true;
      }
      if (!roomAllowed && full?.communityId) {
        if (ctx.classRolePostMap.get(full.communityId)) roomAllowed = true;
      }
    }
    return resolveTeacherAppChatPost(userId, room.branchId, room.kind, ctx) && roomAllowed;
  }

  if (room.kind === 'direct_message') {
    if (ctx.userStatus !== 'active') return false;
    if (STAFF_ROLES.has(ctx.userRole)) {
      if (ctx.userRole === 'teacher') {
        return resolveTeacherAppChatPost(userId, room.branchId, 'direct_message', ctx);
      }
      return true;
    }
    if (ctx.userRole === 'student') {
      return resolveTeacherAppChatPost(userId, room.branchId, 'direct_message', ctx);
    }
    return false;
  }

  if (!member.canPost && member.access === 'observer') return false;
  if (room.onlyStaffCanPost) {
    if (!ctx.userRole || !STAFF_ROLES.has(ctx.userRole)) return false;
  }
  return member.canPost;
}

async function buildChatListContext(
  userId: string,
  academicYearId: string,
  roomIds: string[],
  rooms: Array<{
    id: string;
    kind: ChatRoomKind;
    branchId: string | null;
    classGroupId: string | null;
  }>,
): Promise<ChatListContext> {
  const branchIds = [...new Set(rooms.map((r) => r.branchId).filter(Boolean))] as string[];
  const classGroupIds = [...new Set(rooms.map((r) => r.classGroupId).filter(Boolean))] as string[];
  const announcementKinds = new Set<ChatRoomKind>(['school_announcement', 'teacher_announcement']);
  const needsAnnouncementSettings = rooms.some((r) => announcementKinds.has(r.kind));
  const groupChatRooms = rooms.filter((r) => r.kind === 'group_chat');
  const dmRooms = rooms.filter((r) => r.kind === 'direct_message');

  // 1. User
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true, status: true },
  });

  // 2. Branch memberships
  const memberships = branchIds.length > 0
    ? await prisma.branchMember.findMany({
        where: { userId, branchId: { in: branchIds } },
        select: { branchId: true, role: true, isActive: true },
      })
    : [];

  // 3. Branch chat settings (use upsert to preserve creation side-effect)
  const branchChatSettings = new Map<string, {
    schoolAnnouncementPosterUserIds: string[];
    teacherAnnouncementPosterUserIds: string[];
    allowAllTeachersTeacherAnnouncement: boolean;
  }>();
  if (needsAnnouncementSettings && branchIds.length > 0) {
    const settingsResults = await Promise.all(
      branchIds.map((branchId) =>
        prisma.branchChatSettings.upsert({
          where: { branchId },
          create: { branchId },
          update: {},
        }),
      ),
    );
    for (const s of settingsResults) {
      branchChatSettings.set(s.branchId, {
        schoolAnnouncementPosterUserIds: s.schoolAnnouncementPosterUserIds,
        teacherAnnouncementPosterUserIds: s.teacherAnnouncementPosterUserIds,
        allowAllTeachersTeacherAnnouncement: s.allowAllTeachersTeacherAnnouncement,
      });
    }
  }

  // 4. Teacher profiles (only if user is teacher and has announcement/group/DM rooms)
  const needsTeacherProfile = user?.role === 'teacher' && (
    rooms.some((r) => announcementKinds.has(r.kind)) ||
    groupChatRooms.length > 0 ||
    dmRooms.length > 0
  );
  const teacherProfiles = new Map<string, {
    portalAccess: string;
    portalPermissions: unknown;
    canViewParentContact: boolean;
    hodParentContactScope: string;
  }>();
  if (needsTeacherProfile) {
    const profile = await prisma.teacherProfile.findUnique({
      where: { userId },
      select: {
        portalAccess: true,
        portalPermissions: true,
        canViewParentContact: true,
        hodParentContactScope: true,
      },
    });
    if (profile) teacherProfiles.set(userId, profile);
  }

  // 5. Branch records (for teacher app permissions resolution)
  const branchRecords = new Map<string, {
    teacherParentContactEnabled: boolean;
    teachersCanMarkAttendance: boolean;
    teachersCanEnterMarks: boolean;
  }>();
  if (needsTeacherProfile && branchIds.length > 0) {
    const branches = await prisma.branch.findMany({
      where: { id: { in: branchIds } },
      select: {
        id: true,
        teacherParentContactEnabled: true,
        teachersCanMarkAttendance: true,
        teachersCanEnterMarks: true,
      },
    });
    for (const b of branches) {
      branchRecords.set(b.id, {
        teacherParentContactEnabled: b.teacherParentContactEnabled,
        teachersCanMarkAttendance: b.teachersCanMarkAttendance,
        teachersCanEnterMarks: b.teachersCanEnterMarks,
      });
    }
  }

  // 6. Teacher assignments (for class_announcement and group_chat)
  const teacherAssignments = new Map<string, Set<string>>();
  const classTeacherAssignments = new Map<string, Set<string>>();
  const needTeacherAssignments = rooms.some(
    (r) => r.kind === 'class_announcement' || r.kind === 'group_chat',
  );
  if (needTeacherAssignments && classGroupIds.length > 0) {
    const ayIds = [...new Set([academicYearId])];
    const assignments = await prisma.teacherAssignment.findMany({
      where: {
        groupId: { in: classGroupIds },
        academicYearId: { in: ayIds },
      },
      select: { groupId: true, teacherId: true, isClassTeacher: true },
    });
    for (const a of assignments) {
      if (!teacherAssignments.has(a.groupId)) teacherAssignments.set(a.groupId, new Set());
      teacherAssignments.get(a.groupId)!.add(a.teacherId);
      if (a.isClassTeacher) {
        if (!classTeacherAssignments.has(a.groupId)) classTeacherAssignments.set(a.groupId, new Set());
        classTeacherAssignments.get(a.groupId)!.add(a.teacherId);
      }
    }
  }

  // 7. Full room records (for group_chat: teacherAssignmentId, communityId)
  const fullGroupRooms = new Map<string, { teacherAssignmentId: string | null; communityId: string | null }>();
  if (groupChatRooms.length > 0) {
    const fullRooms = await prisma.chatRoom.findMany({
      where: { id: { in: groupChatRooms.map((r) => r.id) } },
      select: { id: true, teacherAssignmentId: true, communityId: true },
    });
    for (const r of fullRooms) {
      fullGroupRooms.set(r.id, {
        teacherAssignmentId: r.teacherAssignmentId,
        communityId: r.communityId,
      });
    }
  }

  // 8. Class role assignments (for group_chat with community)
  const classRolePostMap = new Map<string, boolean>();
  const communityIds = [...new Set(
    groupChatRooms
      .map((r) => fullGroupRooms.get(r.id)?.communityId)
      .filter(Boolean),
  )] as string[];
  if (communityIds.length > 0) {
    const roleAssignments = await prisma.classRoleAssignment.findMany({
      where: {
        communityId: { in: communityIds },
        userId,
        removedAt: null,
        isMessagingRestricted: false,
        roleDefinition: { isActive: true, canPostInGroups: true },
      },
      select: { communityId: true },
    });
    for (const ra of roleAssignments) {
      if (ra.communityId) classRolePostMap.set(ra.communityId, true);
    }
  }

  // 9. Read states (batch)
  const readStateRows = roomIds.length > 0
    ? await prisma.chatMessageReadState.findMany({
        where: { roomId: { in: roomIds }, userId },
        select: { roomId: true, lastReadAt: true },
      })
    : [];
  const readStates = new Map(readStateRows.map((r) => [r.roomId, { lastReadAt: r.lastReadAt }]));

  // 10. Message counts (batch: total per room + count after lastReadAt per room)
  const messageCounts = new Map<string, number>();
  const messageCountAfter = new Map<string, number>();

  if (roomIds.length > 0) {
    // Total non-deleted messages per room
    const totalRows = await prisma.chatMessage.groupBy({
      by: ['roomId'],
      where: { roomId: { in: roomIds }, isDeleted: false },
      _count: { id: true },
    });
    for (const row of totalRows) {
      messageCounts.set(row.roomId, row._count.id);
    }

    // Per-room count after each room's lastReadAt (only for rooms with a read state)
    const roomsWithReadState = roomIds.filter((rid) => readStates.has(rid));
    if (roomsWithReadState.length > 0) {
      const afterRows = await Promise.all(
        roomsWithReadState.map((rid) => {
          const lastReadAt = readStates.get(rid)!.lastReadAt;
          if (!lastReadAt) return Promise.resolve({ roomId: rid, count: 0 });
          return prisma.chatMessage.count({
            where: { roomId: rid, isDeleted: false, createdAt: { gt: lastReadAt } },
          }).then((count) => ({ roomId: rid, count }));
        }),
      );
      for (const row of afterRows) {
        messageCountAfter.set(row.roomId, row.count);
      }
    }
  }

  return {
    userRole: user?.role ?? '',
    userStatus: user?.status ?? '',
    branchMemberships: new Map(memberships.map((m) => [m.branchId, { role: m.role, isActive: m.isActive }])),
    branchChatSettings,
    teacherProfiles,
    branchRecords,
    teacherAssignments,
    classTeacherAssignments,
    fullGroupRooms,
    classRolePostMap,
    readStates,
    messageCounts,
    messageCountAfter,
  };
}

export async function listRoomsForUser(userId: string, academicYearId: string): Promise<RoomSummary[]> {
  const memberships = await prisma.chatRoomMember.findMany({
    where: {
      userId,
      leftAt: null,
      canRead: true,
      room: { academicYearId, isActive: true },
    },
    include: {
      room: {
        include: {
          messages: {
            take: 1,
            orderBy: { createdAt: 'desc' },
            select: { createdAt: true },
          },
        },
      },
    },
    orderBy: { room: { updatedAt: 'desc' } },
  });

  if (memberships.length === 0) return [];

  const roomIds = memberships.map((m) => m.roomId);
  const rooms = memberships.map((m) => ({
    id: m.room.id,
    kind: m.room.kind,
    branchId: m.room.branchId,
    classGroupId: m.room.classGroupId,
  }));

  const ctx = await buildChatListContext(userId, academicYearId, roomIds, rooms);

  const summaries: RoomSummary[] = memberships.map((m) => {
    const hasReadState = ctx.readStates.has(m.roomId);
    const unreadCount = hasReadState
      ? (ctx.messageCountAfter.get(m.roomId) ?? 0)
      : (ctx.messageCounts.get(m.roomId) ?? 0);

    return {
      id: m.room.id,
      kind: m.room.kind,
      name: m.room.name,
      description: m.room.description,
      communityId: m.room.communityId,
      classGroupId: m.room.classGroupId,
      onlyStaffCanPost: m.room.onlyStaffCanPost,
      studentsCanPost: m.room.studentsCanPost,
      canPost: computeCanPostFromContext(userId, m.room, m, ctx),
      lastMessageAt: m.room.messages[0]?.createdAt?.toISOString() ?? null,
      unreadCount,
    };
  });

  return summaries;
}
