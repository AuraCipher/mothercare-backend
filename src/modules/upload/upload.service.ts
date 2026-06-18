import { prisma } from '../../lib/prisma';
import { storage } from './storage.service';
import sharp from 'sharp';
import { fileTypeFromBuffer } from 'file-type';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';

const ALLOWED_MIMES = new Set([
  // Images
  'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml', 'image/bmp', 'image/tiff', 'image/x-icon', 'image/vnd.microsoft.icon',
  // Office / Documents
  'application/pdf', 'application/rtf',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.oasis.opendocument.text', 'application/vnd.oasis.opendocument.spreadsheet', 'application/vnd.oasis.opendocument.presentation',
  // Text / Code / Data
  'text/plain', 'text/csv', 'text/html', 'text/markdown', 'text/css', 'text/javascript', 'text/yaml', 'text/xml',
  'application/json', 'application/xml', 'application/typescript', 'application/x-yaml', 'application/x-toml',
  // Archives
  'application/zip', 'application/x-rar-compressed', 'application/x-7z-compressed', 'application/x-tar', 'application/gzip',
  // Fonts
  'font/ttf', 'font/otf', 'font/woff', 'font/woff2',
  // Video (common school recordings)
  'video/mp4', 'video/webm', 'video/x-msvideo',
]);

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB (increased for videos & archives)
const PROFILE_MAX_DIM = 300;

export class UploadService {
  /**
   * Upload a file buffer.
   * @param purpose 'profile' — resize to 300×300 + WebP q80; 'document' — WebP q80 only, no resize; anything else defaults to document behavior.
   * SVG/GIF bypass sharp entirely (preserve animation / unsupported format).
   * Non-images are stored raw (PDF, DOCX, MP4, etc.).
   * @param entityType 'student' | 'teacher' — what kind of profile this doc belongs to
   * @param entityId UUID of the student or teacher profile
   */
  async uploadFile(buffer: Buffer, originalName: string, uploadedById?: string, purpose?: string, entityType?: string, entityId?: string) {
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
        svg: 'image/svg+xml', bmp: 'image/bmp', tiff: 'image/tiff', tif: 'image/tiff', ico: 'image/x-icon',
        pdf: 'application/pdf', rtf: 'application/rtf',
        doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        odt: 'application/vnd.oasis.opendocument.text', ods: 'application/vnd.oasis.opendocument.spreadsheet', odp: 'application/vnd.oasis.opendocument.presentation',
        txt: 'text/plain', csv: 'text/csv', html: 'text/html', htm: 'text/html', md: 'text/markdown',
        css: 'text/css', js: 'text/javascript', ts: 'application/typescript', jsx: 'text/javascript', tsx: 'application/typescript',
        json: 'application/json', xml: 'application/xml', yaml: 'application/x-yaml', yml: 'application/x-yaml', toml: 'application/x-toml',
        zip: 'application/zip', rar: 'application/x-rar-compressed', '7z': 'application/x-7z-compressed',
        tar: 'application/x-tar', gz: 'application/gzip', tgz: 'application/gzip',
        mp4: 'video/mp4', webm: 'video/webm', avi: 'video/x-msvideo',
        ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2',
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
      // SVG/GIF — bypass sharp entirely (preserve animation / unsupported format)
      if (mime === 'image/svg+xml' || mime === 'image/gif') {
        processedBuffer = buffer;
        finalMime = mime;
        ext = type?.ext || (mime === 'image/svg+xml' ? 'svg' : 'gif');
      } else {
        const img = sharp(buffer).rotate(); // auto-rotate based on EXIF
        const meta = await img.metadata();
        width = meta.width || null;
        height = meta.height || null;

        if (purpose === 'profile') {
          // Profile photo: resize to 300×300 + WebP q80
          const resized = img.resize(PROFILE_MAX_DIM, PROFILE_MAX_DIM, {
            fit: 'cover',
            position: 'centre',
            withoutEnlargement: true,
          });
          processedBuffer = await resized.webp({ quality: 80 }).toBuffer();
        } else {
          // Document / default: WebP q80 only, preserve original dimensions
          processedBuffer = await img.webp({ quality: 80 }).toBuffer();
        }
        finalMime = 'image/webp';
        ext = 'webp';
      }
    } else {
      // Non-image — store as-is (PDF, DOCX, MP4, etc.)
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
        entityType: entityType || undefined,
        entityId: entityId || undefined,
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

  /**
   * List file records for a given entity (student or teacher profile).
   */
  async listByEntity(entityType: string, entityId: string) {
    const records = await prisma.fileRecord.findMany({
      where: { entityType, entityId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        originalName: true,
        mimeType: true,
        size: true,
        createdAt: true,
      },
    });
    return records;
  }
}

export const uploadService = new UploadService();
