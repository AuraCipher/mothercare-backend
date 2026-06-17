import { prisma } from '../../lib/prisma';
import { storage } from './storage.service';
import sharp from 'sharp';
import { fileTypeFromBuffer } from 'file-type';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';

const ALLOWED_MIMES = new Set([
  // Images
  'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml', 'image/bmp',
  // Documents
  'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain', 'text/csv', 'text/html', 'text/markdown', 'application/json', 'application/xml',
  'application/zip', 'application/x-rar-compressed',
]);

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB
const PROFILE_MAX_DIM = 300;

export class UploadService {
  /**
   * Upload a file buffer. For images, resize to max 300px and convert to WebP.
   * For documents (PDF), store as-is.
   */
  async uploadFile(buffer: Buffer, originalName: string, uploadedById?: string) {
    // 1. Size check
    if (buffer.length > MAX_FILE_SIZE) {
      throw { status: 413, message: `File too large (max ${MAX_FILE_SIZE / 1024 / 1024}MB)` };
    }

    // 2. Magic byte validation
    const type = await fileTypeFromBuffer(buffer);
    let mime = type?.mime;
    // Fallback: if magic bytes fail, guess from extension
    if (!mime) {
      const ext = originalName.split('.').pop()?.toLowerCase();
      const extMap: Record<string, string> = {
        jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif',
        pdf: 'application/pdf', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        txt: 'text/plain', csv: 'text/csv', html: 'text/html', htm: 'text/html', md: 'text/markdown',
        json: 'application/json', xml: 'application/xml',
        zip: 'application/zip', rar: 'application/x-rar-compressed',
      };
      mime = ext ? (extMap[ext] || 'application/octet-stream') : 'application/octet-stream';
    }
    if (!ALLOWED_MIMES.has(mime)) {
      throw { status: 400, message: `File type "${mime}" is not allowed` };
    }

    let processedBuffer: Buffer;
    let finalMime: string;
    let ext: string;
    let width: number | null = null;
    let height: number | null = null;

    // 3. Process image files
    if (mime.startsWith('image/')) {
      const img = sharp(buffer).rotate(); // auto-rotate based on EXIF
      const meta = await img.metadata();
      width = meta.width || null;
      height = meta.height || null;

      // Resize if larger than max, convert to WebP
      const resized = img.resize(PROFILE_MAX_DIM, PROFILE_MAX_DIM, {
        fit: 'cover',
        position: 'centre',
        withoutEnlargement: true,
      });

      processedBuffer = await resized.webp({ quality: 80 }).toBuffer();
      finalMime = 'image/webp';
      ext = 'webp';
    } else {
      // Document (PDF) — store as-is
      processedBuffer = buffer;
      finalMime = mime;
      ext = type?.ext || 'bin';
    }

    // 4. Generate storage path
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const fileName = `${uuidv4()}.${ext}`;
    const storagePath = `${year}/${month}/${fileName}`;

    // 5. Save to disk
    await storage.save(storagePath, processedBuffer);

    // 6. Create FileRecord in DB
    const record = await prisma.fileRecord.create({
      data: {
        originalName,
        storagePath,
        mimeType: finalMime,
        size: processedBuffer.length,
        width: mime.startsWith('image/') ? (width ?? undefined) : undefined,
        height: mime.startsWith('image/') ? (height ?? undefined) : undefined,
        uploadedById: uploadedById || undefined,
      },
    });

    return {
      id: record.id,
      url: storage.url(storagePath),
      mimeType: finalMime,
      size: processedBuffer.length,
    };
  }

  /**
   * Get file metadata by record ID.
   */
  async getMeta(fileId: string) {
    const record = await prisma.fileRecord.findUnique({ where: { id: fileId } });
    if (!record) throw { status: 404, message: 'File not found' };
    return record;
  }

  /**
   * Get file buffer by record ID.
   */
  async getFile(fileId: string) {
    const record = await prisma.fileRecord.findUnique({ where: { id: fileId } });
    if (!record) throw { status: 404, message: 'File not found' };
    const buffer = await storage.get(record.storagePath);
    return { buffer, mimeType: record.mimeType, originalName: record.originalName };
  }
}

export const uploadService = new UploadService();
