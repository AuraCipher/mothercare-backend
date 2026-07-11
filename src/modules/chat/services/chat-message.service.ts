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

const messageInclude = {
  sender: { select: { id: true, name: true, role: true } },
  mediaFile: { select: { id: true, mimeType: true, publicUrl: true, purpose: true } },
} as const;

export async function deleteRoomMessage(messageId: string, userId: string) {
  const message = await prisma.chatMessage.findUnique({ where: { id: messageId } });
  if (!message || message.isDeleted) {
    throw { status: 404, message: 'Message not found' };
  }
  await ensureStudentSystemRoomAccess(message.roomId, userId);
  await assertRoomMember(message.roomId, userId);
  if (message.senderId !== userId) {
    throw { status: 403, message: 'Only the sender can delete this message' };
  }

  return prisma.chatMessage.update({
    where: { id: messageId },
    data: { isDeleted: true, deletedAt: new Date() },
    include: messageInclude,
  });
}

export async function updateRoomMessage(messageId: string, userId: string, content: string) {
  const trimmed = content.trim();
  if (!trimmed) {
    throw { status: 400, message: 'Content is required' };
  }

  const message = await prisma.chatMessage.findUnique({ where: { id: messageId } });
  if (!message || message.isDeleted) {
    throw { status: 404, message: 'Message not found' };
  }
  if (message.type !== 'text' || message.mediaFileId) {
    throw { status: 400, message: 'Only text messages can be edited' };
  }
  await ensureStudentSystemRoomAccess(message.roomId, userId);
  await assertRoomMember(message.roomId, userId);
  if (message.senderId !== userId) {
    throw { status: 403, message: 'Only the sender can edit this message' };
  }
  await assertCanPost(message.roomId, userId);

  return prisma.chatMessage.update({
    where: { id: messageId },
    data: { content: trimmed },
    include: messageInclude,
  });
}

export async function listOfflineRecipientUserIds(roomId: string, excludeUserId: string): Promise<string[]> {
  const members = await prisma.chatRoomMember.findMany({
    where: { roomId, leftAt: null, canRead: true, userId: { not: excludeUserId } },
    select: { userId: true },
  });
  return members.map((m) => m.userId);
}
