import env from '../../../config/env';
import { LocalStorageAdapter } from './local.storage';
import { R2StorageAdapter } from './r2.storage';
import type { StorageOptions, StorageService } from './types';
import { DOCUMENTS_BUCKET, LOCAL_BUCKET } from './types';

export * from './types';
export { createR2Client } from './r2.storage';

const localStorage = new LocalStorageAdapter();
let r2Storage: R2StorageAdapter | null = null;

export function isR2Enabled(): boolean {
  return Boolean(
    env.R2_ACCOUNT_ID &&
      env.R2_ACCESS_KEY_ID &&
      env.R2_SECRET_ACCESS_KEY,
  );
}

function getR2Storage(): R2StorageAdapter {
  if (!r2Storage) {
    r2Storage = new R2StorageAdapter();
  }
  return r2Storage;
}

export function getDefaultDocumentsBucket(): string {
  return isR2Enabled() ? (env.R2_DOCUMENTS_BUCKET || DOCUMENTS_BUCKET) : LOCAL_BUCKET;
}

export function getStorageForBucket(bucket?: string): StorageService {
  if (!bucket || bucket === LOCAL_BUCKET) {
    return localStorage;
  }
  if (!isR2Enabled()) {
    throw new Error('R2 is not configured but a remote bucket was requested');
  }
  return getR2Storage();
}

class StorageRouter implements StorageService {
  isRemote(): boolean {
    return isR2Enabled();
  }

  async save(storagePath: string, buffer: Buffer, options?: StorageOptions): Promise<string> {
    const bucket = options?.bucket || getDefaultDocumentsBucket();
    return getStorageForBucket(bucket).save(storagePath, buffer, { bucket });
  }

  async get(storagePath: string, options?: StorageOptions): Promise<Buffer> {
    const bucket = options?.bucket || getDefaultDocumentsBucket();
    return getStorageForBucket(bucket).get(storagePath, options);
  }

  async delete(storagePath: string, options?: StorageOptions): Promise<void> {
    const bucket = options?.bucket || getDefaultDocumentsBucket();
    return getStorageForBucket(bucket).delete(storagePath, options);
  }

  url(storagePath: string): string {
    if (isR2Enabled()) {
      return getR2Storage().url(storagePath);
    }
    return localStorage.url(storagePath);
  }
}

export const storage = new StorageRouter();
