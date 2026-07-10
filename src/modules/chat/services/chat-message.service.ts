import { prisma } from '../../../lib/prisma';
import type { ChatMessageType } from '@prisma/client';
import { assertCanPost, assertRoomMember } from './chat-access.service';
import { ensureStudentSystemRoomAccess } from './chat-student-room-access.service';

export async function listRoomMessages(
  roomId: string,
  userId: string,
  opts: { cursor?: string; limit?: number } = {},
) {
  await ensureStudentSystemRoomAccess(roomId, userId);
  await assertRoomMember(roomId, userId);
  const limit = Math.min(opts.limit ?? 40, 100);

  const messages = await prisma.chatMessage.findMany({
    where: { roomId, isDeleted: false, ...(opts.cursor ? { createdAt: { lt: new Date(opts.cursor) } } : {}) },
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: {
      sender: { select: { id: true, name: true, role: true, profilePhotoId: true } },
      mediaFile: { select: { id: true, mimeType: true, publicUrl: true, purpose: true } },
    },
  });

  return messages.reverse();
}

export async function createRoomMessage(input: {
  roomId: string;
  senderId: string;
  type?: ChatMessageType;
  title?: string;
  content?: string;
  mediaFileId?: string;
  replyToId?: string;
  metadata?: Record<string, unknown>;
}) {
  await assertCanPost(input.roomId, input.senderId);

  const message = await prisma.chatMessage.create({
    data: {
      roomId: input.roomId,
      senderId: input.senderId,
      type: input.type ?? 'text',
      title: input.title,
      content: input.content,
      mediaFileId: input.mediaFileId,
      replyToId: input.replyToId,
      metadata: input.metadata as object | undefined,
    },
    include: {
      sender: { select: { id: true, name: true, role: true } },
      room: { select: { academicYearId: true, name: true, kind: true } },
      mediaFile: { select: { id: true, mimeType: true, publicUrl: true, purpose: true } },
    },
  });

  await prisma.chatRoom.update({
    where: { id: input.roomId },
    data: { updatedAt: new Date() },
  });

  return message;
}

export async function markRoomRead(roomId: string, userId: string, messageId?: string) {
  await ensureStudentSystemRoomAccess(roomId, userId);
  await assertRoomMember(roomId, userId);
  const lastMessage = messageId
    ? await prisma.chatMessage.findUnique({ where: { id: messageId } })
    : await prisma.chatMessage.findFirst({ where: { roomId, isDeleted: false }, orderBy: { createdAt: 'desc' } });

  await prisma.chatMessageReadState.upsert({
    where: { roomId_userId: { roomId, userId } },
    create: {
      roomId,
      userId,
      lastReadMessageId: lastMessage?.id,
      lastReadAt: new Date(),
    },
    update: {
      lastReadMessageId: lastMessage?.id,
      lastReadAt: new Date(),
    },
  });
}

export async function listOfflineRecipientUserIds(roomId: string, excludeUserId: string): Promise<string[]> {
  const members = await prisma.chatRoomMember.findMany({
    where: { roomId, leftAt: null, canRead: true, userId: { not: excludeUserId } },
    select: { userId: true },
  });
  return members.map((m) => m.userId);
}
