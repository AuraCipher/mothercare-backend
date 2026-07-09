import { Server as HttpServer } from 'http';
import { Server, type Socket } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { Redis } from 'ioredis';
import env from '../../../config/env';
import { getRedisConnectionConfig } from '../../../config/redis-tcp';
import logger from '../../../lib/logger';
import { verifyToken } from '../../../lib/jwt';
import { createRoomMessage, markRoomRead, listOfflineRecipientUserIds } from '../services/chat-message.service';
import { assertRoomMember, listUserRoomIds } from '../services/chat-access.service';
import { enqueueChatPushFanout } from '../../../queues/chat.queue';
import { prisma } from '../../../lib/prisma';

let io: Server | null = null;

async function authenticateSocket(socket: Socket): Promise<{ id: string; role: string; name: string } | null> {
  const token = socket.handshake.auth?.token || socket.handshake.headers?.authorization?.toString().replace(/^Bearer\s+/i, '');
  if (!token) return null;
  try {
    const payload = verifyToken(token) as { id: string; role: string; name: string };
    return payload;
  } catch {
    return null;
  }
}

export async function initChatSocket(server: HttpServer): Promise<Server | null> {
  if (io) return io;

  io = new Server(server, {
    path: env.SOCKET_PATH,
    cors: {
      origin: env.APP_MODE === 'development' ? true : (env.ALLOWED_ORIGINS?.split(',').map((o: string) => o.trim()) ?? []),
      credentials: true,
    },
  });

  const redisConfig = getRedisConnectionConfig();
  if (redisConfig) {
    const pub = new Redis(redisConfig);
    const sub = pub.duplicate();
    io.adapter(createAdapter(pub, sub));
    logger.info('Socket.IO Redis adapter enabled');
  }

  io.use(async (socket, next) => {
    const user = await authenticateSocket(socket);
    if (!user) return next(new Error('Unauthorized'));
    (socket as any).user = user;
    next();
  });

  io.on('connection', (socket) => {
    const user = (socket as any).user as { id: string; role: string; name: string };

    socket.on('chat:join', async (payload: { academicYearId: string }) => {
      try {
        const roomIds = await listUserRoomIds(user.id, payload.academicYearId);
        for (const roomId of roomIds) {
          socket.join(`room:${roomId}`);
        }
        socket.emit('chat:joined', { roomCount: roomIds.length });
      } catch (err: unknown) {
        socket.emit('chat:error', { message: err instanceof Error ? err.message : 'join failed' });
      }
    });

    socket.on('chat:room:join', async (payload: { roomId: string }) => {
      try {
        await assertRoomMember(payload.roomId, user.id);
        socket.join(`room:${payload.roomId}`);
        socket.emit('chat:room:joined', { roomId: payload.roomId });
      } catch (err: any) {
        socket.emit('chat:error', { message: err?.message || 'forbidden' });
      }
    });

    socket.on('chat:message:send', async (payload: {
      roomId: string;
      type?: string;
      content?: string;
      title?: string;
      mediaFileId?: string;
      replyToId?: string;
    }) => {
      try {
        const message = await createRoomMessage({
          roomId: payload.roomId,
          senderId: user.id,
          type: (payload.type as any) ?? 'text',
          content: payload.content,
          title: payload.title,
          mediaFileId: payload.mediaFileId,
          replyToId: payload.replyToId,
        });

        const envelope = {
          id: message.id,
          roomId: message.roomId,
          type: message.type,
          title: message.title,
          content: message.content,
          mediaFileId: message.mediaFileId,
          sender: message.sender,
          createdAt: message.createdAt.toISOString(),
        };

        io?.to(`room:${payload.roomId}`).emit('chat:message:new', envelope);

        const recipients = await listOfflineRecipientUserIds(payload.roomId, user.id);
        const keyRow = await prisma.userPushCryptoKey.findFirst({
          where: { userId: recipients[0] },
          orderBy: { keyVersion: 'desc' },
        });
        await enqueueChatPushFanout({
          roomId: payload.roomId,
          messageId: message.id,
          senderId: user.id,
          recipientUserIds: recipients,
          preview: (payload.content || payload.title || 'New message').slice(0, 120),
          roomName: message.room.name,
          keyVersion: keyRow?.keyVersion ?? 1,
        });
      } catch (err: any) {
        socket.emit('chat:error', { message: err?.message || 'send failed' });
      }
    });

    socket.on('chat:message:read', async (payload: { roomId: string; messageId?: string }) => {
      try {
        await markRoomRead(payload.roomId, user.id, payload.messageId);
        socket.to(`room:${payload.roomId}`).emit('chat:message:read', {
          roomId: payload.roomId,
          userId: user.id,
          messageId: payload.messageId,
        });
      } catch (err: any) {
        socket.emit('chat:error', { message: err?.message || 'read failed' });
      }
    });
  });

  logger.info('Socket.IO chat server ready', { path: env.SOCKET_PATH });
  return io;
}

export function getChatIo(): Server | null {
  return io;
}

export async function closeChatSocket(): Promise<void> {
  if (io) {
    await io.close();
    io = null;
  }
}
