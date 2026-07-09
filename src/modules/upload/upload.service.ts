import { prisma } from '../../lib/prisma';
import {
  getDefaultDocumentsBucket,
  storage,
} from './storage';
import { buildStoragePath, type UploadPurpose } from './storage-paths';
import { buildFileServeUrl } from './file-url.util';
import { normalizePurpose, processUploadBuffer } from './media.pipeline';

const MAX_FILE_SIZE = 20 * 1024 * 1024;
const MAX_VOICE_SIZE = 5 * 1024 * 1024;

export interface UploadFileOptions {
  uploadedById?: string;
  purpose?: string;
  entityType?: string;
  entityId?: string;
  roomId?: string;
  academicYearId?: string;
  metadata?: Record<string, unknown>;
}

export class UploadService {
  async uploadFile(
    buffer: Buffer,
    originalName: string,
    options: UploadFileOptions = {},
  ) {
    const requestedPurpose = options.purpose || 'document';
    const maxBytes = requestedPurpose === 'voice_note' ? MAX_VOICE_SIZE : MAX_FILE_SIZE;

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
