/**
 * R2-07 — R2 Object / FileRecord Consistency Tests
 *
 * Focused regression tests for:
 * - R2 success + DB failure compensation (Sequence A)
 * - Delete consistency with storage failure (Sequence C/D)
 * - Structured logging for inconsistency events
 * - Temp file cleanup across failure paths
 * - Idempotent delete when R2 object is already missing
 */

import { prismaMock } from '../../mocks/prisma';
import { UploadService, getMaxBytesForPurpose } from '../../../src/modules/upload/upload.service';
import { Readable } from 'stream';
import logger from '../../../src/lib/logger';

jest.mock('../../../src/modules/upload/media.pipeline', () => ({
  processUploadBuffer: jest.fn().mockResolvedValue({
    buffer: Buffer.from('test-data'),
    mimeType: 'application/pdf',
    ext: 'pdf',
    width: null,
    height: null,
  }),
  normalizePurpose: jest.fn((p?: string) => p || 'document'),
  ALLOWED_MIMES: new Set(['application/pdf', 'image/png', 'image/jpeg', 'video/mp4', 'audio/mp4']),
  EXT_MAP: { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', mp4: 'video/mp4' },
}));

jest.mock('../../../src/modules/upload/storage', () => ({
  getDefaultDocumentsBucket: jest.fn(() => 'test-bucket'),
  storage: {
    save: jest.fn().mockResolvedValue('test-key'),
    delete: jest.fn().mockResolvedValue(undefined),
    get: jest.fn(),
    getStream: jest.fn(),
  },
}));

jest.mock('../../../src/modules/upload/file-url.util', () => ({
  buildFileServeUrl: (id: string) => `/api/uploads/${id}`,
}));

jest.mock('../../../src/modules/upload/storage-paths', () => ({
  buildStoragePath: jest.fn(() => 'documents/test/2026/09/test-uuid.pdf'),
  UPLOAD_ENTITY_TYPES: ['student', 'teacher', 'staff', 'chat', 'general'],
}));

import { storage } from '../../../src/modules/upload/storage';
import { processUploadBuffer } from '../../../src/modules/upload/media.pipeline';

const mockStorage = storage as jest.Mocked<typeof storage>;
const mockPrismaCreate = prismaMock.fileRecord.create as jest.Mock;
const mockPrismaUpdate = prismaMock.fileRecord.update as jest.Mock;
const mockPrismaFindUnique = prismaMock.fileRecord.findUnique as jest.Mock;
const mockPrismaDelete = prismaMock.fileRecord.delete as jest.Mock;

describe('R2-07 — Upload Service Consistency', () => {
  const service = new UploadService();
  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    mockStorage.save.mockResolvedValue('test-key');
    mockStorage.delete.mockResolvedValue(undefined);
    mockPrismaCreate.mockResolvedValue({
      id: 'file-123',
      originalName: 'test.pdf',
      storagePath: 'documents/test/2026/09/test-uuid.pdf',
      storageBucket: 'test-bucket',
      purpose: 'document',
      mimeType: 'application/pdf',
      size: 9,
      publicUrl: null,
    });
    mockPrismaUpdate.mockResolvedValue({ id: 'file-123' });
    (processUploadBuffer as jest.Mock).mockResolvedValue({
      buffer: Buffer.from('test-data'),
      mimeType: 'application/pdf',
      ext: 'pdf',
      width: null,
      height: null,
    });
    warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => {});
    errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  describe('Sequence A — R2 success + DB failure attempts R2 cleanup', () => {
    test('uploadFile attempts storage cleanup when fileRecord.create fails', async () => {
      mockPrismaCreate.mockRejectedValueOnce(new Error('DB connection lost'));

      await expect(
        service.uploadFile(Buffer.from('test-data'), 'report.pdf', { purpose: 'document' }),
      ).rejects.toThrow();

      // Storage save was called (R2 upload succeeded)
      expect(mockStorage.save).toHaveBeenCalledTimes(1);
      // DB create was attempted
      expect(mockPrismaCreate).toHaveBeenCalledTimes(1);
      // Cleanup was attempted after DB failure
      expect(mockStorage.delete).toHaveBeenCalledTimes(1);
      expect(mockStorage.delete).toHaveBeenCalledWith(
        'documents/test/2026/09/test-uuid.pdf',
        { bucket: 'test-bucket' },
      );
    });

    test('uploadFileStreamed (passthrough path) attempts storage cleanup when create fails', async () => {
      mockPrismaCreate.mockRejectedValueOnce(new Error('unique constraint'));

      const tmpFile = '/tmp/mcs-r207-passthrough.pdf';
      const fs = require('fs');
      fs.writeFileSync(tmpFile, '%PDF-1.4 fake content for test');

      await expect(
        service.uploadFileStreamed({
          tempFilePath: tmpFile,
          originalName: 'doc.pdf',
          byteCount: 30,
          purpose: 'document',
        }),
      ).rejects.toThrow();

      expect(mockStorage.save).toHaveBeenCalledTimes(1);
      expect(mockStorage.delete).toHaveBeenCalledTimes(1);

      try { fs.unlinkSync(tmpFile); } catch {}
    });
  });

  describe('R2 cleanup failure is observable/logged', () => {
    test('logs error when storage cleanup fails after DB failure', async () => {
      mockPrismaCreate.mockRejectedValueOnce(new Error('DB error'));
      mockStorage.delete.mockRejectedValueOnce(new Error('R2 network error'));

      await expect(
        service.uploadFile(Buffer.from('test-data'), 'report.pdf', { purpose: 'document' }),
      ).rejects.toThrow();

      expect(mockStorage.save).toHaveBeenCalledTimes(1);
      expect(mockStorage.delete).toHaveBeenCalledTimes(1);

      const cleanupErrorLogs = errorSpy.mock.calls.filter(
        (call) => call[0] === 'storage:cleanup:failed',
      );
      expect(cleanupErrorLogs.length).toBe(1);
    });

    test('logs success when storage cleanup succeeds after DB failure', async () => {
      mockPrismaCreate.mockRejectedValueOnce(new Error('DB error'));
      mockStorage.delete.mockResolvedValueOnce(undefined);

      await expect(
        service.uploadFile(Buffer.from('test-data'), 'report.pdf', { purpose: 'document' }),
      ).rejects.toThrow();

      const cleanupSuccessLogs = warnSpy.mock.calls.filter(
        (call) => call[0] === 'storage:cleanup:success',
      );
      expect(cleanupSuccessLogs.length).toBe(1);
    });
  });

  describe('publicUrl update failure is logged', () => {
    test('logs error when publicUrl update fails after record created', async () => {
      mockPrismaUpdate.mockRejectedValueOnce(new Error('DB timeout'));

      await expect(
        service.uploadFile(Buffer.from('test-data'), 'report.pdf', { purpose: 'document' }),
      ).rejects.toThrow();

      // Record was created (no cleanup needed — record exists in DB)
      expect(mockPrismaCreate).toHaveBeenCalledTimes(1);
      // Storage delete should NOT be called (record exists, just publicUrl failed)
      expect(mockStorage.delete).not.toHaveBeenCalled();
      const publicUrlLogs = errorSpy.mock.calls.filter(
        (call) => call[0] === 'storage:upload:publicUrl-update-failed',
      );
      expect(publicUrlLogs.length).toBe(1);
    });
  });

  describe('Delete consistency', () => {
    const mockRecord = {
      id: 'file-del',
      originalName: 'old.pdf',
      storagePath: 'documents/test/2026/09/del-uuid.pdf',
      storageBucket: 'test-bucket',
      purpose: 'document',
      mimeType: 'application/pdf',
      size: 100,
      publicUrl: '/api/uploads/file-del',
    };

    test('deleteFile removes DB row even when storage delete fails', async () => {
      mockPrismaFindUnique.mockResolvedValue(mockRecord);
      mockStorage.delete.mockRejectedValueOnce(new Error('R2 timeout'));

      await service.deleteFile('file-del');

      expect(mockStorage.delete).toHaveBeenCalledTimes(1);
      expect(mockPrismaDelete).toHaveBeenCalledTimes(1);
      expect(mockPrismaDelete).toHaveBeenCalledWith({ where: { id: 'file-del' } });
    });

    test('deleteFile logs warning when storage delete fails', async () => {
      mockPrismaFindUnique.mockResolvedValue(mockRecord);
      mockStorage.delete.mockRejectedValueOnce(new Error('R2 timeout'));

      await service.deleteFile('file-del');

      const storageFailLogs = warnSpy.mock.calls.filter(
        (call) => call[0] === 'storage:delete:failed',
      );
      expect(storageFailLogs.length).toBe(1);
      expect(storageFailLogs[0][1]).toMatchObject({
        fileId: 'file-del',
        storagePath: mockRecord.storagePath,
        bucket: mockRecord.storageBucket,
      });
    });

    test('deleteFile logs orphan-possible when storage delete fails', async () => {
      mockPrismaFindUnique.mockResolvedValue(mockRecord);
      mockStorage.delete.mockRejectedValueOnce(new Error('R2 timeout'));

      await service.deleteFile('file-del');

      const orphanLogs = warnSpy.mock.calls.filter(
        (call) => call[0] === 'storage:delete:orphan-possible',
      );
      expect(orphanLogs.length).toBe(1);
    });

    test('deleteFile is idempotent when R2 object is already missing', async () => {
      mockPrismaFindUnique.mockResolvedValue(mockRecord);
      mockStorage.delete.mockRejectedValueOnce(new Error('NoSuchKey'));

      await service.deleteFile('file-del');

      // DB delete still succeeds
      expect(mockPrismaDelete).toHaveBeenCalledWith({ where: { id: 'file-del' } });
    });

    test('deleteFile succeeds cleanly when storage delete succeeds', async () => {
      mockPrismaFindUnique.mockResolvedValue(mockRecord);
      mockStorage.delete.mockResolvedValueOnce(undefined);

      await service.deleteFile('file-del');

      expect(mockPrismaDelete).toHaveBeenCalledWith({ where: { id: 'file-del' } });
      const orphanLogs = warnSpy.mock.calls.filter(
        (call) => call[0] === 'storage:delete:orphan-possible',
      );
      expect(orphanLogs.length).toBe(0);
    });

    test('deleteFile throws 404 when FileRecord not found', async () => {
      mockPrismaFindUnique.mockResolvedValue(null);

      await expect(service.deleteFile('nonexistent')).rejects.toMatchObject({
        status: 404,
        message: 'File not found',
      });
      expect(mockStorage.delete).not.toHaveBeenCalled();
      expect(mockPrismaDelete).not.toHaveBeenCalled();
    });
  });

  describe('Logging/observability — no secrets logged', () => {
    test('storage:delete:failed log does not contain credentials', async () => {
      mockPrismaFindUnique.mockResolvedValue({
        id: 'file-x',
        storagePath: 'documents/test/file.pdf',
        storageBucket: 'test-bucket',
      });
      mockStorage.delete.mockRejectedValueOnce(new Error('AccessDenied'));

      await service.deleteFile('file-x');

      const failedLogs = warnSpy.mock.calls.filter(
        (call) => call[0] === 'storage:delete:failed',
      );
      expect(failedLogs.length).toBe(1);
      const logMeta = failedLogs[0][1];
      expect(logMeta).not.toHaveProperty('accessKeyId');
      expect(logMeta).not.toHaveProperty('secretAccessKey');
      expect(logMeta).not.toHaveProperty('credentials');
      expect(logMeta).not.toHaveProperty('token');
      expect(logMeta).toHaveProperty('fileId');
      expect(logMeta).toHaveProperty('storagePath');
      expect(logMeta).toHaveProperty('bucket');
      expect(logMeta).toHaveProperty('error');
    });

    test('storage:cleanup:failed log does not contain credentials', async () => {
      mockPrismaCreate.mockRejectedValueOnce(new Error('DB error'));
      mockStorage.delete.mockRejectedValueOnce(new Error('R2 error'));

      await expect(
        service.uploadFile(Buffer.from('test'), 'f.pdf', { purpose: 'document' }),
      ).rejects.toThrow();

      const cleanupLogs = errorSpy.mock.calls.filter(
        (call) => call[0] === 'storage:cleanup:failed',
      );
      expect(cleanupLogs.length).toBe(1);
      const logMeta = cleanupLogs[0][1];
      expect(logMeta).not.toHaveProperty('accessKeyId');
      expect(logMeta).not.toHaveProperty('secretAccessKey');
      expect(logMeta).toHaveProperty('storagePath');
      expect(logMeta).toHaveProperty('operation');
    });
  });

  describe('getMaxBytesForPurpose — existing behavior preserved', () => {
    test('returns 5MB for voice_note', () => {
      expect(getMaxBytesForPurpose('voice_note')).toBe(5 * 1024 * 1024);
    });

    test('returns 1GB for video', () => {
      expect(getMaxBytesForPurpose('video')).toBe(1024 * 1024 * 1024);
    });

    test('returns 20MB for default', () => {
      expect(getMaxBytesForPurpose()).toBe(20 * 1024 * 1024);
    });

    test('returns 20MB for unknown purpose', () => {
      expect(getMaxBytesForPurpose('document')).toBe(20 * 1024 * 1024);
    });
  });
});
