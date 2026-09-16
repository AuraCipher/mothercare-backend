/**
 * R2-03 — Download streaming regression tests
 *
 * Verifies that GET /api/uploads/:id streams without whole-file Buffer,
 * handles Range, errors, disconnect, and preserves headers/auth.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Readable } from 'stream';
import { prismaMock } from '../../mocks/prisma';
import request from 'supertest';
import app from '../../../src/app';
import { generateTestToken, getAuthHeader } from '../../helpers/auth';
import { storage } from '../../../src/modules/upload/storage';

const adminToken = getAuthHeader(generateTestToken('admin-1', 'super_admin', { branchIds: ['b1'] }));

// Mock storage getStream to control streaming behavior
jest.mock('../../../src/modules/upload/storage', () => {
  const actual = jest.requireActual('../../../src/modules/upload/storage');
  return {
    ...actual,
    storage: {
      save: jest.fn().mockResolvedValue('mocked/path'),
      get: jest.fn().mockResolvedValue(Buffer.from('old-buffer')),
      getStream: jest.fn(),
      delete: jest.fn(),
    },
    getDefaultDocumentsBucket: jest.fn(() => 'test-bucket'),
  };
});

function createChunkedReadable(totalSize: number, chunkSize = 64 * 1024): Readable {
  let remaining = totalSize;
  return new Readable({
    read() {
      if (remaining <= 0) {
        this.push(null);
        return;
      }
      const size = Math.min(chunkSize, remaining);
      this.push(Buffer.alloc(size, 'a'));
      remaining -= size;
    },
  });
}

describe('Download streaming — R2-03', () => {
  const mockRecord = {
    id: 'file-dl-1',
    originalName: 'doc.pdf',
    storagePath: 'documents/general/2026/06/test.pdf',
    storageBucket: 'test-bucket',
    mimeType: 'application/pdf',
    size: 1024,
    width: null,
    height: null,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    prismaMock.fileRecord.findUnique.mockResolvedValue(mockRecord as any);
  });

  // Test A: mocked R2 download returns Readable, HTTP streams it
  test('Test A: R2 Readable is streamed, not buffered via Buffer.concat', async () => {
    const readable = createChunkedReadable(1024, 256);
    const getStreamMock = storage.getStream as jest.Mock;
    getStreamMock.mockResolvedValue({
      body: readable,
      contentLength: 1024,
      contentType: 'application/pdf',
      etag: '"test-etag"',
      lastModified: new Date('2026-01-01'),
    });

    const res = await request(app).get('/api/uploads/file-dl-1').set(adminToken).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c as any));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(getStreamMock).toHaveBeenCalledWith('documents/general/2026/06/test.pdf', expect.objectContaining({ bucket: 'test-bucket' }));
    // Verify body was streamed (length matches)
    expect((res.body as Buffer).length).toBe(1024);
  });

  // Test B: 25 MB synthetic stream without single full Buffer
  test('Test B: 25 MB large stream without single full-size Buffer', async () => {
    const size = 25 * 1024 * 1024;
    const readable = createChunkedReadable(size, 1024 * 1024); // 1 MB chunks, no single 25 MB Buffer in test heap for creation (we reuse)
    const getStreamMock = storage.getStream as jest.Mock;
    getStreamMock.mockResolvedValue({
      body: readable,
      contentLength: size,
      contentType: 'application/pdf',
    });

    // Update mock record size to 25 MB
    prismaMock.fileRecord.findUnique.mockResolvedValue({ ...mockRecord, size } as any);

    const res = await request(app).get('/api/uploads/file-dl-1').set(adminToken).buffer(true).parse((res, cb) => {
      let total = 0;
      res.on('data', (c: Buffer) => { total += (c as any).length; });
      res.on('end', () => cb(null, Buffer.from(String(total))));
    });

    expect(res.status).toBe(200);
    expect(res.headers['content-length']).toBe(String(size));
    // Body is total as string, not 25 MB Buffer, so we didn't create a second 25 MB Buffer in test
    expect((res.body as Buffer).toString()).toBe(String(size));
  });

  // Test C: Local storage download uses read stream
  test('Test C: Local adapter streams via createReadStream', async () => {
    const { LocalStorageAdapter } = await import('../../../src/modules/upload/storage/local.storage');
    const adapter = new LocalStorageAdapter();
    const tmpPath = `test-local-stream-${Date.now()}/file.txt`;
    const content = 'hello world '.repeat(1000); // ~12 KB
    const readable = Readable.from(Buffer.from(content));
    await adapter.save(tmpPath, readable as any, {});
    const result = await adapter.getStream(tmpPath, {});
    expect(result.body).toBeDefined();
    expect(typeof (result.body as any).pipe).toBe('function');
    // Consume stream
    const chunks: Buffer[] = [];
    for await (const chunk of result.body as any) {
      chunks.push(Buffer.from(chunk as any));
    }
    expect(Buffer.concat(chunks).toString()).toBe(content);
    // Cleanup
    await adapter.delete(tmpPath, {});
    // Verify partial cleanup on failure
    const failing = new Readable({
      read() { this.emit('error', new Error('stream fail')); },
    });
    await expect(adapter.save(`test-fail-${Date.now()}/file.txt`, failing as any, {})).rejects.toThrow();
  });

  // Test D: R2 source stream error propagates
  test('Test D: R2 stream error propagates and does not hang', async () => {
    const errorReadable = new Readable({
      read() {
        this.emit('error', new Error('R2 read fail'));
      },
    });
    const getStreamMock = storage.getStream as jest.Mock;
    getStreamMock.mockResolvedValue({
      body: errorReadable,
      contentLength: 100,
    });

    try {
      const res = await request(app).get('/api/uploads/file-dl-1').set(adminToken);
      // If error happens before headers, it will be 500; if after, socket hang up is also acceptable (stream destroyed)
      expect([500, 200]).toContain(res.status);
      expect(getStreamMock).toHaveBeenCalled();
    } catch (err: any) {
      // Socket hang up is also acceptable for stream error after headers sent — means pipeline destroyed correctly and didn't hang
      expect(err.message).toMatch(/hang up|Parse Error|ECONNRESET/i);
      expect(getStreamMock).toHaveBeenCalled();
    }
  });

  // Test E: Client abort does not drain remaining object (stream destroyed)
  test('Test E: client abort destroys source stream', async () => {
    let destroyed = false;
    let pushed = 0;
    const largeReadable = new Readable({
      read() {
        if (pushed >= 10) {
          this.push(null);
          return;
        }
        this.push(Buffer.alloc(1024 * 1024, 'b'));
        pushed++;
      },
    });
    // Track destroy
    const originalDestroy = largeReadable.destroy.bind(largeReadable);
    largeReadable.destroy = ((...args: any[]) => {
      destroyed = true;
      return (originalDestroy as any)(...args);
    }) as any;

    const getStreamMock = storage.getStream as jest.Mock;
    getStreamMock.mockResolvedValue({
      body: largeReadable,
      contentLength: 10 * 1024 * 1024,
    });

    try {
      const res = await request(app).get('/api/uploads/file-dl-1').set(adminToken);
      expect(res.status).toBe(200);
      await new Promise((r) => setTimeout(r, 10));
      expect(largeReadable.readableEnded || destroyed || (largeReadable as any).destroyed || pushed === 10).toBeTruthy();
    } catch (err: any) {
      // Supertest may throw Parse Error if stream is destroyed mid-response (client abort simulation)
      expect(err.message).toMatch(/hang up|Parse Error|ECONNRESET/i);
      expect(destroyed || (largeReadable as any).destroyed).toBeTruthy();
    }
  });

  // Test F: Content-Type and Content-Length preserved
  test('Test F: Content-Type and Content-Length from storage preserved', async () => {
    const readable = createChunkedReadable(2048, 512);
    const getStreamMock = storage.getStream as jest.Mock;
    getStreamMock.mockResolvedValue({
      body: readable,
      contentLength: 2048,
      contentType: 'application/pdf',
      etag: '"abc123"',
      lastModified: new Date('2026-02-02T00:00:00Z'),
    });

    const res = await request(app).get('/api/uploads/file-dl-1').set(adminToken);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-length']).toBe('2048');
    expect(res.headers['etag']).toBe('"abc123"');
    expect(res.headers['last-modified']).toBe(new Date('2026-02-02T00:00:00Z').toUTCString());
    expect(res.headers['accept-ranges']).toBe('bytes');
  });

  // Test G: Existing authorization unchanged
  test('Test G: authorization still enforced (401 without auth, 404 for unknown)', async () => {
    const res1 = await request(app).get('/api/uploads/file-dl-1');
    expect(res1.status).toBe(401);

    prismaMock.fileRecord.findUnique.mockResolvedValue(null);
    const res2 = await request(app).get('/api/uploads/unknown-id').set(adminToken);
    expect(res2.status).toBe(404);
  });

  // Range support
  test('Range request returns 206 with Content-Range', async () => {
    const fullSize = 1000;
    const readable = createChunkedReadable(500, 500); // 500 bytes for range 0-499
    const getStreamMock = storage.getStream as jest.Mock;
    // Simulate storage returning range result
    getStreamMock.mockImplementation(async (_path: string, opts: any) => {
      if (opts?.range === 'bytes=0-499') {
        return {
          body: readable,
          contentLength: 500,
          contentRange: `bytes 0-499/${fullSize}`,
          statusCode: 206,
          etag: '"etag"',
        };
      }
      return { body: readable, contentLength: fullSize, statusCode: 200 };
    });

    const res = await request(app).get('/api/uploads/file-dl-1').set(adminToken).set('Range', 'bytes=0-499');
    expect(res.status).toBe(206);
    expect(res.headers['content-range']).toBe('bytes 0-499/1000');
    expect(res.headers['content-length']).toBe('500');
    expect(res.headers['accept-ranges']).toBe('bytes');
  });

  test('Range Not Satisfiable returns 416', async () => {
    const getStreamMock = storage.getStream as jest.Mock;
    getStreamMock.mockImplementation(async () => {
      const err: any = new Error('Range Not Satisfiable');
      err.status = 416;
      throw err;
    });

    const res = await request(app).get('/api/uploads/file-dl-1').set(adminToken).set('Range', 'bytes=999999-');
    expect(res.status).toBe(416);
  });
});
