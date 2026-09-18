import { prisma } from '../../../lib/prisma';
import type { ChatMessageType } from '@prisma/client';
import { assertCanPost, assertRoomMember } from './chat-access.service';
import { ensureChatRoomAccess } from './chat-room-access.service';
import { ensureStudentSystemRoomAccess } from './chat-student-room-access.service';
import { authorizeChatMedia } from '../../upload/upload-authorization';

export const MAX_CHAT_ATTACHMENTS = 100;

const attachmentFileSelect = {
  id: true,
  mimeType: true,
  publicUrl: true,
  purpose: true,
} as const;

/** Ordered attachment rows with the file payload new clients render. */
export const chatMessageAttachmentsInclude = {
  attachments: {
    orderBy: { sortOrder: 'asc' },
    include: { fileRecord: { select: attachmentFileSelect } },
  },
} as const;

export async function listRoomMessages(
  roomId: string,
  userId: string,
  opts: { cursor?: string; limit?: number } = {},
) {
  await ensureChatRoomAccess(roomId, userId);
  await assertRoomMember(roomId, userId);
  const limit = Math.min(opts.limit ?? 40, 100);

  const messages = await prisma.chatMessage.findMany({
    where: { roomId, isDeleted: false, ...(opts.cursor ? { createdAt: { lt: new Date(opts.cursor) } } : {}) },
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: {
      sender: { select: { id: true, name: true, role: true, profilePhotoId: true } },
      mediaFile: { select: { id: true, mimeType: true, publicUrl: true, purpose: true } },
      ...chatMessageAttachmentsInclude,
    },
  });

  // Wire shape contract: history attachments use the SAME flat envelope shape
  // as chat:message:new ({id,mimeType,publicUrl,purpose} in sortOrder).
  // Row ids/sortOrder are transport details — order is positional.
  return messages.reverse().map((m) => ({ ...m, attachments: toEnvelopeAttachments(m) }));
}

// Shared include for single-message reads (update/delete paths).
const messageInclude = {
  sender: { select: { id: true, name: true, role: true } },
  mediaFile: { select: { id: true, mimeType: true, publicUrl: true, purpose: true } },
  ...chatMessageAttachmentsInclude,
} as const;

const messageIncludeFull = {
  sender: { select: { id: true, name: true, role: true } },
  room: { select: { academicYearId: true, name: true, kind: true } },
  mediaFile: { select: attachmentFileSelect },
  ...chatMessageAttachmentsInclude,
} as const;

/** Flattened envelope attachment shape shared by socket + history consumers. */
export function toEnvelopeAttachments(
  message: { attachments?: Array<{ fileRecord: { id: string; mimeType: string; publicUrl: string | null; purpose: string | null } }> },
): Array<{ id: string; mimeType: string; publicUrl: string | null; purpose: string | null }> {
  return (message.attachments ?? []).map((a) => ({
    id: a.fileRecord.id,
    mimeType: a.fileRecord.mimeType,
    publicUrl: a.fileRecord.publicUrl,
    purpose: a.fileRecord.purpose,
  }));
}

export function envelopeClientMessageId(message: { metadata?: unknown }): string | null {
  const meta = message.metadata as Record<string, unknown> | null | undefined;
  const id = meta?.dedupeId;
  return typeof id === 'string' ? id : null;
}

/**
 * M5: same-key conflict rule. A retry must carry the identical logical
 * payload (type, title, content, ordered attachment ids); anything else is a
 * key collision across unrelated messages and is rejected, never merged.
 */
export function sameLogicalSend(
  existing: {
    type: string;
    title?: string | null;
    content?: string | null;
    attachments?: Array<{ fileRecordId?: string; fileRecord?: { id: string } }>;
    mediaFileId?: string | null;
  },
  type: string,
  title: string | undefined,
  content: string | undefined,
  attachmentIds: string[],
): boolean {
  if (existing.type !== type) return false;
  if ((existing.title ?? undefined) !== title) return false;
  if ((existing.content ?? undefined) !== content) return false;
  const existingIds =
    existing.attachments && existing.attachments.length > 0
      ? existing.attachments.map((a) => a.fileRecordId ?? a.fileRecord?.id ?? '')
      : existing.mediaFileId
        ? [existing.mediaFileId]
        : [];
  if (existingIds.length !== attachmentIds.length) return false;
  return existingIds.every((id, i) => id === attachmentIds[i]);
}

export async function createRoomMessage(input: {
  roomId: string;
  senderId: string;
  type?: ChatMessageType;
  title?: string;
  content?: string;
  mediaFileId?: string;
  /** M4: ordered attachment ids. Wins over mediaFileId; first id mirrors to mediaFileId. */
  mediaFileIds?: string[];
  replyToId?: string;
  metadata?: Record<string, unknown>;
  /** M4: client-generated send key for idempotent retry (stored as metadata.dedupeId). */
  clientMessageId?: string;
}): Promise<{ message: any; duplicate: boolean }> {
  // Normalize: explicit array wins; legacy single folds in; order preserved, dupes dropped.
  const rawIds = input.mediaFileIds ?? (input.mediaFileId ? [input.mediaFileId] : []);
  const attachmentIds = [...new Set(rawIds.filter((id) => typeof id === 'string' && id.length > 0))];
  if (attachmentIds.length > MAX_CHAT_ATTACHMENTS) {
    throw { status: 400, message: `Too many attachments (max ${MAX_CHAT_ATTACHMENTS})` };
  }

  let dedupeId: string | undefined;
  if (input.clientMessageId != null && input.clientMessageId !== '') {
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(input.clientMessageId)) {
      throw { status: 400, message: 'clientMessageId must be 8-64 URL-safe characters' };
    }
    dedupeId = input.clientMessageId;
  }

  return prisma.$transaction(async (tx) => {
    // Idempotent replay: a retried send with the same key returns the original.
    // A reused key with DIFFERENT content is rejected deterministically (409)
    // instead of merging unrelated messages.
    if (dedupeId) {
      const existing = await tx.chatMessage.findFirst({
        where: { roomId: input.roomId, metadata: { path: ['dedupeId'], equals: dedupeId } },
        include: messageIncludeFull,
      });
      if (existing) {
        if (!sameLogicalSend(existing, input.type ?? 'text', input.title, input.content, attachmentIds)) {
          throw { status: 409, message: 'clientMessageId was already used for different content' };
        }
        return { message: existing, duplicate: true };
      }
    }

    await assertCanPost(input.roomId, input.senderId);

    // R2-04: every attachment authorized individually — one failure aborts
    // the whole send (transaction rolls back; no partial message).
    for (const fileId of attachmentIds) {
      const { allowed } = await authorizeChatMedia(input.senderId, input.roomId, fileId);
      if (!allowed) {
        throw { status: 403, message: 'Not authorized to attach this file' };
      }
    }

    const message = await tx.chatMessage.create({
      data: {
        roomId: input.roomId,
        senderId: input.senderId,
        type: input.type ?? 'text',
        title: input.title,
        content: input.content,
        mediaFileId: attachmentIds[0],
        replyToId: input.replyToId,
        metadata: {
          ...(input.metadata ?? {}),
          ...(dedupeId ? { dedupeId } : {}),
        } as object,
      },
      include: {
        sender: { select: { id: true, name: true, role: true } },
        room: { select: { academicYearId: true, name: true, kind: true } },
        mediaFile: { select: attachmentFileSelect },
      },
    });

    if (attachmentIds.length > 0) {
      await tx.chatMessageAttachment.createMany({
        data: attachmentIds.map((fileRecordId, sortOrder) => ({
          messageId: message.id,
          fileRecordId,
          sortOrder,
        })),
        skipDuplicates: true,
      });
    }

    await tx.chatRoom.update({
      where: { id: input.roomId },
      data: { updatedAt: new Date() },
    });

    const full = await tx.chatMessage.findUniqueOrThrow({
      where: { id: message.id },
      include: messageIncludeFull,
    });
    return { message: full, duplicate: false };
  });
}

/**
 * M5: send-intent reconciliation lookup. Returns the message previously
 * created under (roomId, clientMessageId), or null. Membership-gated like
 * history reads; wire shape matches listRoomMessages (flat attachments).
 */
export async function findMessageByClientKey(
  roomId: string,
  userId: string,
  clientMessageId: string,
) {
  await ensureChatRoomAccess(roomId, userId);
  await assertRoomMember(roomId, userId);
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(clientMessageId)) {
    throw { status: 400, message: 'clientMessageId must be 8-64 URL-safe characters' };
  }
  const message = await prisma.chatMessage.findFirst({
    where: { roomId, metadata: { path: ['dedupeId'], equals: clientMessageId } },
    include: {
      sender: { select: { id: true, name: true, role: true, profilePhotoId: true } },
      mediaFile: { select: attachmentFileSelect },
      ...chatMessageAttachmentsInclude,
    },
  });
  if (!message) return null;
  return { ...message, attachments: toEnvelopeAttachments(message) };
}

export async function markRoomRead(roomId: string, userId: string, messageId?: string) {  await ensureChatRoomAccess(roomId, userId);
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
  // M4: messages carrying attachment rows are not editable either.
  const attachmentCount = await prisma.chatMessageAttachment.count({ where: { messageId } });
  if (attachmentCount > 0) {
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
