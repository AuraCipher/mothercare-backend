import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import authMiddleware from '../../middleware/auth/auth.middleware';
import { uploadService } from './upload.service';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  // We validate by magic bytes (not extension), so no fileFilter needed here
});

const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => { fn(req, res, next).catch(next); };

// ─── POST /api/upload — Upload a file (auth required) ───────────────
router.post('/upload', authMiddleware, upload.single('file'), asyncHandler(async (req: Request, res: Response) => {
  if (!req.file) {
    res.status(400).json({ success: false, message: 'No file provided' });
    return;
  }

  const userId = (req as any).user?.id;
  const result = await uploadService.uploadFile(req.file.buffer, req.file.originalname, userId);
  res.status(201).json({ success: true, data: result });
}));

// ─── GET /api/uploads/:id/meta — File metadata ──────────────────────
router.get('/uploads/:id/meta', asyncHandler(async (req: Request, res: Response) => {
  const result = await uploadService.getMeta(req.params.id);
  res.json({ success: true, data: result });
}));

// ─── GET /api/uploads/:id — Serve file ──────────────────────────────
router.get('/uploads/:id', asyncHandler(async (req: Request, res: Response) => {
  const { buffer, mimeType, originalName } = await uploadService.getFile(req.params.id);
  res.setHeader('Content-Type', mimeType);
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.setHeader('Content-Disposition', `inline; filename="${originalName}"`);
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.send(buffer);
}));

export default router;
