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

  async getStream(storagePath: string, options?: StorageOptions): Promise<import('./types').StorageGetResult> {
    const fullPath = path.join(UPLOAD_ROOT, storagePath);
    const stat = await fs.promises.stat(fullPath);
    let start: number | undefined;
    let end: number | undefined;
    let contentLength: number | undefined = stat.size;
    let contentRange: string | undefined;
    let statusCode: number | undefined = 200;

    // Basic Range support: bytes=0-1023, bytes=100-, bytes=-500
    if (options?.range) {
      const rangeMatch = options.range.match(/bytes=(\d*)-(\d*)/);
      if (rangeMatch) {
        const rangeStart = rangeMatch[1] ? parseInt(rangeMatch[1], 10) : undefined;
        const rangeEnd = rangeMatch[2] ? parseInt(rangeMatch[2], 10) : undefined;
        if (rangeStart != null && !isNaN(rangeStart)) {
          start = rangeStart;
          if (rangeEnd != null && !isNaN(rangeEnd)) {
            end = rangeEnd;
            contentLength = end - start + 1;
          } else {
            end = stat.size - 1;
            contentLength = stat.size - start;
          }
        } else if (rangeEnd != null && !isNaN(rangeEnd)) {
          // suffix: bytes=-500
          start = stat.size - rangeEnd;
          end = stat.size - 1;
          contentLength = rangeEnd;
        }
        // Validate range
        if (start != null && (start < 0 || start >= stat.size)) {
          const err: any = new Error('Range Not Satisfiable');
          err.status = 416;
          throw err;
        }
        if (end != null && end >= stat.size) end = stat.size - 1;
        if (start != null && end != null) {
          contentRange = `bytes ${start}-${end}/${stat.size}`;
          statusCode = 206;
        } else if (start != null) {
          contentRange = `bytes ${start}-${stat.size - 1}/${stat.size}`;
          statusCode = 206;
        }
      }
    }

    const stream = fs.createReadStream(fullPath, { start, end });
    // Handle stream errors (file not found etc.) — let them propagate
    return {
      body: stream as unknown as Readable,
      contentLength,
      contentType: undefined,
      etag: `"${stat.size}-${stat.mtimeMs}"`,
      lastModified: stat.mtime,
      contentRange,
      statusCode,
    };
  }

  async delete(storagePath: string, _options?: StorageOptions): Promise<void> {
    const fullPath = path.join(UPLOAD_ROOT, storagePath);
    if (fs.existsSync(fullPath)) {
      await fs.promises.unlink(fullPath);
    }
  }
}
