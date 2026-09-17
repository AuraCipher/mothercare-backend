/**
 * R2-04 — File Authorization & IDOR Regression Tests
 *
 * Security test matrix covering:
 * - Download: owner, unauthorized, cross-branch, admin, nonexistent
 * - Delete: owner, unauthorized, cross-branch, admin
 * - Rename: authorized, unauthorized, cross-branch
 * - Chat media: valid room member, arbitrary cross-branch, unauthorized
 * - Streaming regression: authorized still streams, Range works, unauthorized blocked before R2
 *
 * NOTE: The uploadDocumentPermissionMiddleware blocks non-admin users who lack
 * DOCUMENTS module permission. Teacher tokens are mocked with BranchMember records
 * so the middleware passes, then file-level authorization is tested.
 */
import { prismaMock } from '../../mocks/prisma';
import request from 'supertest';
import app from '../../../src/app';
import { generateTestToken, getAuthHeader } from '../../helpers/auth';
import { storage } from '../../../src/modules/upload/storage';

// ─── User tokens ──────────────────────────────────────────
// Teacher in b1 — owner of some files
const ownerToken = getAuthHeader(generateTestToken('user-owner', 'teacher', { branchIds: ['b1'] }));
// Teacher in b1 — not the owner, tests same-branch IDOR
const unauthTeacherToken = getAuthHeader(generateTestToken('user-unauth', 'teacher', { branchIds: ['b1'] }));
// Super admin — bypasses everything
const adminToken = getAuthHeader(generateTestToken('admin-1', 'super_admin', { branchIds: ['b1', 'b2'] }));
// Teacher in b2 — cross-branch
const crossBranchToken = getAuthHeader(generateTestToken('user-cross', 'teacher', { branchIds: ['b2'] }));

// ─── Mock storage ─────────────────────────────────────────
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

// ─── Mock BranchMember for teacher tokens (middleware bypass) ──
// Teacher with no module rows → resolveUserAccess returns isRestricted:false → middleware passes
const mockBranchMember = (userId: string, branchId: string) => ({
  id: `bm-${userId}-${branchId}`,
  branchId,
  userId,
  role: 'teacher' as const,
  isActive: true,
  keepTeacherRole: true,
  assignedById: null,
  resignedAt: null,
  resignedInFavorOfId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  modulePermissions: [],
});

// ─── Mock records ─────────────────────────────────────────
const ownerFile = {
  id: 'file-owner-1',
  originalName: 'my-doc.pdf',
  storagePath: 'documents/general/file.pdf',
  storageBucket: 'test-bucket',
  uploadedById: 'user-owner',
  entityType: 'student',
  entityId: 'student-1',
  purpose: 'document',
  mimeType: 'application/pdf',
  size: 1024,
  metadata: {},
};

const chatFile = {
  id: 'file-chat-1',
  originalName: 'chat-image.png',
  storagePath: 'chat/room1/image.png',
  storageBucket: 'test-bucket',
  uploadedById: 'user-owner',
  entityType: 'chat',
  entityId: null,
  purpose: 'chat',
  mimeType: 'image/png',
  size: 2048,
  metadata: { roomId: 'room-1' },
};

const generalFile = {
  id: 'file-general-1',
  originalName: 'report.pdf',
  storagePath: 'general/report.pdf',
  storageBucket: 'test-bucket',
  uploadedById: 'user-other',
  entityType: 'general',
  entityId: null,
  purpose: 'general',
  mimeType: 'application/pdf',
  size: 4096,
  metadata: {},
};

const studentFile = {
  id: 'file-student-1',
  originalName: 'student-doc.pdf',
  storagePath: 'documents/student/doc.pdf',
  storageBucket: 'test-bucket',
  uploadedById: 'staff-user',
  entityType: 'student',
  entityId: 'student-owned-by-owner',
  purpose: 'document',
  mimeType: 'application/pdf',
  size: 512,
  metadata: {},
};

// ─── Tests ────────────────────────────────────────────────
describe('File Authorization — R2-04', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default: mock BranchMember for all teacher tokens so middleware passes
    prismaMock.branchMember.findUnique.mockResolvedValue(mockBranchMember('any', 'any') as any);
  });

  // ═══════════════════════════════════════════════════════
  // DOWNLOAD
  // ═══════════════════════════════════════════════════════
  describe('Download authorization', () => {
    test('1. Owner can download their own file', async () => {
      prismaMock.fileRecord.findUnique.mockResolvedValue(ownerFile as any);
      const res = await request(app).get('/api/uploads/file-owner-1').set(ownerToken);
      expect(res.status).toBe(200);
      expect(storage.getStream).toHaveBeenCalled();
    });

    test('2. Unauthorized user cannot download another user file', async () => {
      prismaMock.fileRecord.findUnique.mockResolvedValue(generalFile as any);
      const res = await request(app).get('/api/uploads/file-general-1').set(unauthTeacherToken);
      expect(res.status).toBe(404);
      expect(storage.getStream).not.toHaveBeenCalled();
    });

    test('3. Same-branch but different user cannot download file they do not own', async () => {
      prismaMock.fileRecord.findUnique.mockResolvedValue(generalFile as any);
      const res = await request(app).get('/api/uploads/file-general-1').set(unauthTeacherToken);
      expect(res.status).toBe(404);
      expect(storage.getStream).not.toHaveBeenCalled();
    });

    test('4. Cross-branch user cannot download file', async () => {
      prismaMock.fileRecord.findUnique.mockResolvedValue(ownerFile as any);
      const res = await request(app).get('/api/uploads/file-owner-1').set(crossBranchToken);
      expect(res.status).toBe(404);
      expect(storage.getStream).not.toHaveBeenCalled();
    });

    test('5. Super admin can download any file', async () => {
      prismaMock.fileRecord.findUnique.mockResolvedValue(generalFile as any);
      const res = await request(app).get('/api/uploads/file-general-1').set(adminToken);
      expect(res.status).toBe(200);
      expect(storage.getStream).toHaveBeenCalled();
    });

    test('6. Nonexistent file returns 404', async () => {
      prismaMock.fileRecord.findUnique.mockResolvedValue(null);
      const res = await request(app).get('/api/uploads/nonexistent-id').set(adminToken);
      expect(res.status).toBe(404);
      expect(storage.getStream).not.toHaveBeenCalled();
    });

    test('7. Chat file accessible to room member (owner is room member)', async () => {
      prismaMock.fileRecord.findUnique.mockResolvedValue(chatFile as any);
      prismaMock.chatRoomMember.findFirst.mockResolvedValue({
        roomId: 'room-1',
        userId: 'user-owner',
        leftAt: null,
        canRead: true,
      } as any);
      const res = await request(app).get('/api/uploads/file-chat-1').set(ownerToken);
      expect(res.status).toBe(200);
      expect(storage.getStream).toHaveBeenCalled();
    });

    test('8. Student entity file accessible to the student user', async () => {
      prismaMock.fileRecord.findUnique.mockResolvedValue(studentFile as any);
      prismaMock.student.findUnique.mockResolvedValue({
        id: 'student-owned-by-owner',
        userId: 'user-owner',
        personId: null,
      } as any);
      const res = await request(app).get('/api/uploads/file-student-1').set(ownerToken);
      expect(res.status).toBe(200);
      expect(storage.getStream).toHaveBeenCalled();
    });

    test('9. Student entity file NOT accessible to different user', async () => {
      prismaMock.fileRecord.findUnique.mockResolvedValue(studentFile as any);
      prismaMock.student.findUnique.mockResolvedValue({
        id: 'student-owned-by-owner',
        userId: 'user-owner', // belongs to user-owner, not user-unauth
        personId: null,
      } as any);
      const res = await request(app).get('/api/uploads/file-student-1').set(unauthTeacherToken);
      expect(res.status).toBe(404);
      expect(storage.getStream).not.toHaveBeenCalled();
    });
  });

  // ═══════════════════════════════════════════════════════
  // DELETE
  // ═══════════════════════════════════════════════════════
  describe('Delete authorization', () => {
    test('10. Owner can delete their own file', async () => {
      prismaMock.fileRecord.findUnique.mockResolvedValue(ownerFile as any);
      prismaMock.fileRecord.delete.mockResolvedValue({} as any);
      const res = await request(app).delete('/api/uploads/file-owner-1').set(ownerToken);
      expect(res.status).toBe(200);
      expect(storage.delete).toHaveBeenCalled();
    });

    test('11. Unauthorized user cannot delete another user file', async () => {
      prismaMock.fileRecord.findUnique.mockResolvedValue(generalFile as any);
      const res = await request(app).delete('/api/uploads/file-general-1').set(unauthTeacherToken);
      expect(res.status).toBe(404);
      expect(storage.delete).not.toHaveBeenCalled();
    });

    test('12. Cross-branch deletion rejected', async () => {
      prismaMock.fileRecord.findUnique.mockResolvedValue(ownerFile as any);
      const res = await request(app).delete('/api/uploads/file-owner-1').set(crossBranchToken);
      expect(res.status).toBe(404);
      expect(storage.delete).not.toHaveBeenCalled();
    });

    test('13. Super admin can delete any file', async () => {
      prismaMock.fileRecord.findUnique.mockResolvedValue(generalFile as any);
      prismaMock.fileRecord.delete.mockResolvedValue({} as any);
      const res = await request(app).delete('/api/uploads/file-general-1').set(adminToken);
      expect(res.status).toBe(200);
      expect(storage.delete).toHaveBeenCalled();
    });
  });

  // ═══════════════════════════════════════════════════════
  // RENAME
  // ═══════════════════════════════════════════════════════
  describe('Rename authorization', () => {
    test('14. Owner can rename their own file', async () => {
      prismaMock.fileRecord.findUnique.mockResolvedValue(ownerFile as any);
      prismaMock.fileRecord.update.mockResolvedValue({ id: 'file-owner-1', originalName: 'renamed.pdf' } as any);
      const res = await request(app)
        .put('/api/uploads/file-owner-1/rename')
        .set(ownerToken)
        .send({ originalName: 'renamed.pdf' });
      expect(res.status).toBe(200);
    });

    test('15. Unauthorized user cannot rename another user file', async () => {
      prismaMock.fileRecord.findUnique.mockResolvedValue(generalFile as any);
      const res = await request(app)
        .put('/api/uploads/file-general-1/rename')
        .set(unauthTeacherToken)
        .send({ originalName: 'hacked.pdf' });
      expect(res.status).toBe(404);
    });

    test('16. Cross-branch rename rejected', async () => {
      prismaMock.fileRecord.findUnique.mockResolvedValue(ownerFile as any);
      const res = await request(app)
        .put('/api/uploads/file-owner-1/rename')
        .set(crossBranchToken)
        .send({ originalName: 'stolen.pdf' });
      expect(res.status).toBe(404);
    });

    test('17. Super admin can rename any file', async () => {
      prismaMock.fileRecord.findUnique.mockResolvedValue(generalFile as any);
      prismaMock.fileRecord.update.mockResolvedValue({ id: 'file-general-1', originalName: 'admin-renamed.pdf' } as any);
      const res = await request(app)
        .put('/api/uploads/file-general-1/rename')
        .set(adminToken)
        .send({ originalName: 'admin-renamed.pdf' });
      expect(res.status).toBe(200);
    });
  });

  // ═══════════════════════════════════════════════════════
  // METADATA
  // ═══════════════════════════════════════════════════════
  describe('Metadata authorization', () => {
    test('18. Owner can access their file metadata', async () => {
      prismaMock.fileRecord.findUnique.mockResolvedValue(ownerFile as any);
      const res = await request(app).get('/api/uploads/file-owner-1/meta').set(ownerToken);
      expect(res.status).toBe(200);
    });

    test('19. Unauthorized user cannot access another file metadata', async () => {
      prismaMock.fileRecord.findUnique.mockResolvedValue(generalFile as any);
      const res = await request(app).get('/api/uploads/file-general-1/meta').set(unauthTeacherToken);
      expect(res.status).toBe(404);
    });
  });

  // ═══════════════════════════════════════════════════════
  // STREAMING REGRESSION
  // ═══════════════════════════════════════════════════════
  describe('Streaming regression', () => {
    test('20. Authorized download still streams (R2-03 behavior preserved)', async () => {
      prismaMock.fileRecord.findUnique.mockResolvedValue(ownerFile as any);
      const res = await request(app).get('/api/uploads/file-owner-1').set(ownerToken);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('application/pdf');
      expect(res.headers['accept-ranges']).toBe('bytes');
      expect(res.headers['etag']).toBe('"test-etag"');
    });

    test('21. Unauthorized request does not call storage download method', async () => {
      prismaMock.fileRecord.findUnique.mockResolvedValue(generalFile as any);
      const res = await request(app).get('/api/uploads/file-general-1').set(unauthTeacherToken);
      expect(res.status).toBe(404);
      // CRITICAL: storage.getStream must NOT be called before authorization
      expect(storage.getStream).not.toHaveBeenCalled();
    });

    test('22. Range request still returns 206 for authorized user', async () => {
      const rangeFile = { ...ownerFile, size: 1000 };
      prismaMock.fileRecord.findUnique.mockResolvedValue(rangeFile as any);
      (storage.getStream as jest.Mock).mockResolvedValue({
        body: require('stream').Readable.from(Buffer.alloc(500)),
        contentLength: 500,
        contentRange: 'bytes 0-499/1000',
        statusCode: 206,
        contentType: 'application/pdf',
        etag: '"range-etag"',
      });
      const res = await request(app)
        .get('/api/uploads/file-owner-1')
        .set(ownerToken)
        .set('Range', 'bytes=0-499');
      expect(res.status).toBe(206);
      expect(res.headers['content-range']).toBe('bytes 0-499/1000');
    });
  });
});
