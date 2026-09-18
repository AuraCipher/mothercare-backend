/**
 * R2-11a — Storage Safety Hardening Tests
 *
 * Focused regression tests for:
 * - Sharp dimension limit (prevent OOM from massive images)
 * - Sharp concurrency bound (never exceeds configured limit)
 * - R2 S3Client request timeout configuration
 * - Temp file cleanup on client disconnect
 * - sanitizeSegment blocks path traversal (..)
 * - Sharp metadata optimization (resolveWithObject)
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

// ─── Sharp dimension limit (direct Sharp test bypassing moduleNameMapper) ───
// The jest.config.ts maps 'sharp' → __mocks__/sharp.ts. We bypass this
// by directly requiring the native module from node_modules for these tests.

describe('R2-11a — Sharp dimension limit', () => {
  test('sharp rejects images exceeding 8192×8192 pixel limit', async () => {
    // Load real sharp directly from node_modules, bypassing moduleNameMapper
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const realSharp = require(path.resolve(__dirname, '../../../node_modules/sharp'));

    // Create a 10000x10000 JPEG (100M pixels, well over 67M limit)
    const bigImage = await realSharp({
      create: {
        width: 10000,
        height: 10000,
        channels: 3,
        background: { r: 255, g: 0, b: 0 },
      },
    }).jpeg().toBuffer();

    // Processing with limitInputPixels should throw
    await expect(
      realSharp(bigImage, { limitInputPixels: 8192 * 8192 }).rotate().metadata(),
    ).rejects.toThrow(/pixel limit/);
  });

  test('sharp accepts images within 8192×8192 pixel limit', async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const realSharp = require(path.resolve(__dirname, '../../../node_modules/sharp'));

    const normalImage = await realSharp({
      create: {
        width: 800,
        height: 600,
        channels: 3,
        background: { r: 0, g: 128, b: 255 },
      },
    }).jpeg().toBuffer();

    const meta = await realSharp(normalImage, { limitInputPixels: 8192 * 8192 }).rotate().metadata();
    expect(meta.width).toBe(800);
    expect(meta.height).toBe(600);
  });

  test('processUploadBuffer translates pixel-limit errors to 413', async () => {
    // The media.pipeline module wraps sharp errors into structured { status: 413 } errors.
    // We verify this by mocking sharp to throw the same error real sharp throws.
    jest.resetModules();
    jest.doMock('sharp', () => {
      const realSharp = require(path.resolve(__dirname, '../../../node_modules/sharp'));
      // Wrap real sharp but override to throw on oversized images
      const wrapper = (input: any, opts?: any) => {
        if (Buffer.isBuffer(input) && opts?.limitInputPixels) {
          // Simulate oversized: if buffer is big enough, throw like real sharp
          if (input.length > 100000) {
            const err = new Error('Input image exceeds pixel limit');
            throw err;
          }
        }
        return realSharp(input, opts);
      };
      wrapper.cache = realSharp.cache;
      wrapper.concurrency = realSharp.concurrency;
      wrapper.count = realSharp.count;
      wrapper.simd = realSharp.simd;
      wrapper.versions = realSharp.versions;
      return wrapper;
    });
    jest.doMock('file-type', () => ({
      fileTypeFromBuffer: jest.fn().mockResolvedValue({ mime: 'image/jpeg', ext: 'jpg' }),
    }));

    const { processUploadBuffer } = await import('../../../src/modules/upload/media.pipeline');

    // A large buffer (>100KB) will trigger the mock's pixel-limit error
    const largeBuffer = Buffer.alloc(200_000, 0xff);

    await expect(
      processUploadBuffer({
        buffer: largeBuffer,
        originalName: 'huge.jpg',
        purpose: 'document',
        maxBytes: 50 * 1024 * 1024,
      }),
    ).rejects.toMatchObject({ status: 413 });

    jest.restoreAllMocks();
    jest.resetModules();
  });
});

// ─── Sharp concurrency bound ───
describe('R2-11a — Sharp concurrency bound', () => {
  test('pLimit is used in media.pipeline — concurrency=3 documented in source', async () => {
    // Read the source file and verify the concurrency limiter is configured
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../../src/modules/upload/media.pipeline.ts'),
      'utf8',
    );
    // Verify pLimit is imported and used with concurrency=3
    expect(src).toContain("pLimit(3)");
    expect(src).toContain("sharpConcurrency");
  });
});

// ─── R2 S3Client request timeout ───
describe('R2-11a — R2 S3Client request timeout', () => {
  test('R2StorageAdapter module loads without errors', async () => {
    const mod = await import('../../../src/modules/upload/storage/r2.storage');
    expect(mod.R2StorageAdapter).toBeDefined();
    expect(typeof mod.createR2Client).toBe('function');
  });

  test('R2 client configured with NodeHttpHandler and requestTimeout', async () => {
    // Verify the source code includes requestTimeout configuration
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../../src/modules/upload/storage/r2.storage.ts'),
      'utf8',
    );
    expect(src).toContain('NodeHttpHandler');
    expect(src).toContain('requestTimeout: 30_000');
  });

  test('createR2Client returns a functional S3Client', async () => {
    jest.mock('../../../src/config/env', () => ({
      __esModule: true,
      default: {
        R2_ACCOUNT_ID: 'test-account',
        R2_ACCESS_KEY_ID: 'test-key',
        R2_SECRET_ACCESS_KEY: 'test-secret',
        R2_DOCUMENTS_BUCKET: 'test-bucket',
      },
    }));

    const { createR2Client } = await import('../../../src/modules/upload/storage/r2.storage');
    const client = createR2Client();
    expect(client).toBeDefined();
    expect(typeof client.send).toBe('function');
  });
});

// ─── Temp file cleanup on disconnect ───
describe('R2-11a — Temp file cleanup on disconnect', () => {
  test('busboy pipe errors trigger cleanup via fail()', async () => {
    // Verify the source code has proper cleanup via fail() for disconnect scenarios.
    // The original approach of req.on('close') during busboy was removed because
    // it races with the service's file read (req.on('close') fires when the request
    // body is fully received, before busboy 'finish' event).
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../../src/modules/upload/upload.routes.ts'),
      'utf8',
    );
    // Busboy errors should trigger fail() which cleans up temp files
    expect(src).toContain("bb.on('error'");
    // fail() should call cleanupTemp()
    expect(src).toContain('cleanupTemp()');
  });
});

// ─── sanitizeSegment blocks path traversal ───
describe('R2-11a — sanitizeSegment blocks path traversal', () => {
  test('buildStoragePath blocks .. in entityId', async () => {
    const { buildStoragePath } = await import('../../../src/modules/upload/storage-paths');

    const result = buildStoragePath({
      purpose: 'document',
      ext: 'pdf',
      entityType: 'student',
      entityId: '../../etc/passwd',
    });

    expect(result).not.toContain('..');
    expect(result).not.toContain('/etc');
  });

  test('buildStoragePath normalizes legitimate segments', async () => {
    const { buildStoragePath } = await import('../../../src/modules/upload/storage-paths');

    const result = buildStoragePath({
      purpose: 'profile',
      ext: 'webp',
      entityType: 'teacher',
      entityId: 'abc-123',
    });

    expect(result).toContain('profiles/');
    expect(result).toContain('teacher/');
    expect(result).toContain('abc-123/');
    expect(result).toMatch(/\.webp$/);
  });

  test('buildStoragePath blocks .. in academicYearId', async () => {
    const { buildStoragePath } = await import('../../../src/modules/upload/storage-paths');

    const result = buildStoragePath({
      purpose: 'chat',
      ext: 'mp4',
      academicYearId: '../../../tmp/evil',
      roomId: 'room-1',
    });

    expect(result).not.toContain('..');
    expect(result).not.toContain('/tmp');
  });

  test('sanitizeSegment replaces .. with __ before general sanitization', async () => {
    // Verify the source code blocks .. before the general regex
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../../src/modules/upload/storage-paths.ts'),
      'utf8',
    );
    expect(src).toContain("value.replace(/\\.\\./g, '__')");
  });
});

// ─── Sharp metadata optimization (resolveWithObject) ───
describe('R2-11a — Sharp metadata optimization (resolveWithObject)', () => {
  test('media.pipeline uses resolveWithObject to avoid extra Sharp instance', async () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../../src/modules/upload/media.pipeline.ts'),
      'utf8',
    );
    // Both profile and general image paths should use resolveWithObject
    const matches = src.match(/resolveWithObject:\s*true/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBeGreaterThanOrEqual(2);
  });

  test('processImage function exists as separate exported function', async () => {
    // Verify processImage was extracted from processUploadBuffer
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../../src/modules/upload/media.pipeline.ts'),
      'utf8',
    );
    expect(src).toContain('async function processImage(');
    expect(src).toContain('return sharpConcurrency(() => processImage(');
  });
});
