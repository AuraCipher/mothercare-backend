import { prisma } from '../../../lib/prisma';
import { ensureRoomMembership } from './chat-access.service';

/** Reconcile group_chat memberships after role definition or assignment changes. */
export async function syncClassRoleMemberships(communityId: string): Promise<void> {
  const community = await prisma.chatCommunity.findUnique({
    where: { id: communityId },
    select: { id: true, groupId: true, academicYearId: true, isActive: true },
  });
  if (!community?.isActive) return;

  const groupChatRooms = await prisma.chatRoom.findMany({
    where: { communityId, kind: 'group_chat', isActive: true },
    select: { id: true },
  });
  if (groupChatRooms.length === 0) return;

  const students = await prisma.student.findMany({
    where: {
      groupId: community.groupId,
      academicYearId: community.academicYearId,
      userId: { not: null },
    },
    select: { userId: true },
  });

  const activeAssignments = await prisma.classRoleAssignment.findMany({
    where: {
      communityId,
      removedAt: null,
      userId: { not: null },
      roleDefinition: { isActive: true },
    },
    select: {
      id: true,
      userId: true,
      publicDisplayName: true,
      isMessagingRestricted: true,
      roleDefinition: { select: { canPostInGroups: true } },
    },
  });

  const assignmentsByUser = new Map<string, typeof activeAssignments>();
  for (const assignment of activeAssignments) {
    if (!assignment.userId) continue;
    const list = assignmentsByUser.get(assignment.userId) ?? [];
    list.push(assignment);
    assignmentsByUser.set(assignment.userId, list);
  }

  for (const room of groupChatRooms) {
    for (const student of students) {
      if (!student.userId) continue;
      const userAssignments = assignmentsByUser.get(student.userId) ?? [];
      const postingAssignment = userAssignments.find(
        (a) => a.roleDefinition.canPostInGroups && !a.isMessagingRestricted,
      );
      const isPostingRestricted =
        userAssignments.length > 0 &&
        userAssignments.every((a) => a.isMessagingRestricted || !a.roleDefinition.canPostInGroups);

      await ensureRoomMembership(room.id, student.userId, {
        access: 'member',
        canPost: !!postingAssignment,
        displayTitle: postingAssignment?.publicDisplayName ?? null,
        classRoleAssignmentId: postingAssignment?.id ?? null,
        isPostingRestricted,
      });
    }
  }
}
