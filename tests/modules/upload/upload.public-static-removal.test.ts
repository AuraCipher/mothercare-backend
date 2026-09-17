/**
 * R2-05 — Public Static Upload Exposure & File Serving Hardening Tests
 *
 * Verifies that the legacy `express.static('/uploads')` route is removed
 * and that unauthenticated file access is no longer possible through that path.
 *
 * Tests cover:
 * 1. Unauthenticated /uploads/* is rejected (404, not served)
 * 2. Path traversal attempts are rejected
 * 3. Encoded traversal attempts are rejected
 * 4. Authenticated /api/uploads/:id still works (R2-03/R2-04 intact)
 * 5. Unauthorized user cannot access another user's file through /uploads/*
 * 6. Nonexistent legacy path behaves safely
 * 7. Existing R2-03 streaming behavior remains intact
 * 8. Existing R2-04 authorization behavior remains intact
 */
import { prismaMock } from '../../mocks/prisma';
import request from 'supertest';
import app from '../../../src/app';
import { generateTestToken, getAuthHeader } from '../../helpers/auth';
import { storage } from '../../../src/modules/upload/storage';

const adminToken = getAuthHeader(generateTestToken('admin-1', 'super_admin', { branchIds: ['b1'] }));

// Mock storage
jest.mock('../../../src/modules/upload/storage', () => {
  const actual = jest.requireActual('../../../src/modules/upload/storage');
  const { Readable } = require('stream');
  return {
    ...actual,
    storage: {
      save: jest.fn().mockResolvedValue('mocked/path'),
      get: jest.fn().mockResolvedValue(Buffer.from('file-content')),
      getStream: jest.fn().mockImplementation(() => Promise.resolve({
        body: Readable.from(Buffer.from('stream-content')),
        contentLength: 14,
        contentType: 'application/pdf',
        etag: '"test-etag"',
        lastModified: new Date('2026-01-01'),
      })),
      delete: jest.fn().mockResolvedValue(undefined),
    },
    getDefaultDocumentsBucket: jest.fn(() => 'test-bucket'),
  };
});

// Mock BranchMember for middleware
beforeEach(() => {
  jest.clearAllMocks();
  prismaMock.branchMember.findUnique.mockResolvedValue({
    id: 'bm-1',
    branchId: 'b1',
    userId: 'admin-1',
    role: 'branch_admin',
    isActive: true,
    keepTeacherRole: true,
    assignedById: null,
    resignedAt: null,
    resignedInFavorOfId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    modulePermissions: [],
  } as any);
});

const mockFile = {
  id: 'file-1',
  originalName: 'test.pdf',
  storagePath: 'documents/general/test.pdf',
  storageBucket: 'test-bucket',
  uploadedById: 'admin-1',
  entityType: 'general',
  entityId: null,
  purpose: 'document',
  mimeType: 'application/pdf',
  size: 1024,
  metadata: {},
};

describe('R2-05 — Public static /uploads/* removal', () => {
  // ═══════════════════════════════════════════════════════
  // 1. Unauthenticated /uploads/* is rejected
  // ═══════════════════════════════════════════════════════
  test('1. Unauthenticated GET /uploads/some-file.pdf returns 404 (route removed)', async () => {
    const res = await request(app).get('/uploads/some-file.pdf');
    expect(res.status).toBe(404);
  });

  // ═══════════════════════════════════════════════════════
  // 2. Path traversal attempt is rejected
  // ═══════════════════════════════════════════════════════
  test('2. Path traversal /uploads/../../etc/passwd returns 404', async () => {
    const res = await request(app).get('/uploads/../../etc/passwd');
    expect(res.status).toBe(404);
  });

  // ═══════════════════════════════════════════════════════
  // 3. Encoded traversal attempt is rejected
  // ═══════════════════════════════════════════════════════
  test('3. Encoded traversal /uploads/%2e%2e/%2e%2e/etc/passwd returns 404', async () => {
    const res = await request(app).get('/uploads/%2e%2e/%2e%2e/etc/passwd');
    expect(res.status).toBe(404);
  });

  // ═══════════════════════════════════════════════════════
  // 4. Authenticated /api/uploads/:id still works
  // ═══════════════════════════════════════════════════════
  test('4. Authenticated GET /api/uploads/:id still works (R2-03/R2-04 intact)', async () => {
    prismaMock.fileRecord.findUnique.mockResolvedValue(mockFile as any);
    const res = await request(app).get('/api/uploads/file-1').set(adminToken);
    expect(res.status).toBe(200);
    expect(storage.getStream).toHaveBeenCalled();
  });

  // ═══════════════════════════════════════════════════════
  // 5. /uploads/* with real-looking path still 404
  // ═══════════════════════════════════════════════════════
  test('5. GET /uploads/chat/room1/image.webp returns 404 (no bypass)', async () => {
    const res = await request(app).get('/uploads/chat/room1/image.webp');
    expect(res.status).toBe(404);
  });

  // ═══════════════════════════════════════════════════════
  // 6. Nonexistent legacy path behaves safely
  // ═══════════════════════════════════════════════════════
  test('6. GET /uploads/nonexistent/path/file.txt returns 404', async () => {
    const res = await request(app).get('/uploads/nonexistent/path/file.txt');
    expect(res.status).toBe(404);
  });

  // ═══════════════════════════════════════════════════════
  // 7. R2-03 streaming behavior intact
  // ═══════════════════════════════════════════════════════
  test('7. R2-03 streaming headers preserved on /api/uploads/:id', async () => {
    prismaMock.fileRecord.findUnique.mockResolvedValue(mockFile as any);
    const res = await request(app).get('/api/uploads/file-1').set(adminToken);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['accept-ranges']).toBe('bytes');
    expect(res.headers['etag']).toBe('"test-etag"');
  });

  // ═══════════════════════════════════════════════════════
  // 8. R2-04 authorization intact
  // ═══════════════════════════════════════════════════════
  test('8. Unauthorized user still gets 404 from /api/uploads/:id (R2-04 intact)', async () => {
    const unauthFile = { ...mockFile, uploadedById: 'other-user' };
    prismaMock.fileRecord.findUnique.mockResolvedValue(unauthFile as any);
    const unauthToken = getAuthHeader(generateTestToken('user-unauth', 'teacher', { branchIds: ['b1'] }));
    const res = await request(app).get('/api/uploads/file-1').set(unauthToken);
    expect(res.status).toBe(404);
    expect(storage.getStream).not.toHaveBeenCalled();
  });
});
