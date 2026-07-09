import fs from 'fs';
import path from 'path';
import type { StorageOptions, StorageService } from './types';

const UPLOAD_ROOT = path.resolve(__dirname, '..', '..', '..', '..', 'uploads');

export class LocalStorageAdapter implements StorageService {
  isRemote(): boolean {
    return false;
  }

  async save(storagePath: string, buffer: Buffer, _options?: StorageOptions): Promise<string> {
    const fullPath = path.join(UPLOAD_ROOT, storagePath);
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    await fs.promises.writeFile(fullPath, buffer);
    return storagePath;
  }

  async get(storagePath: string, _options?: StorageOptions): Promise<Buffer> {
    return fs.promises.readFile(path.join(UPLOAD_ROOT, storagePath));
  }

  async delete(storagePath: string, _options?: StorageOptions): Promise<void> {
    const fullPath = path.join(UPLOAD_ROOT, storagePath);
    if (fs.existsSync(fullPath)) {
      await fs.promises.unlink(fullPath);
    }
  }

  url(storagePath: string): string {
    return `/uploads/${storagePath}`;
  }
}
