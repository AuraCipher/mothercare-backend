import { Router, Request, Response, NextFunction } from 'express';
import auth from '../../../middleware/auth/auth.middleware';
import { listRoomsForUser } from '../services/chat-access.service';
import { listRoomMessages } from '../services/chat-message.service';
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
