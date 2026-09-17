import { Router, Request, Response, NextFunction } from 'express';
import Busboy from 'busboy';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { pipeline } from 'stream/promises';
import { Transform, Readable } from 'stream';
import authMiddleware from '../../middleware/auth/auth.middleware';
import { uploadDocumentPermissionMiddleware } from '../../middleware/auth/upload-document-permission.middleware';
import { uploadLimiter } from '../../middleware/security/rateLimiter';
import { uploadService, getMaxBytesForPurpose } from './upload.service';
import { UPLOAD_ENTITY_TYPES } from './storage-paths';
import { prisma } from '../../lib/prisma';
import { teacherAppChatAllowsAttachments } from '../chat/services/teacher-app-chat-permissions.service';
import { authorizeFileAccess, authorizeFileMutation } from './upload-authorization';

const router = Router();

router.use(authMiddleware, uploadDocumentPermissionMiddleware);

// R2-06: MIME types that can execute active browser content.
// If a FileRecord has one of these MIME types (from a legacy upload before R2-06),
// override Content-Type to prevent same-origin script execution.
const DANGEROUS_MIMES = new Set([
  'text/html',
  'application/xhtml+xml',
  'image/svg+xml',
  'text/javascript',
  'application/javascript',
  'application/xml',
  'text/xml',
]);

function getSafeResponseHeaders(mimeType: string, originalName: string) {
  if (DANGEROUS_MIMES.has(mimeType)) {
    return {
      contentType: 'application/octet-stream',
      contentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(originalName)}`,
    };
  }
  return {
    contentType: mimeType,
    contentDisposition: `inline; filename*=UTF-8''${encodeURIComponent(originalName)}`,
  };
}

const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => { fn(req, res, next).catch(next); };

function isValidEntityType(value?: string): value is typeof UPLOAD_ENTITY_TYPES[number] {
  return Boolean(value && UPLOAD_ENTITY_TYPES.includes(value as typeof UPLOAD_ENTITY_TYPES[number]));
}

// ─── POST /api/upload — Upload a file (streaming, bounded heap) ──────────
router.post('/upload', uploadLimiter, asyncHandler(async (req: Request, res: Response) => {
  // Legacy test path: if multer mock injected req.file (used in integration tests), handle via buffer path
  const legacyFile = (req as any).file as { buffer?: Buffer; originalname?: string } | undefined;
  if (legacyFile?.buffer && legacyFile?.originalname) {
    // This branch is for backward compatibility with existing jest mocks (tests/__mocks__/multer.ts)
    // It still buffers, but tests use tiny fake buffers (<50 MB), so heap is bounded in test.
    const userId = (req as any).user?.id;
    const purpose = (req as any).body?.purpose || 'document';
    const entityTypeRaw = (req as any).body?.entityType as string | undefined;
    if (entityTypeRaw && !isValidEntityType(entityTypeRaw)) {
      res.status(400).json({ success: false, message: `entityType must be one of: ${UPLOAD_ENTITY_TYPES.join(', ')}` });
      return;
    }
    const entityType = entityTypeRaw;
    const entityId = (req as any).body?.entityId || undefined;
    const roomId = (req as any).body?.roomId || undefined;
    const academicYearId = (req as any).body?.academicYearId || undefined;
    const durationSecondsRaw = (req as any).body?.durationSeconds;
    const durationSeconds = durationSecondsRaw != null && durationSecondsRaw !== '' ? parseFloat(String(durationSecondsRaw)) : undefined;

    if (entityType === 'chat' && roomId && userId) {
      const room = await prisma.chatRoom.findUnique({ where: { id: roomId }, select: { branchId: true } });
      if (room?.branchId) {
        const attachmentsOk = await teacherAppChatAllowsAttachments(userId, room.branchId);
        if (!attachmentsOk) {
          res.status(403).json({ success: false, message: 'Sending chat attachments is not allowed for your account' });
          return;
        }
      }
    }

    const result = await uploadService.uploadFile(legacyFile.buffer, legacyFile.originalname, {
      uploadedById: userId,
      purpose,
      entityType,
      entityId,
      roomId,
      academicYearId,
      durationSeconds,
    });
    res.status(201).json({ success: true, data: result });
    return;
  }

  // Content-Type must be multipart for streaming path
  const contentType = req.headers['content-type'] || '';
  if (!contentType.includes('multipart/form-data')) {
    res.status(400).json({ success: false, message: 'No file provided' });
    return;
  }

  // Early Content-Length check (most permissive 1GB) — not authoritative, byte counter is
  const contentLengthHeader = req.headers['content-length'] ? parseInt(String(req.headers['content-length']), 10) : NaN;
  if (!isNaN(contentLengthHeader) && contentLengthHeader > 1024 * 1024 * 1024) {
    res.status(413).json({ success: false, message: 'File too large (max 1024MB)' });
    return;
  }

  // Streaming ingestion via busboy → temp file (disk, not heap)
  const busboyResult = await new Promise<{
    fields: Record<string, string>;
    fileInfo: { filename: string; encoding: string; mimeType: string } | null;
    tempFilePath: string | null;
    byteCount: number;
  }>((resolve, reject) => {
    let bb: any;
    try {
      bb = (Busboy as any)({ headers: req.headers, limits: { files: 1, fileSize: 1024 * 1024 * 1024 } });
    } catch (e) {
      reject(e);
      return;
    }

    const fields: Record<string, string> = {};
    let fileInfo: { filename: string; encoding: string; mimeType: string } | null = null;
    let tempFilePath: string | null = null;
    let writeStream: fs.WriteStream | null = null;
    let byteCount = 0;
    let fileWritePromise: Promise<void> | null = null;
    let fileError: any = null;
    let fileFieldName: string | null = null;
    let finished = false;

    const cleanupTemp = () => {
      if (tempFilePath) {
        try {
          if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
        } catch {}
      }
    };

    const fail = (err: any) => {
      if (finished) return;
      finished = true;
      cleanupTemp();
      if (writeStream) {
        try { writeStream.destroy(); } catch {}
      }
      // Unpipe to stop receiving data
      try { req.unpipe(bb); } catch {}
      reject(err);
    };

    // Note: client disconnect handling is deferred — temp file cleanup is handled
    // after busboy completes and after service. Do not delete on req 'close' here
    // to avoid racing with service's read.

    bb.on('field', (name: string, val: string) => {
      fields[name] = val;
    });

    bb.on('file', (name: string, file: any, info: any, enc?: string, mime?: string) => {
      // Normalize busboy 1.x (info as object) vs old signature (info is filename string)
      let filename: string;
      let encoding: string;
      let mimeType: string;
      if (info && typeof info === 'object' && 'filename' in info) {
        filename = (info as any).filename || 'file';
        encoding = (info as any).encoding || '7bit';
        mimeType = (info as any).mimeType || 'application/octet-stream';
      } else {
        // Old busboy signature: (fieldname, file, filename, encoding, mimetype)
        filename = (info as unknown as string) || 'file';
        encoding = (enc as string) || '7bit';
        mimeType = (mime as string) || 'application/octet-stream';
      }

      if (name !== 'file') {
        file.resume();
        return;
      }
      if (fileFieldName) {
        file.resume();
        fileError = { status: 400, message: 'Only one file allowed' };
        return;
      }
      fileFieldName = name;
      fileInfo = { filename, encoding, mimeType };

      const tmpDir = os.tmpdir();
      const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100) || 'upload';
      tempFilePath = path.join(tmpDir, `mcs-upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName}`);
      writeStream = fs.createWriteStream(tempFilePath);

      // Byte counter Transform — counts while streaming to temp file (disk, not heap)
      const counter = new Transform({
        transform(chunk: Buffer, _enc: string, cb: Function) {
          byteCount += chunk.length;
          if (byteCount > 1024 * 1024 * 1024) {
            fileError = { status: 413, message: 'File too large (max 1024MB)' };
            cb(new Error('File too large'));
            // Destroy file and write stream
            try { file.destroy(); } catch {}
            try { writeStream?.destroy(); } catch {}
            fail(fileError);
            return;
          }
          cb(null, chunk);
        },
      });

      file.on('limit', () => {
        fileError = { status: 413, message: 'File too large (max 1024MB)' };
        fail(fileError);
      });

      file.on('error', (err: any) => {
        fileError = err;
      });

      fileWritePromise = (pipeline(file, counter as any, writeStream as any) as Promise<void>).catch((err) => {
        if (!fileError) fileError = err;
        throw err;
      });
    });

    bb.on('error', (err: any) => {
      fail(err);
    });

    bb.on('finish', async () => {
      if (finished) return;
      // Wait for file write to complete if there was a file
      if (fileWritePromise) {
        try {
          await fileWritePromise;
        } catch (e: any) {
          if (!fileError) fileError = e;
          fail(fileError || e);
          return;
        }
      }
      if (fileError) {
        fail(fileError);
        return;
      }
      if (!fileInfo || !tempFilePath) {
        fail({ status: 400, message: 'No file provided' });
        return;
      }
      finished = true;
      resolve({ fields, fileInfo, tempFilePath, byteCount });
    });

    req.pipe(bb);
  });

  const { fields, fileInfo, tempFilePath, byteCount } = busboyResult;
  if (!fileInfo || !tempFilePath) {
    res.status(400).json({ success: false, message: 'No file provided' });
    return;
  }

  // Ensure temp file cleanup in all paths — defer until after service completes
  let tempCleaned = false;
  const cleanup = () => {
    if (!tempCleaned && tempFilePath) {
      tempCleaned = true;
      try { if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath); } catch {}
    }
  };

  try {
    const userId = (req as any).user?.id;
    const purpose = fields.purpose || 'document';
    const entityTypeRaw = fields.entityType as string | undefined;
    if (entityTypeRaw && !isValidEntityType(entityTypeRaw)) {
      res.status(400).json({ success: false, message: `entityType must be one of: ${UPLOAD_ENTITY_TYPES.join(', ')}` });
      cleanup();
      return;
    }
    const entityType = entityTypeRaw;
    const entityId = fields.entityId || undefined;
    const roomId = fields.roomId || undefined;
    const academicYearId = fields.academicYearId || undefined;
    const durationSecondsRaw = fields.durationSeconds;
    const durationSeconds = durationSecondsRaw != null && durationSecondsRaw !== '' ? parseFloat(String(durationSecondsRaw)) : undefined;

    // Per-purpose size enforcement — authoritative byte counter (not Content-Length)
    const maxBytes = getMaxBytesForPurpose(purpose);
    if (byteCount > maxBytes) {
      res.status(413).json({ success: false, message: `File too large (max ${maxBytes / 1024 / 1024}MB)` });
      cleanup();
      return;
    }

    if (entityType === 'chat' && roomId && userId) {
      const room = await prisma.chatRoom.findUnique({ where: { id: roomId }, select: { branchId: true } });
      if (room?.branchId) {
        const attachmentsOk = await teacherAppChatAllowsAttachments(userId, room.branchId);
        if (!attachmentsOk) {
          res.status(403).json({ success: false, message: 'Sending chat attachments is not allowed for your account' });
          cleanup();
          return;
        }
      }
    }

    // Delegate to streaming service (handles mime sniff, Sharp for images, passthrough streaming to R2/local)
    const result = await uploadService.uploadFileStreamed({
      tempFilePath,
      originalName: fileInfo.filename,
      byteCount,
      uploadedById: userId,
      purpose,
      entityType,
      entityId,
      roomId,
      academicYearId,
      durationSeconds,
    });

    cleanup();
    res.status(201).json({ success: true, data: result });
  } catch (err: any) {
    cleanup();
    // Ensure temp file partial R2/local cleanup is handled by service/storage layer
    // For passthrough, storage.save may have left partial local file — already cleaned via LocalStorageAdapter
    // For R2, multipart Upload will be aborted on error by lib-storage
    throw err;
  }
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

  // R2-04: Entity access check — students can only list their own files
  const user = (req as any).user;
  if (user.role === 'student' && entityType === 'student') {
    const student = await prisma.student.findFirst({
      where: { userId: user.id },
      select: { id: true },
    });
    if (!student || student.id !== entityId) {
      res.status(403).json({ success: false, message: 'Access denied' });
      return;
    }
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
  // R2-04: Authorize mutation BEFORE rename (prevents IDOR rename)
  const user = (req as any).user;
  const { allowed } = await authorizeFileMutation(user, req.params.id);
  if (!allowed) {
    res.status(404).json({ success: false, message: 'File not found' });
    return;
  }
  const result = await uploadService.renameFile(req.params.id, originalName);
  res.json({ success: true, data: result });
}));

router.delete('/uploads/:id', asyncHandler(async (req: Request, res: Response) => {
  // R2-04: Authorize mutation BEFORE delete (prevents IDOR deletion)
  const user = (req as any).user;
  const { allowed } = await authorizeFileMutation(user, req.params.id);
  if (!allowed) {
    res.status(404).json({ success: false, message: 'File not found' });
    return;
  }
  await uploadService.deleteFile(req.params.id);
  res.json({ success: true, message: 'File deleted' });
}));

router.get('/uploads/:id/meta', asyncHandler(async (req: Request, res: Response) => {
  // R2-04: Authorize BEFORE metadata access (prevents IDOR metadata leakage)
  const user = (req as any).user;
  const { allowed } = await authorizeFileAccess(user, req.params.id);
  if (!allowed) {
    res.status(404).json({ success: false, message: 'File not found' });
    return;
  }
  const result = await uploadService.getMeta(req.params.id);
  res.json({ success: true, data: result });
}));

router.get('/uploads/:id', asyncHandler(async (req: Request, res: Response) => {
  // R2-04: Authorize BEFORE any storage access (prevents IDOR + R2 object key leakage)
  const user = (req as any).user;
  const { allowed, reason } = await authorizeFileAccess(user, req.params.id);
  if (!allowed) {
    res.status(404).json({ success: false, message: 'File not found' });
    return;
  }

  let result: Awaited<ReturnType<typeof uploadService.getFileStream>>;
  try {
    result = await uploadService.getFileStream(req.params.id, req.headers.range as string | undefined);
  } catch (err: any) {
    if (err?.status === 416) {
      res.setHeader('Content-Range', `bytes */${err?.size ?? '*'}`);
      res.status(416).json({ success: false, message: 'Range Not Satisfiable' });
      return;
    }
    throw err;
  }

  const { stream, mimeType, originalName, contentLength, etag, lastModified, contentRange, statusCode } = result;

  // R2-06: Use safe headers — override dangerous MIME types to prevent active-content execution
  const safeHeaders = getSafeResponseHeaders(mimeType, originalName);
  res.setHeader('Content-Type', safeHeaders.contentType);
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.setHeader('Content-Disposition', safeHeaders.contentDisposition);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.setHeader('Accept-Ranges', 'bytes');
  if (etag) res.setHeader('ETag', etag);
  if (lastModified) res.setHeader('Last-Modified', lastModified.toUTCString());
  if (contentLength != null) res.setHeader('Content-Length', String(contentLength));
  if (contentRange) res.setHeader('Content-Range', contentRange);
  if (statusCode) res.status(statusCode);

  // Handle client disconnect — destroy source stream to abort R2 download
  const onClose = () => {
    try { (stream as any).destroy(); } catch {}
  };
  req.on('close', onClose);
  res.on('close', onClose);

  try {
    await pipeline(stream as any, res as any);
  } catch (err: any) {
    // After headers sent, do not attempt JSON response; just abort
    // If headers not yet sent, propagate to errorHandler
    if (!res.headersSent) throw err;
    // Otherwise, log and destroy
    try { (stream as any).destroy(); } catch {}
  } finally {
    req.off('close', onClose);
    res.off('close', onClose);
  }
}));

export default router;
