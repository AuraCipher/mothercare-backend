import { prisma } from '../../../lib/prisma';
import { ensureRoomMembership } from './chat-access.service';
import {
  assertCanCreateDirectMessage,
  canUserSendInDirectMessage,
} from './chat-dm-policy.service';

function orderedParticipants(userA: string, userB: string): [string, string] {
  return userA < userB ? [userA, userB] : [userB, userA];
}

async function syncDmMembershipCanPost(
  roomId: string,
  input: {
    userId: string;
    participantUserId: string;
    branchId: string;
    academicYearId: string;
  },
) {
  const [initiatorCanPost, participantCanPost] = await Promise.all([
    canUserSendInDirectMessage(input.userId, input.branchId, input.academicYearId),
    canUserSendInDirectMessage(
      input.participantUserId,
      input.branchId,
      input.academicYearId,
    ),
  ]);

  await ensureRoomMembership(roomId, input.userId, {
    access: 'member',
    canPost: initiatorCanPost,
    isPostingRestricted: !initiatorCanPost,
  });
  await ensureRoomMembership(roomId, input.participantUserId, {
    access: 'member',
    canPost: participantCanPost,
    isPostingRestricted: !participantCanPost,
  });
}

export async function ensureDirectMessageRoom(input: {
  academicYearId: string;
  branchId: string;
  userId: string;
  participantUserId: string;
}) {
  if (input.userId === input.participantUserId) {
    throw { status: 400, message: 'Cannot message yourself' };
  }

  const [participantAId, participantBId] = orderedParticipants(
    input.userId,
    input.participantUserId,
  );

  const existing = await prisma.chatDmThread.findUnique({
    where: {
      academicYearId_participantAId_participantBId: {
        academicYearId: input.academicYearId,
        participantAId,
        participantBId,
      },
    },
    include: { room: true },
  });

  if (existing?.room) {
    await syncDmMembershipCanPost(existing.room.id, input);
    return existing.room;
  }

  await assertCanCreateDirectMessage({
    initiatorUserId: input.userId,
    participantUserId: input.participantUserId,
    branchId: input.branchId,
    academicYearId: input.academicYearId,
  });

  const participant = await prisma.user.findUnique({
    where: { id: input.participantUserId },
    select: { id: true, name: true, status: true },
  });
  if (!participant || participant.status !== 'active') {
    throw { status: 404, message: 'Contact not found' };
  }

  const room = await prisma.chatRoom.create({
    data: {
      academicYearId: input.academicYearId,
      branchId: input.branchId,
      kind: 'direct_message',
      name: participant.name,
      source: 'manual',
      onlyStaffCanPost: false,
      studentsCanPost: true,
    },
  });

  try {
    await prisma.chatDmThread.create({
      data: {
        academicYearId: input.academicYearId,
        roomId: room.id,
        participantAId,
        participantBId,
      },
    });
  } catch (err: any) {
    // M7: simultaneous initiation from both sides raced past the lookup above.
    // Converge onto the winner's room instead of 500ing with an orphan room:
    // remove our room (it has no members/messages yet) and return the thread
    // that won the unique (AY, A, B) race.
    if (err?.code === 'P2002') {
      await prisma.chatRoom.deleteMany({ where: { id: room.id } }).catch(() => undefined);
      const winner = await prisma.chatDmThread.findUnique({
        where: {
          academicYearId_participantAId_participantBId: {
            academicYearId: input.academicYearId,
            participantAId,
            participantBId,
          },
        },
        include: { room: true },
      });
      if (winner?.room) {
        await syncDmMembershipCanPost(winner.room.id, input);
        return winner.room;
      }
    }
    throw err;
  }

  await syncDmMembershipCanPost(room.id, input);

  return room;
}
