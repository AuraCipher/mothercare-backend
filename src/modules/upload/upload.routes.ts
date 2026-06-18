import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import authMiddleware from '../../middleware/auth/auth.middleware';
import { uploadLimiter } from '../../middleware/security/rateLimiter';
import { uploadService } from './upload.service';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
  // We validate by magic bytes (not extension), so no fileFilter needed here
});

const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => { fn(req, res, next).catch(next); };

// ─── POST /api/upload — Upload a file (auth + rate limit) ──────────
router.post('/upload', authMiddleware, uploadLimiter, upload.single('file'), asyncHandler(async (req: Request, res: Response) => {
  if (!req.file) {
    res.status(400).json({ success: false, message: 'No file provided' });
    return;
  }

  const userId = (req as any).user?.id;
  const purpose = req.body?.purpose || 'document';
  const entityType = req.body?.entityType || undefined;
  const entityId = req.body?.entityId || undefined;
  // Validate entityType if provided
  if (entityType && !['student', 'teacher'].includes(entityType)) {
    res.status(400).json({ success: false, message: 'entityType must be "student" or "teacher"' });
    return;
  }
  const result = await uploadService.uploadFile(req.file.buffer, req.file.originalname, userId, purpose, entityType, entityId);
  res.status(201).json({ success: true, data: result });
}));

// ─── GET /api/uploads — List files by entity (auth required) ─────────
router.get('/uploads', authMiddleware, asyncHandler(async (req: Request, res: Response) => {
  const entityType = req.query.entityType as string;
  const entityId = req.query.entityId as string;
  if (!entityType || !entityId) {
    res.status(400).json({ success: false, message: 'entityType and entityId query params required' });
    return;
  }
  if (!['student', 'teacher'].includes(entityType)) {
    res.status(400).json({ success: false, message: 'entityType must be "student" or "teacher"' });
    return;
  }
  const records = await uploadService.listByEntity(entityType, entityId);
  res.json({ success: true, data: records });
}));

// ─── PUT /api/uploads/:id/rename — Rename file (auth required) ────────────
router.put('/uploads/:id/rename', authMiddleware, asyncHandler(async (req: Request, res: Response) => {
  const { originalName } = req.body;
  if (!originalName || !originalName.trim()) {
    res.status(400).json({ success: false, message: 'originalName is required' });
    return;
  }
  const result = await uploadService.renameFile(req.params.id, originalName);
  res.json({ success: true, data: result });
}));

// ─── DELETE /api/uploads/:id — Delete file + disk cleanup (auth required) ─
router.delete('/uploads/:id', authMiddleware, asyncHandler(async (req: Request, res: Response) => {
  await uploadService.deleteFile(req.params.id);
  res.json({ success: true, message: 'File deleted' });
}));

// ─── GET /api/uploads/:id/meta — File metadata (auth required) ──────
router.get('/uploads/:id/meta', authMiddleware, asyncHandler(async (req: Request, res: Response) => {
  const result = await uploadService.getMeta(req.params.id);
  res.json({ success: true, data: result });
}));

// ─── GET /api/uploads/:id — Serve file (auth required) ──────────────
router.get('/uploads/:id', authMiddleware, asyncHandler(async (req: Request, res: Response) => {
  const { buffer, mimeType, originalName } = await uploadService.getFile(req.params.id);
  res.setHeader('Content-Type', mimeType);
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(originalName)}`);
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.send(buffer);
}));

export default router;
