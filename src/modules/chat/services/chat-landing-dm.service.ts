import { prisma } from '../../../lib/prisma';
import type { RoomSummary } from './chat-access.service';

/**
 * Landing screens should not surface DMs with yourself or CEO (super_admin).
 * Picker flows may still open existing threads when needed.
 */
export async function filterLandingDirectMessageRooms(
  userId: string,
  academicYearId: string,
  rooms: RoomSummary[],
): Promise<RoomSummary[]> {
  const dmRooms = rooms.filter((r) => r.kind === 'direct_message');
  if (dmRooms.length === 0) return rooms;

  const threads = await prisma.chatDmThread.findMany({
    where: {
      academicYearId,
      roomId: { in: dmRooms.map((r) => r.id) },
      OR: [{ participantAId: userId }, { participantBId: userId }],
    },
    select: { roomId: true, participantAId: true, participantBId: true },
  });

  if (threads.length === 0) return rooms;

  const otherByRoom = new Map<string, string>();
  for (const thread of threads) {
    const other =
      thread.participantAId === userId ? thread.participantBId : thread.participantAId;
    otherByRoom.set(thread.roomId, other);
  }

  const otherIds = [...new Set(otherByRoom.values())];
  const users = await prisma.user.findMany({
    where: { id: { in: otherIds } },
    select: { id: true, role: true },
  });
  const roleById = new Map(users.map((u) => [u.id, u.role]));

  const hiddenRoomIds = new Set<string>();
  for (const [roomId, otherId] of otherByRoom) {
    if (otherId === userId || roleById.get(otherId) === 'super_admin') {
      hiddenRoomIds.add(roomId);
    }
  }

  if (hiddenRoomIds.size === 0) return rooms;
  return rooms.filter((r) => r.kind !== 'direct_message' || !hiddenRoomIds.has(r.id));
}
