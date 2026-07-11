import { prisma } from '../../../lib/prisma';
import { enqueueChatPushFanout } from '../../../queues/chat.queue';
import { getChatIo } from '../socket/chat.socket';
import { listOfflineRecipientUserIds } from './chat-message.service';

const SYSTEM_PUSH_ROOM_KINDS = new Set([
  'system_attendance',
  'system_payment',
  'system_result',
  'system_teacher_attendance',
  'system_teacher_payroll',
]);

type SystemMessage = {
  id: string;
  roomId: string;
  type: string;
  title: string | null;
  content: string | null;
  createdAt: Date;
  room: { name: string; kind: string };
};

export async function fanoutSystemChatMessage(message: SystemMessage) {
  const io = getChatIo();
  const envelope = {
    id: message.id,
    roomId: message.roomId,
    type: message.type,
    title: message.title,
    content: message.content,
    mediaFileId: null,
    mediaFile: null,
    sender: { id: 'system', name: 'School', role: 'system' },
    createdAt: message.createdAt.toISOString(),
  };

  io?.to(`room:${message.roomId}`).emit('chat:message:new', envelope);

  if (!SYSTEM_PUSH_ROOM_KINDS.has(message.room.kind)) return;

  const recipients = await listOfflineRecipientUserIds(message.roomId, 'system');
  if (recipients.length === 0) return;

  const keyRow = await prisma.userPushCryptoKey.findFirst({
    where: { userId: recipients[0] },
    orderBy: { keyVersion: 'desc' },
  });

  await enqueueChatPushFanout({
    roomId: message.roomId,
    messageId: message.id,
    senderId: 'system',
    recipientUserIds: recipients,
    preview: (message.content || message.title || 'School update').slice(0, 120),
    roomName: message.room.name,
    keyVersion: keyRow?.keyVersion ?? 1,
  });
}
