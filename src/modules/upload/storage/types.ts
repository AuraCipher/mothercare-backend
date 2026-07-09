export const DOCUMENTS_BUCKET = 'mcs-documents';
export const BACKUPS_BUCKET = 'mcs-backups';
export const LOCAL_BUCKET = 'local';

export interface StorageOptions {
  bucket?: string;
}

export interface StorageService {
  save(storagePath: string, buffer: Buffer, options?: StorageOptions): Promise<string>;
  get(storagePath: string, options?: StorageOptions): Promise<Buffer>;
  delete(storagePath: string, options?: StorageOptions): Promise<void>;
  /** Legacy static path hint; prefer FileRecord.publicUrl or /api/uploads/:id */
  url(storagePath: string): string;
  isRemote(): boolean;
}
