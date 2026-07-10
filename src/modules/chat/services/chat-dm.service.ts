import { prisma } from '../../../lib/prisma';
import { ensureRoomMembership } from './chat-access.service';

function orderedParticipants(userA: string, userB: string): [string, string] {
  return userA < userB ? [userA, userB] : [userB, userA];
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

  const [participantAId, participantBId] = orderedParticipants(input.userId, input.participantUserId);

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
  if (existing?.room) return existing.room;

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

  await prisma.chatDmThread.create({
    data: {
      academicYearId: input.academicYearId,
      roomId: room.id,
      participantAId,
      participantBId,
    },
  });

  await ensureRoomMembership(room.id, input.userId, { access: 'member', canPost: true });
  await ensureRoomMembership(room.id, input.participantUserId, { access: 'member', canPost: true });

  return room;
}
