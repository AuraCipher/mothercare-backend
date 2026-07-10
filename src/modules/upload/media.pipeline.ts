import sharp from 'sharp';
import { fileTypeFromBuffer } from 'file-type';

export const ALLOWED_MIMES = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml', 'image/bmp', 'image/tiff', 'image/x-icon', 'image/vnd.microsoft.icon',
  'application/pdf', 'application/rtf',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel.sheet.macroEnabled.12', 'application/vnd.ms-excel.sheet.binaryMacroEnabled.12',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.template', 'application/vnd.ms-excel.template.macroEnabled.12',
  'application/vnd.ms-excel.addin.macroEnabled.12',
  'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.oasis.opendocument.text', 'application/vnd.oasis.opendocument.spreadsheet', 'application/vnd.oasis.opendocument.presentation',
  'text/plain', 'text/csv', 'text/html', 'text/markdown', 'text/css', 'text/javascript', 'text/yaml', 'text/xml',
  'application/json', 'application/xml', 'application/typescript', 'application/x-yaml', 'application/x-toml',
  'application/zip', 'application/x-rar-compressed', 'application/x-7z-compressed', 'application/x-tar', 'application/gzip',
  'font/ttf', 'font/otf', 'font/woff', 'font/woff2',
  'video/mp4', 'video/webm', 'video/x-msvideo', 'video/quicktime',
  'audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/webm', 'audio/aac', 'audio/x-m4a', 'audio/wav', 'audio/x-wav',
]);

export const EXT_MAP: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif',
  svg: 'image/svg+xml', bmp: 'image/bmp', tiff: 'image/tiff', tif: 'image/tiff', ico: 'image/x-icon',
  pdf: 'application/pdf', rtf: 'application/rtf',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xlsm: 'application/vnd.ms-excel.sheet.macroEnabled.12', xlsb: 'application/vnd.ms-excel.sheet.binaryMacroEnabled.12',
  xltx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.template', xltm: 'application/vnd.ms-excel.template.macroEnabled.12',
  xlt: 'application/vnd.ms-excel', xlam: 'application/vnd.ms-excel.addin.macroEnabled.12',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odt: 'application/vnd.oasis.opendocument.text', ods: 'application/vnd.oasis.opendocument.spreadsheet', odp: 'application/vnd.oasis.opendocument.presentation',
  txt: 'text/plain', csv: 'text/csv', html: 'text/html', htm: 'text/html', md: 'text/markdown',
  css: 'text/css', js: 'text/javascript', ts: 'application/typescript', jsx: 'text/javascript', tsx: 'application/typescript',
  json: 'application/json', xml: 'application/xml', yaml: 'application/x-yaml', yml: 'application/x-yaml', toml: 'application/x-toml',
  zip: 'application/zip', rar: 'application/x-rar-compressed', '7z': 'application/x-7z-compressed',
  tar: 'application/x-tar', gz: 'application/gzip', tgz: 'application/gzip',
  mp4: 'video/mp4', webm: 'video/webm', avi: 'video/x-msvideo', mov: 'video/quicktime',
  mp3: 'audio/mpeg', m4a: 'audio/x-m4a', ogg: 'audio/ogg', wav: 'audio/wav',
  ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2',
};

export const PROFILE_MAX_DIM = 300;
export const CHAT_IMAGE_MAX_DIM = 2048;

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
    if (mime === 'image/svg+xml' || mime === 'image/gif') {
      return {
        buffer,
        mimeType: mime,
        ext: type?.ext || (mime === 'image/svg+xml' ? 'svg' : 'gif'),
        width: null,
        height: null,
      };
    }

    const img = sharp(buffer).rotate();
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
      const resized = await pipeline.webp({ quality: 80 }).toBuffer();
      const resizedMeta = await sharp(resized).metadata();
      return {
        buffer: resized,
        mimeType: 'image/webp',
        ext: 'webp',
        width: resizedMeta.width || width,
        height: resizedMeta.height || height,
      };
    }

    if (purpose === 'chat') {
      pipeline = pipeline.resize(CHAT_IMAGE_MAX_DIM, CHAT_IMAGE_MAX_DIM, {
        fit: 'inside',
        withoutEnlargement: true,
      });
    }

    const processed = await pipeline.webp({ quality: 80 }).toBuffer();
    const processedMeta = await sharp(processed).metadata();
    return {
      buffer: processed,
      mimeType: 'image/webp',
      ext: 'webp',
      width: processedMeta.width || width,
      height: processedMeta.height || height,
    };
  }

  return {
    buffer,
    mimeType: mime,
    ext: type?.ext || fileExt || 'bin',
    width: null,
    height: null,
  };
}

export function normalizePurpose(purpose?: string, mimeType?: string): string {
  if (purpose === 'voice_note') return 'voice_note';
  if (purpose && purpose !== 'document') return purpose;
  if (mimeType?.startsWith('audio/')) return 'voice_note';
  if (mimeType?.startsWith('video/')) return 'video';
  return purpose || 'document';
}
