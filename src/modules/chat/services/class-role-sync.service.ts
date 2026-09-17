import { prisma, basePrisma } from '../../../lib/prisma';

/**
 * Maximum rows per batch INSERT to stay well under PostgreSQL's 65535
 * parameter limit.  Each row uses 7 parameters → 200 rows = 1400 params
 * (2.1 % of limit).  Chosen to keep SQL string under 100 KB and bound
 * per-chunk execution time.
 */
const CHUNK_SIZE = 200;

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

type UpsertRow = {
  roomId: string; userId: string; access: string; canPost: boolean;
  displayTitle: string | null; classRoleAssignmentId: string | null; isPostingRestricted: boolean;
};

function buildBatchSql(rows: UpsertRow[]): { sql: string; params: unknown[] } {
  const parts: string[] = [];
  const params: unknown[] = [];
  let idx = 1;
  for (const v of rows) {
    const p = () => `$${idx++}`;
    params.push(
      v.roomId, v.userId, v.access, v.canPost,
      v.displayTitle, v.classRoleAssignmentId, v.isPostingRestricted,
    );
    parts.push(
      `INSERT INTO chat_room_members (id, "roomId", "userId", access, "canPost", "canRead", "displayTitle", "classRoleAssignmentId", "isPostingRestricted", "joinedAt", "createdAt", "updatedAt")
       VALUES (gen_random_uuid(), ${p()}, ${p()}, ${p()}, ${p()}, true, ${p()}, ${p()}, ${p()}, now(), now(), now())
       ON CONFLICT ("roomId", "userId")
       DO UPDATE SET "leftAt" = NULL, access = EXCLUDED.access, "canPost" = EXCLUDED."canPost", "canRead" = true,
                    "displayTitle" = EXCLUDED."displayTitle", "classRoleAssignmentId" = EXCLUDED."classRoleAssignmentId",
                    "isPostingRestricted" = EXCLUDED."isPostingRestricted", "updatedAt" = now()`,
    );
  }
  return { sql: parts.join(';\n'), params };
}

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

  const upsertValues: UpsertRow[] = [];

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

      upsertValues.push({
        roomId: room.id, userId: student.userId, access: 'member',
        canPost: !!postingAssignment, displayTitle: postingAssignment?.publicDisplayName ?? null,
        classRoleAssignmentId: postingAssignment?.id ?? null, isPostingRestricted,
      });
    }
  }

  if (upsertValues.length === 0) return;

  // Chunk into bounded batches to avoid giant SQL strings and stay
  // well under PostgreSQL's65535-parameter limit (200 rows × 7 = 1400).
  const chunks = chunkArray(upsertValues, CHUNK_SIZE);
  for (const chunk of chunks) {
    const { sql, params } = buildBatchSql(chunk);
    await basePrisma.$executeRawUnsafe(sql, ...params);
  }
}
