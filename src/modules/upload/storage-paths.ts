import { v4 as uuidv4 } from 'uuid';

export const UPLOAD_ENTITY_TYPES = ['student', 'teacher', 'staff', 'canteen_supplier', 'stationary_supplier', 'chat', 'receipt', 'general'] as const;
export type UploadEntityType = (typeof UPLOAD_ENTITY_TYPES)[number];

export const UPLOAD_PURPOSES = [
  'profile',
  'document',
  'chat',
  'receipt',
  'voice_note',
  'video',
  'general',
] as const;
export type UploadPurpose = (typeof UPLOAD_PURPOSES)[number];

export interface StoragePathInput {
  purpose: UploadPurpose;
  ext: string;
  entityType?: string;
  entityId?: string;
  roomId?: string;
  academicYearId?: string;
}

export function buildStoragePath(input: StoragePathInput): string {
  const now = new Date();
  const year = String(now.getFullYear());
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const fileName = `${uuidv4()}.${input.ext}`;
  const segment = (value?: string, fallback = 'unknown') => sanitizeSegment(value || fallback);

  switch (input.purpose) {
    case 'profile':
      return `profiles/${segment(input.entityType)}/${segment(input.entityId)}/${year}/${month}/${fileName}`;
    case 'document':
      return `documents/${segment(input.entityType)}/${segment(input.entityId)}/${year}/${month}/${fileName}`;
    case 'chat':
    case 'voice_note':
    case 'video':
      return `chat/${segment(input.academicYearId)}/${segment(input.roomId, 'draft')}/${year}/${month}/${fileName}`;
    case 'receipt':
      return `receipts/${segment(input.entityId)}/${year}/${month}/${fileName}`;
    default:
      return `general/${year}/${month}/${fileName}`;
  }
}

function sanitizeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_');
}
