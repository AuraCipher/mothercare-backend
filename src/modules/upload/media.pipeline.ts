import sharp from 'sharp';
import { fileTypeFromBuffer } from 'file-type';
import { pLimit } from '../../lib/p-limit';

export const ALLOWED_MIMES = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/bmp', 'image/tiff', 'image/x-icon', 'image/vnd.microsoft.icon',
  'application/pdf', 'application/rtf',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel.sheet.macroEnabled.12', 'application/vnd.ms-excel.sheet.binaryMacroEnabled.12',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.template', 'application/vnd.ms-excel.template.macroEnabled.12',
  'application/vnd.ms-excel.addin.macroEnabled.12',
  'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.oasis.opendocument.text', 'application/vnd.oasis.opendocument.spreadsheet', 'application/vnd.oasis.opendocument.presentation',
  'text/plain', 'text/csv', 'text/markdown', 'text/css', 'text/yaml',
  'application/json', 'application/x-yaml', 'application/x-toml',
  'application/zip', 'application/x-rar-compressed', 'application/x-7z-compressed', 'application/x-tar', 'application/gzip',
  'font/ttf', 'font/otf', 'font/woff', 'font/woff2',
  'video/mp4', 'video/webm', 'video/x-msvideo', 'video/quicktime',
  'audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/webm', 'audio/aac', 'audio/x-m4a', 'audio/wav', 'audio/x-wav',
]);

export const EXT_MAP: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif',
  bmp: 'image/bmp', tiff: 'image/tiff', tif: 'image/tiff', ico: 'image/x-icon',
  pdf: 'application/pdf', rtf: 'application/rtf',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xlsm: 'application/vnd.ms-excel.sheet.macroEnabled.12', xlsb: 'application/vnd.ms-excel.sheet.binaryMacroEnabled.12',
  xltx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.template', xltm: 'application/vnd.ms-excel.template.macroEnabled.12',
  xlt: 'application/vnd.ms-excel', xlam: 'application/vnd.ms-excel.addin.macroEnabled.12',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odt: 'application/vnd.oasis.opendocument.text', ods: 'application/vnd.oasis.opendocument.spreadsheet', odp: 'application/vnd.oasis.opendocument.presentation',
  txt: 'text/plain', csv: 'text/csv', md: 'text/markdown',
  css: 'text/css',
  json: 'application/json', yaml: 'application/x-yaml', yml: 'application/x-yaml', toml: 'application/x-toml',
  zip: 'application/zip', rar: 'application/x-rar-compressed', '7z': 'application/x-7z-compressed',
  tar: 'application/x-tar', gz: 'application/gzip', tgz: 'application/gzip',
  mp4: 'video/mp4', webm: 'video/webm', avi: 'video/x-msvideo', mov: 'video/quicktime',
  mp3: 'audio/mpeg', m4a: 'audio/x-m4a', ogg: 'audio/ogg', wav: 'audio/wav',
  ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2',
};

export const PROFILE_MAX_DIM = 300;
export const CHAT_IMAGE_MAX_DIM = 2048;
/** Absolute max decode dimension — prevents OOM from massive images (e.g. 20000x20000 TIFF). */
export const MAX_IMAGE_DIM = 8192;
/** Bound Sharp concurrency to prevent memory exhaustion on the 4GB VPS. */
const sharpConcurrency = pLimit(3);

export interface ProcessedMedia {
  buffer: Buffer;
  mimeType: string;
  ext: string;
  width: number | null;
  height: number | null;
}

export interface ProcessMediaInput {
  buffer: Buffer;
  originalName: string;
  purpose?: string;
  maxBytes: number;
}

export async function processUploadBuffer(input: ProcessMediaInput): Promise<ProcessedMedia> {
  const { buffer, originalName, purpose, maxBytes } = input;

  if (buffer.length > maxBytes) {
    throw { status: 413, message: `File too large (max ${maxBytes / 1024 / 1024}MB)` };
  }

  const type = await fileTypeFromBuffer(buffer);
  let mime = type?.mime;
  const fileExt = originalName.split('.').pop()?.toLowerCase();

  if (!mime || !ALLOWED_MIMES.has(mime)) {
    mime = fileExt ? (EXT_MAP[fileExt] || 'application/octet-stream') : 'application/octet-stream';
  }
  if (!ALLOWED_MIMES.has(mime)) {
    throw { status: 400, message: `File type "${mime}" is not allowed` };
  }

  if (purpose === 'voice_note') {
    const ext = fileExt === 'm4a' ? 'm4a' : (type?.ext || fileExt || 'm4a');
    const audioMime =
      mime.startsWith('audio/') ? mime
      : mime === 'video/mp4' || ext === 'm4a' ? 'audio/mp4'
      : 'audio/mp4';
    return {
      buffer,
      mimeType: audioMime,
      ext,
      width: null,
      height: null,
    };
  }

  if (mime.startsWith('image/')) {
    if (mime === 'image/gif') {
      return {
        buffer,
        mimeType: mime,
        ext: type?.ext || 'gif',
        width: null,
        height: null,
      };
    }

    return sharpConcurrency(() => processImage(buffer, purpose, mime, type?.ext).catch((err) => {
      // Sharp throws a generic Error for pixel-limit violations — translate to structured 413.
      if (err instanceof Error && err.message?.includes('pixel limit')) {
        throw { status: 413, message: `Image dimensions too large (max ${MAX_IMAGE_DIM}×${MAX_IMAGE_DIM})` };
      }
      throw err;
    }));
  }

  return {
    buffer,
    mimeType: mime,
    ext: type?.ext || fileExt || 'bin',
    width: null,
    height: null,
  };
}

async function processImage(
  buffer: Buffer,
  purpose: string | undefined,
  mime: string,
  detectedExt: string | undefined,
): Promise<ProcessedMedia> {
  // Safety: cap decode dimensions to prevent OOM from massive images (e.g. 20000x20000 TIFF).
  // limitInputPixels takes total pixel count (width × height). 8192×8192 = 67,108,864.
  const img = sharp(buffer, { limitInputPixels: MAX_IMAGE_DIM * MAX_IMAGE_DIM }).rotate();

  const meta = await img.metadata();
  let width = meta.width || null;
  let height = meta.height || null;
  let pipeline = img;

  if (purpose === 'profile') {
    pipeline = pipeline.resize(PROFILE_MAX_DIM, PROFILE_MAX_DIM, {
      fit: 'cover',
      position: 'centre',
      withoutEnlargement: true,
    });
    // Use resolveWithObject to avoid a third Sharp instance for metadata
    const { data: resized, info } = await pipeline.webp({ quality: 80 }).toBuffer({ resolveWithObject: true });
    return {
      buffer: resized,
      mimeType: 'image/webp',
      ext: 'webp',
      width: info.width || width,
      height: info.height || height,
    };
  }

  if (purpose === 'chat') {
    pipeline = pipeline.resize(CHAT_IMAGE_MAX_DIM, CHAT_IMAGE_MAX_DIM, {
      fit: 'inside',
      withoutEnlargement: true,
    });
  }

  const { data: processed, info: processedInfo } = await pipeline.webp({ quality: 80 }).toBuffer({ resolveWithObject: true });
  return {
    buffer: processed,
    mimeType: 'image/webp',
    ext: 'webp',
    width: processedInfo.width || width,
    height: processedInfo.height || height,
  };
}

export function normalizePurpose(purpose?: string, mimeType?: string): string {
  if (purpose === 'voice_note') return 'voice_note';
  if (purpose && purpose !== 'document') return purpose;
  if (mimeType?.startsWith('audio/')) return 'voice_note';
  if (mimeType?.startsWith('video/')) return 'video';
  return purpose || 'document';
}
