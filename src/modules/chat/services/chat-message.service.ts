import { prisma } from '../../../lib/prisma';
import logger from '../../../lib/logger';
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

  // M6: NO interactive transaction here by design. Flow: fast-path dedupe
  // read → auth reads → single atomic nested create (message + attachments
  // all-or-nothing) → P2002 race convergence. Every step uses at most one
  // pooled connection at a time and never holds one across awaits that wait
  // on other pool users — 25-way same-room bursts no longer starve the pool
  // (measured: 5s tx timeouts before, clean pass after).
  if (dedupeId) {
    const existing = await prisma.chatMessage.findFirst({
      where: { roomId: input.roomId, dedupeKey: dedupeId },
      include: messageIncludeFull,
    });
    if (existing) {
      if (!sameLogicalSend(existing, input.type ?? 'text', input.title, input.content, attachmentIds)) {
        throw { status: 409, message: 'clientMessageId was already used for different content' };
      }
      await touchRoomRecency(input.roomId);
      return { message: existing, duplicate: true };
    }
  }

  await assertCanPost(input.roomId, input.senderId);

  // R2-04: every attachment authorized individually — one failure aborts
  // the whole send (nothing is written yet).
  for (const fileId of attachmentIds) {
    const { allowed } = await authorizeChatMedia(input.senderId, input.roomId, fileId);
    if (!allowed) {
      throw { status: 403, message: 'Not authorized to attach this file' };
    }
  }

  let message: any;
  try {
    message = await prisma.chatMessage.create({
      data: {
        roomId: input.roomId,
        senderId: input.senderId,
        type: input.type ?? 'text',
        title: input.title,
        content: input.content,
        mediaFileId: attachmentIds[0],
        replyToId: input.replyToId,
        dedupeKey: dedupeId,
        metadata: {
          ...(input.metadata ?? {}),
          ...(dedupeId ? { dedupeId } : {}),
        } as object,
        ...(attachmentIds.length > 0
          ? {
              attachments: {
                createMany: {
                  data: attachmentIds.map((fileRecordId, sortOrder) => ({
                    fileRecordId,
                    sortOrder,
                  })),
                },
              },
            }
          : {}),
      },
      include: messageIncludeFull,
    });
  } catch (err: any) {
    // Lost the same-key race: resolve exactly like the fast path above.
    if (err?.code === 'P2002' && dedupeId) {
      const existing = await prisma.chatMessage.findFirst({
        where: { roomId: input.roomId, dedupeKey: dedupeId },
        include: messageIncludeFull,
      });
      if (existing) {
        if (!sameLogicalSend(existing, input.type ?? 'text', input.title, input.content, attachmentIds)) {
          throw { status: 409, message: 'clientMessageId was already used for different content' };
        }
        await touchRoomRecency(input.roomId);
        return { message: existing, duplicate: true };
      }
    }
    throw err;
  }

  await touchRoomRecency(input.roomId);
  return { message, duplicate: false };
}

/**
 * M6: room recency touch, deliberately OUTSIDE any transaction. Bumping
 * updatedAt serializes same-room sends on one row lock; doing it without a
 * pinned pool connection keeps bursts flowing. Best-effort: a failure only
 * leaves room-list ordering slightly stale.
 */
async function touchRoomRecency(roomId: string): Promise<void> {
  try {
    await prisma.chatRoom.update({
      where: { id: roomId },
      data: { updatedAt: new Date() },
    });
  } catch (err: any) {
    logger.error('chat:room-touch-failed', {
      roomId,
      error: err?.message || String(err),
    });
  }
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
    where: { roomId, dedupeKey: clientMessageId },
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
