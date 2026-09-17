/**
 * R2-06 — Uploaded File Active-Content Safety Tests
 *
 * Verifies that:
 * A) Dangerous MIME types are removed from ALLOWED_MIMES / EXT_MAP (upload-time)
 * B) Legacy dangerous-MIME files are served safely (serve-time)
 * C) Safe files are served with inline disposition
 * D) All response headers are correct
 *
 * Tests cover:
 * 1-4. SVG/HTML/JS/XML extensions produce safe MIME (octet-stream) via EXT_MAP
 * 5. Legacy dangerous files served with safe Content-Type + attachment
 * 6. nosniff header present
 * 7. Misleading extension produces safe MIME
 * 8. Unauthenticated access rejected
 * 9. Streaming headers intact
 * 10. Authorization intact
 * 11. Safe files served inline
 * 12. All 5 dangerous MIME types overridden on serve (parameterized)
 */
import { prismaMock } from '../../mocks/prisma';
import request from 'supertest';
import app from '../../../src/app';
import { generateTestToken, getAuthHeader } from '../../helpers/auth';
import { storage } from '../../../src/modules/upload/storage';
import { Readable } from 'stream';
import { ALLOWED_MIMES, EXT_MAP } from '../../../src/modules/upload/media.pipeline';

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

const DANGEROUS_MIMES = new Set([
  'text/html', 'application/xhtml+xml', 'image/svg+xml',
  'text/javascript', 'application/javascript',
  'application/xml', 'text/xml',
]);

describe('R2-06 — Active-content upload safety', () => {
  // ═══════════════════════════════════════════════════════
  // UPLOAD-TIME: ALLOWED_MIMES / EXT_MAP verification
  // ═══════════════════════════════════════════════════════

  test('1. image/svg+xml is NOT in ALLOWED_MIMES', () => {
    expect(ALLOWED_MIMES.has('image/svg+xml')).toBe(false);
  });

  test('2. text/html is NOT in ALLOWED_MIMES', () => {
    expect(ALLOWED_MIMES.has('text/html')).toBe(false);
  });

  test('3. text/javascript is NOT in ALLOWED_MIMES', () => {
    expect(ALLOWED_MIMES.has('text/javascript')).toBe(false);
  });

  test('4. application/xml is NOT in ALLOWED_MIMES', () => {
    expect(ALLOWED_MIMES.has('application/xml')).toBe(false);
  });

  test('4b. text/xml is NOT in ALLOWED_MIMES', () => {
    expect(ALLOWED_MIMES.has('text/xml')).toBe(false);
  });

  test('4c. application/typescript is NOT in ALLOWED_MIMES', () => {
    expect(ALLOWED_MIMES.has('application/typescript')).toBe(false);
  });

  test('5. svg extension is NOT in EXT_MAP', () => {
    expect(EXT_MAP['svg']).toBeUndefined();
  });

  test('6. html/htm extensions are NOT in EXT_MAP', () => {
    expect(EXT_MAP['html']).toBeUndefined();
    expect(EXT_MAP['htm']).toBeUndefined();
  });

  test('7. js/jsx extensions are NOT in EXT_MAP', () => {
    expect(EXT_MAP['js']).toBeUndefined();
    expect(EXT_MAP['jsx']).toBeUndefined();
  });

  test('8. xml extension is NOT in EXT_MAP', () => {
    expect(EXT_MAP['xml']).toBeUndefined();
  });

  test('9. ts/tsx extensions are NOT in EXT_MAP', () => {
    expect(EXT_MAP['ts']).toBeUndefined();
    expect(EXT_MAP['tsx']).toBeUndefined();
  });

  test('10. Safe MIME types are still in ALLOWED_MIMES', () => {
    expect(ALLOWED_MIMES.has('image/jpeg')).toBe(true);
    expect(ALLOWED_MIMES.has('image/png')).toBe(true);
    expect(ALLOWED_MIMES.has('image/webp')).toBe(true);
    expect(ALLOWED_MIMES.has('image/gif')).toBe(true);
    expect(ALLOWED_MIMES.has('application/pdf')).toBe(true);
    expect(ALLOWED_MIMES.has('video/mp4')).toBe(true);
    expect(ALLOWED_MIMES.has('audio/mpeg')).toBe(true);
  });

  // ═══════════════════════════════════════════════════════
  // SERVE-TIME: Dangerous MIME override
  // ═══════════════════════════════════════════════════════

  test('11. Legacy SVG file is served with safe Content-Type and attachment disposition', async () => {
    prismaMock.fileRecord.findUnique.mockResolvedValue({
      id: 'legacy-svg-1',
      originalName: 'malicious.svg',
      storagePath: 'documents/legacy/malicious.svg',
      storageBucket: 'test-bucket',
      uploadedById: 'admin-1',
      entityType: 'general',
      entityId: null,
      purpose: 'document',
      mimeType: 'image/svg+xml',
      size: 1024,
      metadata: {},
    } as any);

    const res = await request(app).get('/api/uploads/legacy-svg-1').set(adminToken);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/octet-stream');
    expect(res.headers['content-disposition']).toMatch(/^attachment;/);
  });

  test('12. Legacy HTML file is served with safe Content-Type and attachment disposition', async () => {
    prismaMock.fileRecord.findUnique.mockResolvedValue({
      id: 'legacy-html-1',
      originalName: 'evil.html',
      storagePath: 'documents/legacy/evil.html',
      storageBucket: 'test-bucket',
      uploadedById: 'admin-1',
      entityType: 'general',
      entityId: null,
      purpose: 'document',
      mimeType: 'text/html',
      size: 1024,
      metadata: {},
    } as any);

    const res = await request(app).get('/api/uploads/legacy-html-1').set(adminToken);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/octet-stream');
    expect(res.headers['content-disposition']).toMatch(/^attachment;/);
  });

  test('13. Legacy JS file is served with safe Content-Type and attachment disposition', async () => {
    prismaMock.fileRecord.findUnique.mockResolvedValue({
      id: 'legacy-js-1',
      originalName: 'payload.js',
      storagePath: 'documents/legacy/payload.js',
      storageBucket: 'test-bucket',
      uploadedById: 'admin-1',
      entityType: 'general',
      entityId: null,
      purpose: 'document',
      mimeType: 'text/javascript',
      size: 1024,
      metadata: {},
    } as any);

    const res = await request(app).get('/api/uploads/legacy-js-1').set(adminToken);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/octet-stream');
    expect(res.headers['content-disposition']).toMatch(/^attachment;/);
  });

  test('14. Legacy XML file is served with safe Content-Type and attachment disposition', async () => {
    prismaMock.fileRecord.findUnique.mockResolvedValue({
      id: 'legacy-xml-1',
      originalName: 'data.xml',
      storagePath: 'documents/legacy/data.xml',
      storageBucket: 'test-bucket',
      uploadedById: 'admin-1',
      entityType: 'general',
      entityId: null,
      purpose: 'document',
      mimeType: 'application/xml',
      size: 1024,
      metadata: {},
    } as any);

    const res = await request(app).get('/api/uploads/legacy-xml-1').set(adminToken);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/octet-stream');
    expect(res.headers['content-disposition']).toMatch(/^attachment;/);
  });

  // ═══════════════════════════════════════════════════════
  // SERVE-TIME: Headers
  // ═══════════════════════════════════════════════════════

  test('15. X-Content-Type-Options: nosniff is present on file responses', async () => {
    prismaMock.fileRecord.findUnique.mockResolvedValue({
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
    } as any);

    const res = await request(app).get('/api/uploads/file-1').set(adminToken);
    expect(res.status).toBe(200);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  test('16. Safe file is served with inline Content-Disposition', async () => {
    prismaMock.fileRecord.findUnique.mockResolvedValue({
      id: 'file-safe-1',
      originalName: 'photo.webp',
      storagePath: 'documents/general/photo.webp',
      storageBucket: 'test-bucket',
      uploadedById: 'admin-1',
      entityType: 'general',
      entityId: null,
      purpose: 'document',
      mimeType: 'image/webp',
      size: 1024,
      metadata: {},
    } as any);

    const res = await request(app).get('/api/uploads/file-safe-1').set(adminToken);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/webp');
    expect(res.headers['content-disposition']).toMatch(/^inline;/);
  });

  // ═══════════════════════════════════════════════════════
  // SERVE-TIME: Parameterized all dangerous MIME types
  // ═══════════════════════════════════════════════════════

  test.each([
    ['text/html', 'evil.html'],
    ['image/svg+xml', 'malicious.svg'],
    ['text/javascript', 'payload.js'],
    ['application/xml', 'data.xml'],
    ['text/xml', 'feed.xml'],
  ])('17. Legacy %s is served safely as application/octet-stream with attachment', async (mimeType, filename) => {
    const safeId = `legacy-${mimeType.replace(/[/\.]/g, '-')}`;
    prismaMock.fileRecord.findUnique.mockResolvedValue({
      id: safeId,
      originalName: filename,
      storagePath: `documents/legacy/${filename}`,
      storageBucket: 'test-bucket',
      uploadedById: 'admin-1',
      entityType: 'general',
      entityId: null,
      purpose: 'document',
      mimeType,
      size: 1024,
      metadata: {},
    } as any);

    const res = await request(app).get(`/api/uploads/${safeId}`).set(adminToken);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/octet-stream');
    expect(res.headers['content-disposition']).toMatch(/^attachment;/);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  // ═══════════════════════════════════════════════════════
  // Existing behavior preserved
  // ═══════════════════════════════════════════════════════

  test('18. Unauthenticated GET /api/uploads/:id returns 401/403', async () => {
    const res = await request(app).get('/api/uploads/file-1');
    expect([401, 403]).toContain(res.status);
  });

  test('19. R2-03 streaming headers preserved on safe file response', async () => {
    prismaMock.fileRecord.findUnique.mockResolvedValue({
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
    } as any);

    const res = await request(app).get('/api/uploads/file-1').set(adminToken);
    expect(res.status).toBe(200);
    expect(res.headers['accept-ranges']).toBe('bytes');
    expect(res.headers['etag']).toBe('"test-etag"');
    expect(res.headers['content-type']).toBe('application/pdf');
  });

  test('20. Unauthorized user gets 404 before storage access (R2-04 intact)', async () => {
    prismaMock.fileRecord.findUnique.mockResolvedValue({
      id: 'file-other',
      originalName: 'secret.pdf',
      storagePath: 'documents/other/secret.pdf',
      storageBucket: 'test-bucket',
      uploadedById: 'other-user',
      entityType: 'general',
      entityId: null,
      purpose: 'document',
      mimeType: 'application/pdf',
      size: 1024,
      metadata: {},
    } as any);

    const unauthToken = getAuthHeader(generateTestToken('user-unauth', 'teacher', { branchIds: ['b1'] }));
    const res = await request(app).get('/api/uploads/file-other').set(unauthToken);
    expect(res.status).toBe(404);
    expect(storage.getStream).not.toHaveBeenCalled();
  });
});
