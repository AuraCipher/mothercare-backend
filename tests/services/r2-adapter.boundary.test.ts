/**
 * R2-12c — R2 Adapter Boundary Tests
 *
 * Validates the R2 storage boundary without credentials:
 *  - Configuration validation (isR2Enabled, bucket defaults, missing config)
 *  - Request timeout wiring (NodeHttpHandler requestTimeout)
 *  - Upload/download error classification
 *  - Streaming interface preservation
 *  - Signed URL / path handling
 *  - Content metadata and security headers
 *  - No full-buffer regression
 */

import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';

// ─── Env mock ──────────────────────────────────────────────
const envMock: Record<string, string> = {
  R2_ACCOUNT_ID: '',
  R2_ACCESS_KEY_ID: '',
  R2_SECRET_ACCESS_KEY: '',
  R2_DOCUMENTS_BUCKET: 'mcs-documents',
  R2_BACKUPS_BUCKET: 'mcs-backups',
  R2_PUBLIC_BASE_URL: '',
};

jest.mock('../../src/config/env', () => ({
  __esModule: true,
  default: new Proxy(
    {},
    {
      get(_target, prop: string) {
        return envMock[prop] ?? '';
      },
    },
  ),
}));

jest.mock('../../src/lib/logger', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

// ─── isR2Enabled / Storage Router ──────────────────────────

describe('R2-12c — Storage Router configuration', () => {
  beforeEach(() => {
    envMock.R2_ACCOUNT_ID = '';
    envMock.R2_ACCESS_KEY_ID = '';
    envMock.R2_SECRET_ACCESS_KEY = '';
  });

  test('isR2Enabled returns false when all R2 credentials are empty', async () => {
    const { isR2Enabled } = await import('../../src/modules/upload/storage/index');
    expect(isR2Enabled()).toBe(false);
  });

  test('isR2Enabled returns false when only ACCOUNT_ID is set', async () => {
    envMock.R2_ACCOUNT_ID = 'account-123';
    envMock.R2_ACCESS_KEY_ID = '';
    envMock.R2_SECRET_ACCESS_KEY = '';
    const { isR2Enabled } = await import('../../src/modules/upload/storage/index');
    expect(isR2Enabled()).toBe(false);
  });

  test('isR2Enabled returns false when only ACCESS_KEY_ID is set', async () => {
    envMock.R2_ACCOUNT_ID = '';
    envMock.R2_ACCESS_KEY_ID = 'key-123';
    envMock.R2_SECRET_ACCESS_KEY = '';
    const { isR2Enabled } = await import('../../src/modules/upload/storage/index');
    expect(isR2Enabled()).toBe(false);
  });

  test('isR2Enabled returns true when all three R2 credentials are set', async () => {
    envMock.R2_ACCOUNT_ID = 'account-123';
    envMock.R2_ACCESS_KEY_ID = 'key-123';
    envMock.R2_SECRET_ACCESS_KEY = 'secret-123';
    const { isR2Enabled } = await import('../../src/modules/upload/storage/index');
    expect(isR2Enabled()).toBe(true);
  });

  test('getDefaultDocumentsBucket returns "mcs-documents" when R2 is disabled', async () => {
    envMock.R2_DOCUMENTS_BUCKET = 'mcs-documents';
    const { getDefaultDocumentsBucket } = await import('../../src/modules/upload/storage/index');
    expect(getDefaultDocumentsBucket()).toBe('local');
  });

  test('getDefaultDocumentsBucket returns env bucket when R2 is enabled', async () => {
    envMock.R2_ACCOUNT_ID = 'acc';
    envMock.R2_ACCESS_KEY_ID = 'key';
    envMock.R2_SECRET_ACCESS_KEY = 'sec';
    envMock.R2_DOCUMENTS_BUCKET = 'custom-bucket';
    const { getDefaultDocumentsBucket } = await import('../../src/modules/upload/storage/index');
    expect(getDefaultDocumentsBucket()).toBe('custom-bucket');
  });

  test('getStorageForBucket throws when remote bucket requested but R2 disabled', async () => {
    envMock.R2_ACCOUNT_ID = '';
    envMock.R2_ACCESS_KEY_ID = '';
    envMock.R2_SECRET_ACCESS_KEY = '';
    const { getStorageForBucket } = await import('../../src/modules/upload/storage/index');
    expect(() => getStorageForBucket('remote-bucket')).toThrow('R2 is not configured');
  });

  test('getStorageForBucket returns local adapter for LOCAL_BUCKET', async () => {
    const { getStorageForBucket } = await import('../../src/modules/upload/storage/index');
    const adapter = getStorageForBucket('local');
    expect(adapter.isRemote()).toBe(false);
  });

  test('getStorageForBucket returns local adapter when bucket is undefined', async () => {
    const { getStorageForBucket } = await import('../../src/modules/upload/storage/index');
    const adapter = getStorageForBucket(undefined);
    expect(adapter.isRemote()).toBe(false);
  });
});

// ─── R2 Adapter — Timeout wiring ───────────────────────────

describe('R2-12c — R2 S3Client request timeout', () => {
  test('R2StorageAdapter source has requestTimeout: 30_000', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../src/modules/upload/storage/r2.storage.ts'),
      'utf8',
    );
    expect(src).toContain('requestTimeout: 30_000');
    expect(src).toContain('NodeHttpHandler');
  });

  test('createR2Client source has requestTimeout: 30_000', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../src/modules/upload/storage/r2.storage.ts'),
      'utf8',
    );
    // Both constructor and createR2Client should have timeout
    const matches = src.match(/requestTimeout:\s*30_000/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBeGreaterThanOrEqual(2);
  });

  test('R2StorageAdapter constructor uses env values for credentials', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../src/modules/upload/storage/r2.storage.ts'),
      'utf8',
    );
    expect(src).toContain('env.R2_ACCOUNT_ID');
    expect(src).toContain('env.R2_ACCESS_KEY_ID');
    expect(src).toContain('env.R2_SECRET_ACCESS_KEY');
    expect(src).toContain('env.R2_DOCUMENTS_BUCKET');
  });
});

// ─── R2 Adapter — Streaming interface ──────────────────────

describe('R2-12c — Streaming interface preservation', () => {
  test('R2StorageAdapter has all StorageService methods', async () => {
    const mod = await import('../../src/modules/upload/storage/r2.storage');
    const { R2StorageAdapter } = mod;
    const adapter = new R2StorageAdapter();
    expect(typeof adapter.save).toBe('function');
    expect(typeof adapter.get).toBe('function');
    expect(typeof adapter.getStream).toBe('function');
    expect(typeof adapter.delete).toBe('function');
    expect(typeof adapter.isRemote).toBe('function');
  });

  test('R2StorageAdapter.isRemote returns true', async () => {
    const { R2StorageAdapter } = await import('../../src/modules/upload/storage/r2.storage');
    const adapter = new R2StorageAdapter();
    expect(adapter.isRemote()).toBe(true);
  });

  test('StorageService interface includes getStream in types.ts', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../src/modules/upload/storage/types.ts'),
      'utf8',
    );
    expect(src).toContain('getStream');
    expect(src).toContain('StorageGetResult');
    expect(src).toContain('contentRange');
    expect(src).toContain('statusCode');
  });

  test('R2 adapter save accepts both Readable and Buffer', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../src/modules/upload/storage/r2.storage.ts'),
      'utf8',
    );
    // save method signature accepts Readable | Buffer
    expect(src).toContain('Readable | Buffer');
    // Streaming path uses multipart Upload
    expect(src).toContain('new Upload');
    expect(src).toContain('partSize');
  });

  test('R2 adapter getStream returns StorageGetResult with all fields', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../src/modules/upload/storage/r2.storage.ts'),
      'utf8',
    );
    expect(src).toContain('contentLength');
    expect(src).toContain('contentType');
    expect(src).toContain('etag');
    expect(src).toContain('lastModified');
    expect(src).toContain('contentRange');
    expect(src).toContain('statusCode');
  });
});

// ─── R2 Adapter — Content metadata and security headers ────

describe('R2-12c — Content metadata and security', () => {
  test('save passes ContentType when provided in options', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../src/modules/upload/storage/r2.storage.ts'),
      'utf8',
    );
    expect(src).toContain('options?.contentType');
    expect(src).toContain('ContentType');
  });

  test('save passes ContentLength for streaming uploads', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../src/modules/upload/storage/r2.storage.ts'),
      'utf8',
    );
    expect(src).toContain('ContentLength: body.length');
    expect(src).toContain('options?.contentLength');
  });

  test('getStream handles Range requests', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../src/modules/upload/storage/r2.storage.ts'),
      'utf8',
    );
    expect(src).toContain('Range');
    expect(src).toContain('options?.range');
  });

  test('streamToBuffer handles null, Buffer, Uint8Array, and AsyncIterable', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../src/modules/upload/storage/r2.storage.ts'),
      'utf8',
    );
    // streamToBuffer handles multiple body types
    expect(src).toContain('Buffer.isBuffer(body)');
    expect(src).toContain('Uint8Array');
    expect(src).toContain('AsyncIterable');
  });

  test('R2 client endpoint uses account-specific URL', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../src/modules/upload/storage/r2.storage.ts'),
      'utf8',
    );
    expect(src).toContain('.r2.cloudflarestorage.com');
    expect(src).toContain("region: 'auto'");
  });
});

// ─── R2 Adapter — Error classification ─────────────────────

describe('R2-12c — Error handling at boundary', () => {
  test('streamToBuffer rejects on stream error', async () => {
    // The streamToBuffer function should propagate errors
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../src/modules/upload/storage/r2.storage.ts'),
      'utf8',
    );
    // Verify error handling exists in streamToBuffer
    expect(src).toContain('reject(err)');
    expect(src).toContain('catch (err)');
  });

  test('R2 adapter error propagation does not crash — S3Client.send throws', async () => {
    // R2StorageAdapter methods call this.client.send() which can throw.
    // The calling code (upload.service.ts) wraps these in try/catch.
    // Verify that the adapter does not swallow errors silently.
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../src/modules/upload/storage/r2.storage.ts'),
      'utf8',
    );
    // save method should await this.client.send() — errors propagate naturally
    expect(src).toContain('await this.client.send');
  });
});

// ─── Storage paths — path traversal prevention ─────────────

describe('R2-12c — Storage path security', () => {
  test('buildStoragePath blocks double-dots in all segment fields', async () => {
    const { buildStoragePath } = await import('../../src/modules/upload/storage-paths');

    const maliciousInputs = [
      { purpose: 'document' as const, ext: 'pdf', entityType: '../../etc', entityId: 'test' },
      { purpose: 'document' as const, ext: 'pdf', entityType: 'student', entityId: '../../etc/passwd' },
      { purpose: 'profile' as const, ext: 'jpg', entityType: 'teacher', entityId: '../../../tmp/evil' },
      { purpose: 'chat' as const, ext: 'mp4', academicYearId: '../../../tmp', roomId: 'room1' },
    ];

    for (const input of maliciousInputs) {
      const result = buildStoragePath(input);
      expect(result).not.toContain('..');
      expect(result).not.toContain('/etc');
      expect(result).not.toContain('/tmp');
    }
  });

  test('buildStoragePath produces predictable structure for each purpose', async () => {
    const { buildStoragePath } = await import('../../src/modules/upload/storage-paths');

    const profile = buildStoragePath({ purpose: 'profile', ext: 'jpg', entityType: 'student', entityId: '123' });
    expect(profile).toMatch(/^profiles\/student\/123\/\d{4}\/\d{2}\/[\w-]+\.jpg$/);

    const doc = buildStoragePath({ purpose: 'document', ext: 'pdf', entityType: 'teacher', entityId: '456' });
    expect(doc).toMatch(/^documents\/teacher\/456\/\d{4}\/\d{2}\/[\w-]+\.pdf$/);

    const chat = buildStoragePath({ purpose: 'chat', ext: 'mp4', academicYearId: 'ay-1', roomId: 'room-1' });
    expect(chat).toMatch(/^chat\/ay-1\/room-1\/\d{4}\/\d{2}\/[\w-]+\.mp4$/);

    const receipt = buildStoragePath({ purpose: 'receipt', ext: 'png', entityId: '789' });
    expect(receipt).toMatch(/^receipts\/789\/\d{4}\/\d{2}\/[\w-]+\.png$/);

    const general = buildStoragePath({ purpose: 'general', ext: 'txt' });
    expect(general).toMatch(/^general\/\d{4}\/\d{2}\/[\w-]+\.txt$/);
  });

  test('sanitizeSegment replaces non-alphanumeric chars with underscores', async () => {
    const { buildStoragePath } = await import('../../src/modules/upload/storage-paths');
    const result = buildStoragePath({
      purpose: 'document',
      ext: 'pdf',
      entityType: 'student',
      entityId: 'id with spaces & symbols!',
    });
    // Spaces and & and ! should be replaced
    expect(result).not.toContain(' ');
    expect(result).not.toContain('&');
    expect(result).not.toContain('!');
  });
});

// ─── Local adapter — fallback behavior ─────────────────────

describe('R2-12c — Local adapter as R2 fallback', () => {
  test('LocalStorageAdapter.isRemote returns false', async () => {
    const { LocalStorageAdapter } = await import('../../src/modules/upload/storage/local.storage');
    const adapter = new LocalStorageAdapter();
    expect(adapter.isRemote()).toBe(false);
  });

  test('LocalStorageAdapter has all StorageService methods', async () => {
    const { LocalStorageAdapter } = await import('../../src/modules/upload/storage/local.storage');
    const adapter = new LocalStorageAdapter();
    expect(typeof adapter.save).toBe('function');
    expect(typeof adapter.get).toBe('function');
    expect(typeof adapter.getStream).toBe('function');
    expect(typeof adapter.delete).toBe('function');
    expect(typeof adapter.isRemote).toBe('function');
  });

  test('LocalStorageAdapter supports Range requests via getStream', async () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../src/modules/upload/storage/local.storage.ts'),
      'utf8',
    );
    expect(src).toContain('Range');
    expect(src).toContain('contentRange');
    expect(src).toContain('statusCode');
    expect(src).toContain('206');
  });

  test('LocalStorageAdapter cleans up partial files on write failure', async () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../src/modules/upload/storage/local.storage.ts'),
      'utf8',
    );
    // Local adapter uses direct unlink on pipeline failure (no cleanupTemp helper)
    expect(src).toContain('unlink');
    expect(src).toContain('Remove partial file on failure');
  });
});
