import { Router, Request, Response, NextFunction } from 'express';
import auth from '../../../middleware/auth/auth.middleware';
import { listRoomsForUser } from '../services/chat-access.service';
import {
  deleteRoomMessage,
  listRoomMessages,
  updateRoomMessage,
} from '../services/chat-message.service';
import { getChatIo } from '../socket/chat.socket';
import { registerDeviceToken, removeDeviceToken } from '../push/device-token.service';

const router = Router();

const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => { fn(req, res, next).catch(next); };

router.use(auth);

router.get('/rooms', asyncHandler(async (req, res) => {
  const userId = (req as any).user.id;
  const academicYearId = req.query.academicYearId as string;
  if (!academicYearId) {
    res.status(400).json({ success: false, message: 'academicYearId is required' });
    return;
  }
  const rooms = await listRoomsForUser(userId, academicYearId);
  res.json({ success: true, data: rooms });
}));

router.get('/rooms/:roomId/messages', asyncHandler(async (req, res) => {
  const userId = (req as any).user.id;
  const { cursor, limit } = req.query;
  const messages = await listRoomMessages(req.params.roomId, userId, {
    cursor: cursor as string | undefined,
    limit: limit ? parseInt(limit as string, 10) : undefined,
  });
  res.json({ success: true, data: messages });
}));

router.delete('/messages/:messageId', asyncHandler(async (req, res) => {
  const userId = (req as any).user.id;
  const message = await deleteRoomMessage(req.params.messageId, userId);
  getChatIo()?.to(`room:${message.roomId}`).emit('chat:message:deleted', {
    id: message.id,
    roomId: message.roomId,
  });
  res.json({ success: true, data: message });
}));

router.patch('/messages/:messageId', asyncHandler(async (req, res) => {
  const userId = (req as any).user.id;
  const { content } = req.body ?? {};
  if (typeof content !== 'string') {
    res.status(400).json({ success: false, message: 'content is required' });
    return;
  }
  const message = await updateRoomMessage(req.params.messageId, userId, content);
  getChatIo()?.to(`room:${message.roomId}`).emit('chat:message:updated', {
    id: message.id,
    roomId: message.roomId,
    type: message.type,
    title: message.title,
    content: message.content,
    isDeleted: message.isDeleted,
    sender: message.sender,
    createdAt: message.createdAt.toISOString(),
    mediaFile: message.mediaFile
      ? {
          id: message.mediaFile.id,
          mimeType: message.mediaFile.mimeType,
          publicUrl: message.mediaFile.publicUrl,
          purpose: message.mediaFile.purpose,
        }
      : null,
  });
  res.json({ success: true, data: message });
}));

router.post('/devices', asyncHandler(async (req, res) => {
  const userId = (req as any).user.id;
  const { token, platform } = req.body;
  const row = await registerDeviceToken(userId, token, platform);
  res.status(201).json({ success: true, data: { id: row.id, platform: row.platform } });
}));

router.delete('/devices', asyncHandler(async (req, res) => {
  const userId = (req as any).user.id;
  const { token } = req.body;
  await removeDeviceToken(userId, token);
  res.json({ success: true });
}));

export default router;
