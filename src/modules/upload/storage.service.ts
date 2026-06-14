import fs from 'fs';
import path from 'path';
import env from '../../config/env';

const UPLOAD_ROOT = path.resolve(__dirname, '..', '..', '..', 'uploads');

export interface StorageService {
  save(filePath: string, buffer: Buffer): Promise<string>;
  get(filePath: string): Promise<Buffer>;
  delete(filePath: string): Promise<void>;
  url(filePath: string): string;
}

class LocalStorageAdapter implements StorageService {
  async save(storagePath: string, buffer: Buffer): Promise<string> {
    const fullPath = path.join(UPLOAD_ROOT, storagePath);
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    await fs.promises.writeFile(fullPath, buffer);
    return storagePath;
  }

  async get(storagePath: string): Promise<Buffer> {
    return fs.promises.readFile(path.join(UPLOAD_ROOT, storagePath));
  }

  async delete(storagePath: string): Promise<void> {
    const fullPath = path.join(UPLOAD_ROOT, storagePath);
    if (fs.existsSync(fullPath)) {
      await fs.promises.unlink(fullPath);
    }
  }

  url(storagePath: string): string {
    return `/uploads/${storagePath}`;
  }
}

// Factory — swap to S3Storage here later
export function createStorage(): StorageService {
  return new LocalStorageAdapter();
}

export const storage = createStorage();
