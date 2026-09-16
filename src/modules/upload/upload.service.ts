import fs from 'fs';
import { Readable } from 'stream';
import { fileTypeFromBuffer } from 'file-type';
import { prisma } from '../../lib/prisma';
import {
  getDefaultDocumentsBucket,
  storage,
} from './storage';
import { buildStoragePath, type UploadPurpose } from './storage-paths';
import { buildFileServeUrl } from './file-url.util';
import { ALLOWED_MIMES, EXT_MAP, normalizePurpose, processUploadBuffer } from './media.pipeline';

const MAX_FILE_SIZE = 20 * 1024 * 1024;
const MAX_VOICE_SIZE = 5 * 1024 * 1024;
const MAX_VIDEO_BYTES = 1024 * 1024 * 1024; // 1GB — duration capped at 2 min instead of file size
const MAX_VIDEO_DURATION_SECONDS = 120;

export function getMaxBytesForPurpose(purpose?: string): number {
  if (purpose === 'voice_note') return MAX_VOICE_SIZE;
  if (purpose === 'video') return MAX_VIDEO_BYTES;
  return MAX_FILE_SIZE;
}

export interface UploadFileOptions {
  uploadedById?: string;
  purpose?: string;
  entityType?: string;
  entityId?: string;
  roomId?: string;
  academicYearId?: string;
  durationSeconds?: number;
  metadata?: Record<string, unknown>;
}

export class UploadService {
  async uploadFile(
    buffer: Buffer,
    originalName: string,
    options: UploadFileOptions = {},
  ) {
    const requestedPurpose = options.purpose || 'document';
    const isVideo = requestedPurpose === 'video';
    const maxBytes = requestedPurpose === 'voice_note'
      ? MAX_VOICE_SIZE
      : isVideo
        ? MAX_VIDEO_BYTES
        : MAX_FILE_SIZE;

    if (isVideo) {
      const duration = options.durationSeconds;
      if (duration == null || Number.isNaN(duration) || duration <= 0) {
        throw { status: 400, message: 'Video duration is required' };
      }
      if (duration > MAX_VIDEO_DURATION_SECONDS) {
        throw { status: 400, message: 'Videos must be 2 minutes or shorter' };
      }
    }

    const processed = await processUploadBuffer({
      buffer,
      originalName,
      purpose: requestedPurpose,
      maxBytes,
    });

    const resolvedPurpose = normalizePurpose(options.purpose, processed.mimeType) as UploadPurpose;
    const storagePath = buildStoragePath({
      purpose: resolvedPurpose,
      ext: processed.ext,
      entityType: options.entityType,
      entityId: options.entityId,
      roomId: options.roomId,
      academicYearId: options.academicYearId,
    });

    const bucket = getDefaultDocumentsBucket();
    await storage.save(storagePath, processed.buffer, { bucket });

    const record = await prisma.fileRecord.create({
      data: {
        originalName,
        storagePath,
        storageBucket: bucket,
        purpose: resolvedPurpose,
        mimeType: processed.mimeType,
        size: processed.buffer.length,
        width: processed.mimeType.startsWith('image/') ? (processed.width ?? undefined) : undefined,
        height: processed.mimeType.startsWith('image/') ? (processed.height ?? undefined) : undefined,
        uploadedById: options.uploadedById || undefined,
        entityType: options.entityType || undefined,
        entityId: options.entityId || undefined,
        metadata: {
          ...(options.metadata || {}),
          ...(options.roomId ? { roomId: options.roomId } : {}),
          ...(options.academicYearId ? { academicYearId: options.academicYearId } : {}),
          ...(options.durationSeconds != null ? { durationSeconds: options.durationSeconds } : {}),
        },
        publicUrl: undefined,
      },
    });

    const publicUrl = buildFileServeUrl(record.id);
    await prisma.fileRecord.update({
      where: { id: record.id },
      data: { publicUrl },
    });

    return {
      id: record.id,
      url: publicUrl,
      storagePath,
      storageBucket: bucket,
      mimeType: processed.mimeType,
      size: processed.buffer.length,
      purpose: resolvedPurpose,
    };
  }

  /**
   * Streaming upload from a temp file staged via busboy.
   * Passthrough (non-image) files are streamed to storage without ever
   * loading the complete file into a Node Buffer (bounded heap).
   * Image files still require a complete Buffer for Sharp — this remaining
   * buffering is documented and limited to 20 MB (MAX_FILE_SIZE).
   */
  async uploadFileStreamed(params: {
    tempFilePath: string;
    originalName: string;
    byteCount: number;
    uploadedById?: string;
    purpose?: string;
    entityType?: string;
    entityId?: string;
    roomId?: string;
    academicYearId?: string;
    durationSeconds?: number;
    metadata?: Record<string, unknown>;
  }) {
    const { tempFilePath, originalName, byteCount } = params;
    const requestedPurpose = params.purpose || 'document';
    const maxBytes = getMaxBytesForPurpose(requestedPurpose);

    if (byteCount > maxBytes) {
      throw { status: 413, message: `File too large (max ${maxBytes / 1024 / 1024}MB)` };
    }

    if (requestedPurpose === 'video') {
      const duration = params.durationSeconds;
      if (duration == null || Number.isNaN(duration) || duration <= 0) {
        throw { status: 400, message: 'Video duration is required' };
      }
      if (duration > MAX_VIDEO_DURATION_SECONDS) {
        throw { status: 400, message: 'Videos must be 2 minutes or shorter' };
      }
    }

    // Sniff MIME from first bytes of temp file (no full buffer)
    let sniffMime: string | undefined;
    let sniffExt: string | undefined;
    try {
      const fd = await fs.promises.open(tempFilePath, 'r');
      const prefix = Buffer.alloc(Math.min(4100, byteCount));
      const { bytesRead } = await fd.read(prefix, 0, prefix.length, 0);
      await fd.close();
      const type = await fileTypeFromBuffer(prefix.subarray(0, bytesRead));
      sniffMime = type?.mime;
      sniffExt = type?.ext;
    } catch {
      // fallback to extension mapping below
    }

    let mime: string | undefined = sniffMime;
    const fileExt = originalName.split('.').pop()?.toLowerCase();
    if (!mime || !ALLOWED_MIMES.has(mime)) {
      mime = fileExt ? (EXT_MAP[fileExt] || 'application/octet-stream') : 'application/octet-stream';
    }
    if (!ALLOWED_MIMES.has(mime)) {
      throw { status: 400, message: `File type "${mime}" is not allowed` };
    }

    // Decide whether Sharp is needed (image that will be re-encoded to webp)
    const needsSharp =
      mime.startsWith('image/') &&
      mime !== 'image/svg+xml' &&
      mime !== 'image/gif' &&
      requestedPurpose !== 'voice_note';

    if (needsSharp) {
      // Image path — requires complete Buffer for Sharp (remaining buffering, documented)
      // Temp file is bounded to 20 MB for images (MAX_FILE_SIZE), so heap is bounded.
      const buffer = await fs.promises.readFile(tempFilePath);
      const processed = await processUploadBuffer({
        buffer,
        originalName,
        purpose: requestedPurpose,
        maxBytes,
      });
      const resolvedPurpose = normalizePurpose(params.purpose, processed.mimeType) as UploadPurpose;
      const storagePath = buildStoragePath({
        purpose: resolvedPurpose,
        ext: processed.ext,
        entityType: params.entityType,
        entityId: params.entityId,
        roomId: params.roomId,
        academicYearId: params.academicYearId,
      });
      const bucket = getDefaultDocumentsBucket();
      // Upload processed buffer as Readable to preserve streaming interface (no second buffer copy)
      const readable = Readable.from(processed.buffer);
      await storage.save(storagePath, readable, {
        bucket,
        contentLength: processed.buffer.length,
        contentType: processed.mimeType,
      });
      const record = await prisma.fileRecord.create({
        data: {
          originalName,
          storagePath,
          storageBucket: bucket,
          purpose: resolvedPurpose,
          mimeType: processed.mimeType,
          size: processed.buffer.length,
          width: processed.mimeType.startsWith('image/') ? (processed.width ?? undefined) : undefined,
          height: processed.mimeType.startsWith('image/') ? (processed.height ?? undefined) : undefined,
          uploadedById: params.uploadedById || undefined,
          entityType: params.entityType || undefined,
          entityId: params.entityId || undefined,
          metadata: {
            ...(params.metadata || {}),
            ...(params.roomId ? { roomId: params.roomId } : {}),
            ...(params.academicYearId ? { academicYearId: params.academicYearId } : {}),
            ...(params.durationSeconds != null ? { durationSeconds: params.durationSeconds } : {}),
          },
          publicUrl: undefined,
        },
      });
      const publicUrl = buildFileServeUrl(record.id);
      await prisma.fileRecord.update({ where: { id: record.id }, data: { publicUrl } });
      return {
        id: record.id,
        url: publicUrl,
        storagePath,
        storageBucket: bucket,
        mimeType: processed.mimeType,
        size: processed.buffer.length,
        purpose: resolvedPurpose,
      };
    }

    // Passthrough path — streamed without full Buffer (no second copy)
    // Handle voice_note mime coercion similar to media.pipeline
    let finalMime = mime;
    let finalExt = sniffExt || fileExt || 'bin';
    if (requestedPurpose === 'voice_note') {
      const ext = fileExt === 'm4a' ? 'm4a' : (sniffExt || fileExt || 'm4a');
      finalExt = ext;
      if (mime.startsWith('audio/')) finalMime = mime;
      else if (mime === 'video/mp4' || ext === 'm4a') finalMime = 'audio/mp4';
      else finalMime = 'audio/mp4';
    } else if (mime.startsWith('image/') && (mime === 'image/svg+xml' || mime === 'image/gif')) {
      finalExt = sniffExt || (mime === 'image/svg+xml' ? 'svg' : 'gif');
      finalMime = mime;
    } else if (!mime.startsWith('image/')) {
      // For non-image passthrough, keep sniffed or ext mapping already resolved
      finalExt = sniffExt || fileExt || 'bin';
      finalMime = mime;
    }

    const resolvedPurpose = normalizePurpose(params.purpose, finalMime) as UploadPurpose;
    const storagePath = buildStoragePath({
      purpose: resolvedPurpose,
      ext: finalExt,
      entityType: params.entityType,
      entityId: params.entityId,
      roomId: params.roomId,
      academicYearId: params.academicYearId,
    });
    const bucket = getDefaultDocumentsBucket();
    const readStream = fs.createReadStream(tempFilePath);
    await storage.save(storagePath, readStream as Readable, {
      bucket,
      contentLength: byteCount,
      contentType: finalMime,
    });
    const record = await prisma.fileRecord.create({
      data: {
        originalName,
        storagePath,
        storageBucket: bucket,
        purpose: resolvedPurpose,
        mimeType: finalMime,
        size: byteCount,
        width: undefined,
        height: undefined,
        uploadedById: params.uploadedById || undefined,
        entityType: params.entityType || undefined,
        entityId: params.entityId || undefined,
        metadata: {
          ...(params.metadata || {}),
          ...(params.roomId ? { roomId: params.roomId } : {}),
          ...(params.academicYearId ? { academicYearId: params.academicYearId } : {}),
          ...(params.durationSeconds != null ? { durationSeconds: params.durationSeconds } : {}),
        },
        publicUrl: undefined,
      },
    });
    const publicUrl = buildFileServeUrl(record.id);
    await prisma.fileRecord.update({ where: { id: record.id }, data: { publicUrl } });
    return {
      id: record.id,
      url: publicUrl,
      storagePath,
      storageBucket: bucket,
      mimeType: finalMime,
      size: byteCount,
      purpose: resolvedPurpose,
    };
  }

  async getMeta(fileId: string) {
    const record = await prisma.fileRecord.findUnique({ where: { id: fileId } });
    if (!record) throw { status: 404, message: 'File not found' };
    return {
      ...record,
      url: record.publicUrl || buildFileServeUrl(record.id),
    };
  }

  async getFile(fileId: string) {
    const record = await prisma.fileRecord.findUnique({ where: { id: fileId } });
    if (!record) throw { status: 404, message: 'File not found' };
    const buffer = await storage.get(record.storagePath, { bucket: record.storageBucket });
    return { buffer, mimeType: record.mimeType, originalName: record.originalName, record };
  }

  async getFileStream(fileId: string, range?: string) {
    const record = await prisma.fileRecord.findUnique({ where: { id: fileId } });
    if (!record) throw { status: 404, message: 'File not found' };
    const result = await storage.getStream(record.storagePath, {
      bucket: record.storageBucket,
      range,
    });
    return {
      stream: result.body,
      mimeType: record.mimeType,
      originalName: record.originalName,
      record,
      contentLength: result.contentLength ?? record.size,
      contentType: result.contentType,
      etag: result.etag,
      lastModified: result.lastModified,
      contentRange: result.contentRange,
      statusCode: result.statusCode,
    };
  }

  async listByEntity(entityType: string, entityId: string) {
    const records = await prisma.fileRecord.findMany({
      where: { entityType, entityId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        originalName: true,
        mimeType: true,
        size: true,
        purpose: true,
        publicUrl: true,
        createdAt: true,
      },
    });
    return records.map((record) => ({
      ...record,
      url: record.publicUrl || buildFileServeUrl(record.id),
    }));
  }

  async deleteFile(fileId: string) {
    const record = await prisma.fileRecord.findUnique({ where: { id: fileId } });
    if (!record) throw { status: 404, message: 'File not found' };
    try {
      await storage.delete(record.storagePath, { bucket: record.storageBucket });
    } catch {
      /* object may already be missing */
    }
    await prisma.fileRecord.delete({ where: { id: fileId } });
  }

  async renameFile(fileId: string, newName: string) {
    const record = await prisma.fileRecord.findUnique({ where: { id: fileId } });
    if (!record) throw { status: 404, message: 'File not found' };
    if (!newName || !newName.trim()) throw { status: 400, message: 'Name cannot be empty' };
    return prisma.fileRecord.update({
      where: { id: fileId },
      data: { originalName: newName.trim() },
      select: { id: true, originalName: true },
    });
  }
}

export const uploadService = new UploadService();

/** Delete physical object + DB row (use when replacing profile photos). */
export async function deleteFileRecordById(fileId: string): Promise<void> {
  await uploadService.deleteFile(fileId);
}
