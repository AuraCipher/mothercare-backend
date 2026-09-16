import fs from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import type { StorageOptions, StorageService } from './types';

const UPLOAD_ROOT = path.resolve(__dirname, '..', '..', '..', '..', 'uploads');

export class LocalStorageAdapter implements StorageService {
  isRemote(): boolean {
    return false;
  }

  async save(storagePath: string, body: Readable | Buffer, _options?: StorageOptions): Promise<string> {
    const fullPath = path.join(UPLOAD_ROOT, storagePath);
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (Buffer.isBuffer(body)) {
      await fs.promises.writeFile(fullPath, body);
      return storagePath;
    }
    // Streaming path — pipeline Readable into file, cleanup partial on failure
    const writeStream = fs.createWriteStream(fullPath);
    try {
      await pipeline(body as Readable, writeStream);
    } catch (err) {
      // Remove partial file on failure
      try {
        if (fs.existsSync(fullPath)) await fs.promises.unlink(fullPath);
      } catch {}
      throw err;
    }
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
