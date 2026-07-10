import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import authMiddleware from '../../middleware/auth/auth.middleware';
import { uploadDocumentPermissionMiddleware } from '../../middleware/auth/upload-document-permission.middleware';
import { uploadLimiter } from '../../middleware/security/rateLimiter';
import { uploadService } from './upload.service';
import { UPLOAD_ENTITY_TYPES } from './storage-paths';
import { prisma } from '../../lib/prisma';
import { teacherAppChatAllowsAttachments } from '../chat/services/teacher-app-chat-permissions.service';

const router = Router();

router.use(authMiddleware, uploadDocumentPermissionMiddleware);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1024 * 1024 * 1024 },
});

const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => { fn(req, res, next).catch(next); };

function isValidEntityType(value?: string): value is typeof UPLOAD_ENTITY_TYPES[number] {
  return Boolean(value && UPLOAD_ENTITY_TYPES.includes(value as typeof UPLOAD_ENTITY_TYPES[number]));
}

// ─── POST /api/upload — Upload a file (auth + rate limit) ──────────
router.post('/upload', uploadLimiter, upload.single('file'), asyncHandler(async (req: Request, res: Response) => {
  if (!req.file) {
    res.status(400).json({ success: false, message: 'No file provided' });
    return;
  }

  const userId = (req as any).user?.id;
  const purpose = req.body?.purpose || 'document';
  const entityTypeRaw = req.body?.entityType as string | undefined;
  if (entityTypeRaw && !isValidEntityType(entityTypeRaw)) {
    res.status(400).json({ success: false, message: `entityType must be one of: ${UPLOAD_ENTITY_TYPES.join(', ')}` });
    return;
  }
  const entityType = entityTypeRaw;
  const entityId = req.body?.entityId || undefined;
  const roomId = req.body?.roomId || undefined;
  const academicYearId = req.body?.academicYearId || undefined;
  const durationSecondsRaw = req.body?.durationSeconds;
  const durationSeconds =
    durationSecondsRaw != null && durationSecondsRaw !== ''
      ? parseFloat(String(durationSecondsRaw))
      : undefined;

  if (entityType === 'chat' && roomId && userId) {
    const room = await prisma.chatRoom.findUnique({
      where: { id: roomId },
      select: { branchId: true },
    });
    if (room?.branchId) {
      const attachmentsOk = await teacherAppChatAllowsAttachments(userId, room.branchId);
      if (!attachmentsOk) {
        res.status(403).json({
          success: false,
          message: 'Sending chat attachments is not allowed for your account',
        });
        return;
      }
    }
  }

  const result = await uploadService.uploadFile(req.file.buffer, req.file.originalname, {
    uploadedById: userId,
    purpose,
    entityType,
    entityId,
    roomId,
    academicYearId,
    durationSeconds,
  });

  res.status(201).json({ success: true, data: result });
}));

// ─── GET /api/uploads — List files by entity (auth required) ─────────
router.get('/uploads', asyncHandler(async (req: Request, res: Response) => {
  const entityType = req.query.entityType as string;
  const entityId = req.query.entityId as string;
  if (!entityType || !entityId) {
    res.status(400).json({ success: false, message: 'entityType and entityId query params required' });
    return;
  }
  if (!isValidEntityType(entityType)) {
    res.status(400).json({ success: false, message: `entityType must be one of: ${UPLOAD_ENTITY_TYPES.join(', ')}` });
    return;
  }
  const records = await uploadService.listByEntity(entityType, entityId);
  res.json({ success: true, data: records });
}));

router.put('/uploads/:id/rename', asyncHandler(async (req: Request, res: Response) => {
  const { originalName } = req.body;
  if (!originalName || !originalName.trim()) {
    res.status(400).json({ success: false, message: 'originalName is required' });
    return;
  }
  const result = await uploadService.renameFile(req.params.id, originalName);
  res.json({ success: true, data: result });
}));

router.delete('/uploads/:id', asyncHandler(async (req: Request, res: Response) => {
  await uploadService.deleteFile(req.params.id);
  res.json({ success: true, message: 'File deleted' });
}));

router.get('/uploads/:id/meta', asyncHandler(async (req: Request, res: Response) => {
  const result = await uploadService.getMeta(req.params.id);
  res.json({ success: true, data: result });
}));

router.get('/uploads/:id', asyncHandler(async (req: Request, res: Response) => {
  const { buffer, mimeType, originalName } = await uploadService.getFile(req.params.id);
  res.setHeader('Content-Type', mimeType);
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(originalName)}`);
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.send(buffer);
}));

export default router;
