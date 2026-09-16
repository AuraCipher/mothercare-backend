import type { Readable } from 'stream';

export const DOCUMENTS_BUCKET = 'mcs-documents';
export const BACKUPS_BUCKET = 'mcs-backups';
export const LOCAL_BUCKET = 'local';

export interface StorageOptions {
  bucket?: string;
  contentLength?: number;
  contentType?: string;
  range?: string;
}

export interface StorageGetResult {
  body: Readable;
  contentLength?: number;
  contentType?: string;
  etag?: string;
  lastModified?: Date;
  contentRange?: string;
  statusCode?: number;
}

export interface StorageService {
  save(storagePath: string, body: Readable | Buffer, options?: StorageOptions): Promise<string>;
  get(storagePath: string, options?: StorageOptions): Promise<Buffer>;
  /** Streaming read — preferred for download path (no Buffer.concat) */
  getStream(storagePath: string, options?: StorageOptions): Promise<StorageGetResult>;
  delete(storagePath: string, options?: StorageOptions): Promise<void>;
  /** Legacy static path hint; prefer FileRecord.publicUrl or /api/uploads/:id */
  url(storagePath: string): string;
  isRemote(): boolean;
}
