/**
 * Admin Routes Integration Tests — Phase 02: Branch + Academic Year System
 *
 * Tests CRUD endpoints for Branches, AcademicCalendars, AcademicYears,
 * memberships, and the /me/academic-year endpoint.
 * Uses supertest against the real Express app with mocked Prisma.
 */

// Mock bcryptjs BEFORE any source imports
jest.mock('bcryptjs', () => ({
  hash: jest.fn().mockResolvedValue('$2a$12$mocked_hash_for_testing'),
  compare: jest.fn().mockResolvedValue(true),
}));

import { prismaMock } from '../../mocks/prisma';
import request from 'supertest';
import app from '../../../src/app';
import {
  createMockUser,
  createMockGroup,
  createMockStudent,
  createMockBranch,
  createMockAcademicCalendar,
  createMockAcademicYear,
  createMockAcademicYearMember,
  createMockBranchMember,
} from '../../helpers/factories';
import type {
  MockUser,
  MockGroup,
  MockStudent,
  MockBranch,
  MockAcademicCalendar,
  MockAcademicYear,
  MockAcademicYearMember,
  MockBranchMember,
} from '../../helpers/factories';
import { generateTestToken, getAuthHeader } from '../../helpers/auth';

// Mock helpers for upload testing (typed as any — exports exist at runtime via moduleNameMapper)
const fileTypeMock = require('file-type') as any;
const multerMock = require('multer') as any;
const sharpMock = require('sharp') as any;

// ─── Shared auth tokens ─────────────────────────────────────

const adminToken = getAuthHeader(generateTestToken('admin-1', 'super_admin'));
const managementToken = getAuthHeader(generateTestToken('mgmt-1', 'management'));
const teacherToken = getAuthHeader(generateTestToken('teacher-1', 'teacher'));
const parentToken = getAuthHeader(generateTestToken('parent-1', 'parent'));

// ═══════════════════════════════════════════════════════════════════
// AUTH ENFORCEMENT (BA-024, BA-025)
// ═══════════════════════════════════════════════════════════════════

describe('Phase 02 — Auth enforcement', () => {
  beforeEach(() => jest.clearAllMocks());

  // BA-024: 401 without token
  test('POST /admin/branches returns 401 without token', async () => {
    const res = await request(app).post('/admin/branches').send({ name: 'Test', code: 'TST' });
    expect(res.status).toBe(401);
  });

  test('GET /admin/branches returns 401 without token', async () => {
    const res = await request(app).get('/admin/branches');
    expect(res.status).toBe(401);
  });

  test('POST /admin/calendars returns 401 without token', async () => {
    const res = await request(app).post('/admin/calendars').send({ label: 'Test' });
    expect(res.status).toBe(401);
  });

  test('POST /admin/branches/:id/academic-years returns 401 without token', async () => {
    const res = await request(app).post('/admin/branches/b-1/academic-years').send({ calendarId: 'c-1' });
    expect(res.status).toBe(401);
  });

  test('GET /me/academic-year returns 401 without token', async () => {
    const res = await request(app).get('/me/academic-year');
    expect(res.status).toBe(401);
  });

  // BA-025: 403 with parent role
  test('POST /admin/branches returns 403 with parent token', async () => {
    const res = await request(app).post('/admin/branches').set(parentToken).send({ name: 'Test', code: 'TST' });
    expect(res.status).toBe(403);
    expect(res.body.message).toContain('Access denied');
  });

  test('GET /admin/branches returns 403 with parent token', async () => {
    const res = await request(app).get('/admin/branches').set(parentToken);
    expect(res.status).toBe(403);
  });

  // Teacher role also should be blocked (only super_admin + management)
  test('POST /admin/branches returns 403 with teacher token', async () => {
    const res = await request(app).post('/admin/branches').set(teacherToken).send({ name: 'Test', code: 'TST' });
    expect(res.status).toBe(403);
  });

  // Management role should be allowed
  test('GET /admin/branches returns 200 with management token', async () => {
    prismaMock.branch.findMany.mockResolvedValue([]);
    const res = await request(app).get('/admin/branches').set(managementToken);
    expect(res.status).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════════════
// BRANCH CRUD (BA-002 through BA-006)
// ═══════════════════════════════════════════════════════════════════

describe('Phase 02 — Branch CRUD', () => {
  let mockBranch: MockBranch;

  beforeEach(() => {
    jest.clearAllMocks();
    mockBranch = createMockBranch();
    mockBranch = createMockBranch();
  });

  describe('POST /admin/branches — Create branch (BA-002)', () => {
    test('creates a branch with valid data', async () => {
      prismaMock.branch.findFirst.mockResolvedValue(null);
      prismaMock.branch.create.mockResolvedValue(mockBranch as any);

      const res = await request(app)
        .post('/admin/branches')
        .set(adminToken)
        .send({ name: 'Test Branch', code: 'TST' });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(mockBranch.id);
      expect(res.body.data.name).toBe(mockBranch.name);
    });

    test('returns 400 when name is missing', async () => {
      const res = await request(app)
        .post('/admin/branches')
        .set(adminToken)
        .send({ code: 'TST' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    test('returns 400 when code is missing', async () => {
      const res = await request(app)
        .post('/admin/branches')
        .set(adminToken)
        .send({ name: 'Test Branch' });

      expect(res.status).toBe(400);
    });

    test('returns 409 when name already exists', async () => {
      prismaMock.branch.findFirst.mockResolvedValue(mockBranch as any);

      const res = await request(app)
        .post('/admin/branches')
        .set(adminToken)
        .send({ name: mockBranch.name, code: 'TST' });

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
    });

    test('uppercases the code', async () => {
      prismaMock.branch.findFirst.mockResolvedValue(null);
      prismaMock.branch.create.mockResolvedValue(mockBranch as any);

      await request(app)
        .post('/admin/branches')
        .set(adminToken)
        .send({ name: 'Test', code: 'tst' });

      expect(prismaMock.branch.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ code: 'TST' }),
        }),
      );
    });
  });

  describe('GET /admin/branches — List branches (BA-003)', () => {
    test('returns list of active branches sorted by name', async () => {
      const branches = [createMockBranch({ name: 'Alpha' }), createMockBranch({ name: 'Beta' })];
      prismaMock.branch.findMany.mockResolvedValue(branches as any);

      const res = await request(app).get('/admin/branches').set(adminToken);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(2);
      expect(prismaMock.branch.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { isActive: true },
          orderBy: { name: 'asc' },
        }),
      );
    });

    test('returns empty array when no branches', async () => {
      prismaMock.branch.findMany.mockResolvedValue([]);
      const res = await request(app).get('/admin/branches').set(adminToken);
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
    });
  });

  describe('GET /admin/branches/:id — Get branch (BA-004)', () => {
    test('returns branch with AY count', async () => {
      const branchDetail = {
        ...mockBranch,
        _count: { academicYears: 2, branchMembers: 5 },
        academicYears: [{ id: 'ay-1', status: 'ACTIVE' }],
      };
      prismaMock.branch.findUnique.mockResolvedValue(branchDetail as any);

      const res = await request(app).get(`/admin/branches/${mockBranch.id}`).set(adminToken);

      expect(res.status).toBe(200);
      expect(res.body.data._count.academicYears).toBe(2);
      expect(res.body.data.academicYears).toHaveLength(1);
    });

    test('returns 404 when branch not found', async () => {
      prismaMock.branch.findUnique.mockResolvedValue(null);
      const res = await request(app).get('/admin/branches/non-existent').set(adminToken);
      expect(res.status).toBe(404);
    });
  });

  describe('PUT /admin/branches/:id — Update branch (BA-005)', () => {
    test('updates branch name', async () => {
      prismaMock.branch.findUnique.mockResolvedValue(mockBranch as any);
      prismaMock.branch.findFirst.mockResolvedValue(null);
      const updated = { ...mockBranch, name: 'Updated Name' };
      prismaMock.branch.update.mockResolvedValue(updated as any);

      const res = await request(app)
        .put(`/admin/branches/${mockBranch.id}`)
        .set(adminToken)
        .send({ name: 'Updated Name' });

      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe('Updated Name');
    });

    test('returns 400 on empty name', async () => {
      const res = await request(app)
        .put(`/admin/branches/${mockBranch.id}`)
        .set(adminToken)
        .send({ name: '' });

      expect(res.status).toBe(400);
    });

    test('returns 404 when branch missing', async () => {
      prismaMock.branch.findUnique.mockResolvedValue(null);
      const res = await request(app)
        .put('/admin/branches/non-existent')
        .set(adminToken)
        .send({ name: 'New Name' });

      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /admin/branches/:id — Deactivate branch (BA-006)', () => {
    test('archives a branch that has linked data', async () => {
      const branchWithData = {
        ...mockBranch,
        _count: { academicYears: 2, branchMembers: 5 },
      };
      prismaMock.branch.findUnique.mockResolvedValue(branchWithData as any);
      prismaMock.academicYear.findFirst
        .mockResolvedValueOnce(null) // no ACTIVE
        .mockResolvedValueOnce(null); // no BUILD_STAGE
      prismaMock.branch.update.mockResolvedValue({ ...mockBranch, isActive: false } as any);

      const res = await request(app).delete(`/admin/branches/${mockBranch.id}`).set(adminToken);

      expect(res.status).toBe(200);
      expect(res.body.data.action).toBe('archived');
    });

    test('hard-deletes an empty branch', async () => {
      const emptyBranch = {
        ...mockBranch,
        _count: { academicYears: 0, branchMembers: 0 },
      };
      prismaMock.branch.findUnique.mockResolvedValue(emptyBranch as any);
      prismaMock.academicYear.findFirst
        .mockResolvedValueOnce(null) // no ACTIVE
        .mockResolvedValueOnce(null); // no BUILD_STAGE
      prismaMock.branch.delete.mockResolvedValue(emptyBranch as any);

      const res = await request(app).delete(`/admin/branches/${mockBranch.id}`).set(adminToken);

      expect(res.status).toBe(200);
      expect(res.body.data.action).toBe('deleted');
    });

    test('returns 409 if branch has ACTIVE academic year', async () => {
      const branchWithData = { ...mockBranch, _count: { academicYears: 0, branchMembers: 0 } };
      prismaMock.branch.findUnique.mockResolvedValue(branchWithData as any);
      prismaMock.academicYear.findFirst.mockResolvedValue({ id: 'ay-1', status: 'ACTIVE' } as any);

      const res = await request(app).delete(`/admin/branches/${mockBranch.id}`).set(adminToken);

      expect(res.status).toBe(409);
      expect(res.body.message).toContain('active academic year');
    });

    test('returns 404 when branch not found', async () => {
      prismaMock.branch.findUnique.mockResolvedValue(null);
      const res = await request(app).delete('/admin/branches/non-existent').set(adminToken);
      expect(res.status).toBe(404);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// ACADEMIC CALENDAR CRUD (BA-007, BA-008)
// ═══════════════════════════════════════════════════════════════════

describe('Phase 02 — AcademicCalendar CRUD', () => {
  let mockBranch: MockBranch;
  let mockCalendar: MockAcademicCalendar;

  beforeEach(() => {
    jest.clearAllMocks();
    mockBranch = createMockBranch();
    mockCalendar = createMockAcademicCalendar();
  });

  describe('POST /admin/calendars — Create calendar', () => {
    test('creates a calendar with valid data', async () => {
      prismaMock.academicCalendar.findUnique.mockResolvedValue(null);
      prismaMock.academicCalendar.updateMany.mockResolvedValue({ count: 0 });
      prismaMock.academicCalendar.create.mockResolvedValue(mockCalendar as any);

      const res = await request(app)
        .post('/admin/calendars')
        .set(adminToken)
        .send({
          label: '2025-2026',
          startDate: '2025-08-01',
          endDate: '2026-06-30',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(mockCalendar.id);
    });

    test('returns 400 when label is missing', async () => {
      const res = await request(app)
        .post('/admin/calendars')
        .set(adminToken)
        .send({ startDate: '2025-08-01', endDate: '2026-06-30' });

      expect(res.status).toBe(400);
    });

    test('returns 409 when label already exists', async () => {
      prismaMock.academicCalendar.findUnique.mockResolvedValue(mockCalendar as any);

      const res = await request(app)
        .post('/admin/calendars')
        .set(adminToken)
        .send({
          label: mockCalendar.label,
          startDate: '2025-08-01',
          endDate: '2026-06-30',
        });

      expect(res.status).toBe(409);
    });

    test('unsets other calendars when isCurrent=true', async () => {
      prismaMock.academicCalendar.findUnique.mockResolvedValue(null);
      prismaMock.academicCalendar.updateMany.mockResolvedValue({ count: 1 });
      prismaMock.academicCalendar.create.mockResolvedValue({ ...mockCalendar, isCurrent: true } as any);

      await request(app)
        .post('/admin/calendars')
        .set(adminToken)
        .send({
          label: '2025-2026',
          startDate: '2025-08-01',
          endDate: '2026-06-30',
          isCurrent: true,
        });

      expect(prismaMock.academicCalendar.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { isCurrent: true } }),
      );
    });
  });

  describe('GET /admin/calendars — List calendars', () => {
    test('returns calendars ordered by startDate desc', async () => {
      prismaMock.academicCalendar.findMany.mockResolvedValue([mockCalendar] as any);

      const res = await request(app).get('/admin/calendars').set(adminToken);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(prismaMock.academicCalendar.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { startDate: 'desc' } }),
      );
    });
  });

  describe('PATCH /admin/calendars/:id/set-current — Set current calendar', () => {
    test('unsets others and sets this one', async () => {
      prismaMock.academicCalendar.findUnique.mockResolvedValue(mockCalendar as any);
      prismaMock.academicCalendar.updateMany.mockResolvedValue({ count: 1 });
      prismaMock.academicCalendar.update.mockResolvedValue({ ...mockCalendar, isCurrent: true } as any);

      const res = await request(app)
        .patch(`/admin/calendars/${mockCalendar.id}/set-current`)
        .set(adminToken);

      expect(res.status).toBe(200);
      expect(prismaMock.academicCalendar.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { isCurrent: true } }),
      );
      expect(prismaMock.academicCalendar.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: mockCalendar.id }, data: { isCurrent: true } }),
      );
    });

    test('returns 404 when calendar not found', async () => {
      prismaMock.academicCalendar.findUnique.mockResolvedValue(null);
      const res = await request(app).patch('/admin/calendars/non-existent/set-current').set(adminToken);
      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /admin/calendars/:id — Delete calendar', () => {
    test('deletes calendar with no linked years', async () => {
      prismaMock.academicCalendar.findUnique.mockResolvedValue({
        ...mockCalendar,
        _count: { academicYears: 0 },
      } as any);
      prismaMock.academicCalendar.delete.mockResolvedValue(mockCalendar as any);

      const res = await request(app).delete(`/admin/calendars/${mockCalendar.id}`).set(adminToken);
      expect(res.status).toBe(204);
    });

    test('returns 409 when calendar has linked academic years', async () => {
      prismaMock.academicCalendar.findUnique.mockResolvedValue({
        ...mockCalendar,
        _count: { academicYears: 3 },
      } as any);

      const res = await request(app).delete(`/admin/calendars/${mockCalendar.id}`).set(adminToken);
      expect(res.status).toBe(409);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// ACADEMIC YEAR CRUD (BA-009 through BA-020)
// ═══════════════════════════════════════════════════════════════════

describe('Phase 02 — AcademicYear CRUD', () => {
  let mockBranch: MockBranch;
  let mockCalendar: MockAcademicCalendar;
  let mockAcademicYear: MockAcademicYear;

  beforeEach(() => {
    jest.clearAllMocks();
    mockBranch = createMockBranch();
    mockBranch = createMockBranch();
    mockCalendar = createMockAcademicCalendar({ isCurrent: true });
    mockAcademicYear = createMockAcademicYear({
      branchId: mockBranch.id,
      calendarId: mockCalendar.id,
    });
  });

  describe('POST /admin/branches/:branchId/academic-years — Create AY (BA-015, BA-009)', () => {
    test('creates a BUILD_STAGE academic year', async () => {
      prismaMock.branch.findUnique.mockResolvedValue(mockBranch as any);
      prismaMock.academicCalendar.findUnique.mockResolvedValue(mockCalendar as any);
      prismaMock.academicYear.findFirst
        .mockResolvedValueOnce(null) // no existing
        .mockResolvedValueOnce(null); // no existing BUILD_STAGE
      prismaMock.academicYear.create.mockResolvedValue(mockAcademicYear as any);

      const res = await request(app)
        .post(`/admin/branches/${mockBranch.id}/academic-years`)
        .set(adminToken)
        .send({ calendarId: mockCalendar.id });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(prismaMock.academicYear.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            branchId: mockBranch.id,
            calendarId: mockCalendar.id,
            status: 'BUILD_STAGE',
          }),
        }),
      );
    });

    test('returns 404 when branch does not exist', async () => {
      prismaMock.branch.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .post('/admin/branches/non-existent/academic-years')
        .set(adminToken)
        .send({ calendarId: mockCalendar.id });

      expect(res.status).toBe(404);
    });

    test('returns 409 when duplicate (same branch+calendar)', async () => {
      prismaMock.branch.findUnique.mockResolvedValue(mockBranch as any);
      prismaMock.academicCalendar.findUnique.mockResolvedValue(mockCalendar as any);
      prismaMock.academicYear.findFirst.mockResolvedValue(mockAcademicYear as any); // exists

      const res = await request(app)
        .post(`/admin/branches/${mockBranch.id}/academic-years`)
        .set(adminToken)
        .send({ calendarId: mockCalendar.id });

      expect(res.status).toBe(409);
    });

    test('returns 409 if another BUILD_STAGE exists for this branch', async () => {
      prismaMock.branch.findUnique.mockResolvedValue(mockBranch as any);
      prismaMock.academicCalendar.findUnique.mockResolvedValue(mockCalendar as any);
      prismaMock.academicYear.findFirst
        .mockResolvedValueOnce(null) // no duplicate
        .mockResolvedValueOnce({ id: 'existing-build', status: 'BUILD_STAGE' } as any); // has BUILD_STAGE

      const res = await request(app)
        .post(`/admin/branches/${mockBranch.id}/academic-years`)
        .set(adminToken)
        .send({ calendarId: mockCalendar.id });

      expect(res.status).toBe(409);
      expect(res.body.message).toContain('BUILD_STAGE');
    });
  });

  describe('POST with directToArchived flag', () => {
    test('creates as BUILD_STAGE and bypasses existing BUILD_STAGE check when directToArchived=true', async () => {
      prismaMock.branch.findUnique.mockResolvedValue(mockBranch as any);
      prismaMock.academicCalendar.findUnique.mockResolvedValue(mockCalendar as any);
      // Simulate existing BUILD_STAGE
      prismaMock.academicYear.findFirst
        .mockResolvedValueOnce(null) // no duplicate AY
        .mockResolvedValueOnce({ id: 'existing-build' } as any); // existing BUILD_STAGE
      prismaMock.academicYear.create.mockResolvedValue(mockAcademicYear as any);

      const res = await request(app)
        .post(`/admin/branches/${mockBranch.id}/academic-years`)
        .set(adminToken)
        .send({ calendarId: mockCalendar.id, directToArchived: true });

      expect(res.status).toBe(201);
      // Should have bypassed the BUILD_STAGE uniqueness check (would have thrown 409 otherwise)
      expect(prismaMock.academicYear.create).toHaveBeenCalled();
    });
  });

  describe('GET /admin/branches/:branchId/academic-years — List AYs (BA-016)', () => {
    test('returns academic years for a branch', async () => {
      prismaMock.academicYear.findMany.mockResolvedValue([mockAcademicYear] as any);

      const res = await request(app)
        .get(`/admin/branches/${mockBranch.id}/academic-years`)
        .set(adminToken);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(prismaMock.academicYear.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ branchId: mockBranch.id }),
        }),
      );
    });

    test('filters by status', async () => {
      prismaMock.academicYear.findMany.mockResolvedValue([]);

      await request(app)
        .get(`/admin/branches/${mockBranch.id}/academic-years?status=ACTIVE`)
        .set(adminToken);

      expect(prismaMock.academicYear.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ branchId: mockBranch.id, status: 'ACTIVE' }),
        }),
      );
    });
  });

  describe('GET /admin/academic-years/:id — Full detail (BA-017)', () => {
    test('returns AY with groups and counts', async () => {
      const ayDetail = {
        ...mockAcademicYear,
        branch: { id: mockBranch.id, name: mockBranch.name, code: mockBranch.code },
        calendar: { id: mockCalendar.id, label: mockCalendar.label },
        groups: [{ id: 'g-1', name: 'Playgroup', _count: { members: 5, students: 15 } }],
        _count: { groups: 1, students: 15, members: 3, subjects: 5 },
      };
      prismaMock.academicYear.findUnique.mockResolvedValue(ayDetail as any);

      const res = await request(app)
        .get(`/admin/branches/${mockBranch.id}/academic-years/${mockAcademicYear.id}`)
        .set(adminToken);

      expect(res.status).toBe(200);
      expect(res.body.data._count.groups).toBe(1);
      expect(res.body.data.groups).toHaveLength(1);
      expect(res.body.data.branch.name).toBe(mockBranch.name);
    });

    test('returns 404 when not found', async () => {
      prismaMock.academicYear.findUnique.mockResolvedValue(null);
      const res = await request(app).get(`/admin/branches/${mockBranch.id}/academic-years/non-existent`).set(adminToken);
      expect(res.status).toBe(404);
    });
  });

  describe('PATCH /admin/academic-years/:id/publish — Publish AY (BA-019, BA-013)', () => {
    test('publishes BUILD_STAGE → ACTIVE', async () => {
      prismaMock.academicYear.findUnique.mockReset();
      prismaMock.academicYear.findFirst.mockReset();
      prismaMock.academicYear.update.mockReset();
      prismaMock.academicYear.findUnique.mockResolvedValue({
        ...mockAcademicYear,
        branch: { id: mockBranch.id, name: mockBranch.name },
      } as any);
      prismaMock.academicYear.findFirst.mockResolvedValue(null); // no other ACTIVE
      prismaMock.academicYear.update.mockResolvedValue({
        ...mockAcademicYear,
        status: 'ACTIVE',
      } as any);

      const res = await request(app)
        .patch(`/admin/branches/${mockBranch.id}/academic-years/${mockAcademicYear.id}/publish`)
        .set(adminToken);

      expect(res.status).toBe(200);
      expect(prismaMock.academicYear.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: mockAcademicYear.id }, data: { status: 'ACTIVE' } }),
      );
    });

    test('returns 409 if branch already has ACTIVE year', async () => {
      prismaMock.academicYear.findUnique.mockResolvedValue({
        ...mockAcademicYear,
        branch: { id: mockBranch.id, name: mockBranch.name },
      } as any);
      prismaMock.academicYear.findFirst.mockResolvedValue({ id: 'other-active' } as any);

      const res = await request(app)
        .patch(`/admin/branches/${mockBranch.id}/academic-years/${mockAcademicYear.id}/publish`)
        .set(adminToken);

      expect(res.status).toBe(409);
      expect(res.body.message).toContain('ACTIVE');
    });

    test('returns 400 when publishing ARCHIVED year', async () => {
      prismaMock.academicYear.findUnique.mockResolvedValue({
        ...mockAcademicYear,
        status: 'ARCHIVED',
        branch: { id: mockBranch.id, name: mockBranch.name },
      } as any);

      const res = await request(app)
        .patch(`/admin/branches/${mockBranch.id}/academic-years/${mockAcademicYear.id}/publish`)
        .set(adminToken);

      expect(res.status).toBe(400);
      expect(prismaMock.academicYear.update).not.toHaveBeenCalled();
    });
  });

  describe('PATCH /admin/academic-years/:id/pause — Pause AY', () => {
    test('pauses ACTIVE → ON_HOLD', async () => {
      prismaMock.academicYear.findUnique.mockResolvedValue({
        ...mockAcademicYear,
        status: 'ACTIVE',
      } as any);
      prismaMock.academicYear.update.mockResolvedValue({
        ...mockAcademicYear,
        status: 'ON_HOLD',
      } as any);

      const res = await request(app)
        .patch(`/admin/branches/${mockBranch.id}/academic-years/${mockAcademicYear.id}/pause`)
        .set(adminToken);

      expect(res.status).toBe(200);
      expect(prismaMock.academicYear.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: mockAcademicYear.id }, data: { status: 'ON_HOLD' } }),
      );
    });

    test('returns 400 when pausing non-ACTIVE year', async () => {
      prismaMock.academicYear.findUnique.mockResolvedValue({
        ...mockAcademicYear,
        status: 'BUILD_STAGE',
      } as any);

      const res = await request(app)
        .patch(`/admin/branches/${mockBranch.id}/academic-years/${mockAcademicYear.id}/pause`)
        .set(adminToken);

      expect(res.status).toBe(400);
    });
  });

  describe('PATCH /admin/academic-years/:id/resume — Resume AY', () => {
    test('resumes ON_HOLD → ACTIVE', async () => {
      prismaMock.academicYear.findUnique.mockResolvedValue({
        ...mockAcademicYear,
        status: 'ON_HOLD',
      } as any);
      prismaMock.academicYear.update.mockResolvedValue({
        ...mockAcademicYear,
        status: 'ACTIVE',
      } as any);

      const res = await request(app)
        .patch(`/admin/branches/${mockBranch.id}/academic-years/${mockAcademicYear.id}/resume`)
        .set(adminToken);

      expect(res.status).toBe(200);
      expect(prismaMock.academicYear.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: mockAcademicYear.id }, data: { status: 'ACTIVE' } }),
      );
    });

    test('returns 400 when resuming non-ON_HOLD year', async () => {
      prismaMock.academicYear.findUnique.mockResolvedValue({
        ...mockAcademicYear,
        status: 'ACTIVE',
      } as any);

      const res = await request(app)
        .patch(`/admin/branches/${mockBranch.id}/academic-years/${mockAcademicYear.id}/resume`)
        .set(adminToken);

      expect(res.status).toBe(400);
    });
  });

  describe('DELETE /admin/academic-years/:id — Delete AY (BA-020, BA-014)', () => {
    test('rejects deleting an ARCHIVED year (read-only guard)', async () => {
      prismaMock.academicYear.findUnique.mockResolvedValue({
        ...mockAcademicYear,
        status: 'ARCHIVED',
      } as any);

      const res = await request(app)
        .delete(`/admin/branches/${mockBranch.id}/academic-years/${mockAcademicYear.id}`)
        .set(adminToken);

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('archived');
    });

    test('returns 409 when deleting ACTIVE year', async () => {
      prismaMock.academicYear.findUnique.mockResolvedValue({
        ...mockAcademicYear,
        status: 'ACTIVE',
        _count: { groups: 0, students: 0, members: 0 },
      } as any);

      const res = await request(app)
        .delete(`/admin/branches/${mockBranch.id}/academic-years/${mockAcademicYear.id}`)
        .set(adminToken);

      expect(res.status).toBe(409);
      expect(res.body.message).toContain('ACTIVE');
    });

    test('returns 409 when deleting BUILD_STAGE year', async () => {
      prismaMock.academicYear.findUnique.mockResolvedValue({
        ...mockAcademicYear,
        status: 'BUILD_STAGE',
        _count: { groups: 0, students: 0, members: 0 },
      } as any);

      const res = await request(app)
        .delete(`/admin/branches/${mockBranch.id}/academic-years/${mockAcademicYear.id}`)
        .set(adminToken);

      expect(res.status).toBe(409);
      expect(res.body.message).toContain('BUILD_STAGE');
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// ACADEMIC YEAR MEMBERS (BA-021)
// ═══════════════════════════════════════════════════════════════════

describe('Phase 02 — AcademicYear Members (BA-021)', () => {
  let mockBranch: MockBranch;
  let mockAcademicYear: MockAcademicYear;
  let mockUser: MockUser;

  beforeEach(() => {
    jest.clearAllMocks();
    mockBranch = createMockBranch();
    mockBranch = createMockBranch();
    mockAcademicYear = createMockAcademicYear({ branchId: mockBranch.id });
    mockUser = createMockUser({ role: 'teacher' });
  });

  test('POST adds a member to academic year', async () => {
    prismaMock.academicYear.findUnique.mockResolvedValue(mockAcademicYear as any);
    prismaMock.user.findUnique.mockResolvedValue(mockUser as any);
    prismaMock.academicYearMember.findUnique.mockResolvedValue(null);
    prismaMock.academicYearMember.create.mockResolvedValue({
      id: 'aym-1',
      academicYearId: mockAcademicYear.id,
      userId: mockUser.id,
      role: 'teacher',
    } as any);

    const res = await request(app)
      .post(`/admin/branches/${mockBranch.id}/academic-years/${mockAcademicYear.id}/members`)
      .set(adminToken)
      .send({ userId: mockUser.id, role: 'teacher' });

    expect(res.status).toBe(201);
  });

  test('returns 409 when user is already a member', async () => {
    prismaMock.academicYear.findUnique.mockResolvedValue(mockAcademicYear as any);
    prismaMock.user.findUnique.mockResolvedValue(mockUser as any);
    prismaMock.academicYearMember.findUnique.mockResolvedValue({
      id: 'existing',
      academicYearId: mockAcademicYear.id,
      userId: mockUser.id,
    } as any);

    const res = await request(app)
      .post(`/admin/branches/${mockBranch.id}/academic-years/${mockAcademicYear.id}/members`)
      .set(adminToken)
      .send({ userId: mockUser.id });

    expect(res.status).toBe(409);
  });

  test('DELETE removes a member', async () => {
    prismaMock.academicYearMember.findUnique.mockResolvedValue({
      id: 'aym-1',
      academicYearId: mockAcademicYear.id,
      userId: mockUser.id,
    } as any);
    prismaMock.academicYearMember.delete.mockResolvedValue({} as any);

    const res = await request(app)
      .delete(`/admin/branches/${mockBranch.id}/academic-years/${mockAcademicYear.id}/members/${mockUser.id}`)
      .set(adminToken);

    expect(res.status).toBe(204);
  });

  test('DELETE returns 404 when membership not found', async () => {
    prismaMock.academicYearMember.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .delete(`/admin/branches/${mockBranch.id}/academic-years/${mockAcademicYear.id}/members/${mockUser.id}`)
      .set(adminToken);

    expect(res.status).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════════════════
// BRANCH MEMBERS (BA-022)
// ═══════════════════════════════════════════════════════════════════

describe('Phase 02 — Branch Members (BA-022)', () => {
  let mockBranch: MockBranch;
  let mockUser: MockUser;

  beforeEach(() => {
    jest.clearAllMocks();
    mockBranch = createMockBranch();
    mockBranch = createMockBranch();
    mockUser = createMockUser({ role: 'teacher' });
  });

  test('POST adds a user to branch with role', async () => {
    prismaMock.branch.findUnique.mockResolvedValue(mockBranch as any);
    prismaMock.user.findUnique.mockResolvedValue(mockUser as any);
    prismaMock.branchMember.findUnique.mockResolvedValue(null);
    prismaMock.branchMember.findFirst.mockResolvedValue(null);
    prismaMock.branchMember.create.mockResolvedValue({
      id: 'bm-1',
      branchId: mockBranch.id,
      userId: mockUser.id,
      role: 'teacher',
    } as any);

    const res = await request(app)
      .post(`/admin/branches/${mockBranch.id}/members`)
      .set(adminToken)
      .send({ userId: mockUser.id, role: 'teacher' });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
  });

  test('returns 409 when user is already a branch member', async () => {
    prismaMock.branch.findUnique.mockResolvedValue(mockBranch as any);
    prismaMock.user.findUnique.mockResolvedValue(mockUser as any);
    prismaMock.branchMember.findUnique.mockResolvedValue(createMockBranchMember({
      branchId: mockBranch.id,
      userId: mockUser.id,
    }) as any);

    const res = await request(app)
      .post(`/admin/branches/${mockBranch.id}/members`)
      .set(adminToken)
      .send({ userId: mockUser.id, role: 'teacher' });

    expect(res.status).toBe(409);
  });

  test('DELETE removes a branch member', async () => {
    prismaMock.branchMember.findUnique.mockResolvedValue(createMockBranchMember({
      branchId: mockBranch.id,
      userId: mockUser.id,
      role: 'teacher',
    }) as any);
    prismaMock.branchMember.update.mockResolvedValue({} as any);

    const res = await request(app)
      .delete(`/admin/branches/${mockBranch.id}/members/${mockUser.id}`)
      .set(adminToken);

    expect(res.status).toBe(204);
  });
});

// ═══════════════════════════════════════════════════════════════════
// GET /me/academic-year (BA-023)
// ═══════════════════════════════════════════════════════════════════

describe('Phase 02 — GET /me/academic-year (BA-023)', () => {
  let mockUser: MockUser;
  let mockBranch: MockBranch;

  beforeEach(() => {
    jest.clearAllMocks();
    mockBranch = createMockBranch();
    mockUser = createMockUser({ role: 'teacher' });
    mockBranch = createMockBranch();
  });

  test('returns ACTIVE academic year for user\'s branch', async () => {
    prismaMock.branchMember.findMany.mockResolvedValue([
      {
        id: 'bm-1',
        branchId: mockBranch.id,
        userId: mockUser.id,
        branch: { id: mockBranch.id, name: mockBranch.name, code: mockBranch.code },
      } as any,
    ] as any);
    prismaMock.academicYear.findFirst.mockResolvedValue({
      id: 'ay-1',
      branchId: mockBranch.id,
      calendarId: 'cal-1',
      status: 'ACTIVE',
      previousAcademicYearId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      branch: { id: mockBranch.id, name: mockBranch.name, code: mockBranch.code },
      calendar: { id: 'cal-1', label: '2025-2026', startDate: new Date(), endDate: new Date() },
      _count: { groups: 5, students: 50, members: 10 },
    } as any);

    const token = getAuthHeader(generateTestToken(mockUser.id, 'teacher'));
    const res = await request(app).get('/me/academic-year').set(token);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('ACTIVE');
    expect(res.body.data.branch).toBeDefined();
    expect(res.body.data._count.groups).toBe(5);
  });

  test('returns 404 when user has no branch memberships', async () => {
    prismaMock.branchMember.findMany.mockResolvedValue([]);

    const token = getAuthHeader(generateTestToken(mockUser.id, 'teacher'));
    const res = await request(app).get('/me/academic-year').set(token);

    expect(res.status).toBe(404);
  });

  test('returns 401 without token', async () => {
    const res = await request(app).get('/me/academic-year');
    expect(res.status).toBe(401);
  });

  test('accessible by all roles (not just admin)', async () => {
    prismaMock.branchMember.findMany.mockResolvedValue([
      {
        id: 'bm-1',
        branchId: mockBranch.id,
        userId: mockUser.id,
        branch: { id: mockBranch.id, name: mockBranch.name, code: mockBranch.code },
      } as any,
    ] as any);
    prismaMock.academicYear.findFirst.mockResolvedValue({
      id: 'ay-1',
      status: 'ACTIVE',
    } as any);

    const token = getAuthHeader(generateTestToken(mockUser.id, 'parent'));
    const res = await request(app).get('/me/academic-year').set(token);

    expect(res.status).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════════════
// EXISTING: USERS (unchanged functionality)
// ═══════════════════════════════════════════════════════════════════

describe('Admin — Users', () => {
  let mockBranch: MockBranch;
  let mockUser: MockUser;

  beforeEach(() => {
    jest.clearAllMocks();
    mockBranch = createMockBranch();
    mockUser = createMockUser({ role: 'super_admin' });
  });

  test('GET /admin/users returns list of users', async () => {
    prismaMock.user.findMany.mockResolvedValue([mockUser] as any);
    const res = await request(app).get('/admin/users').set(adminToken);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });

  test('GET /admin/users/:id returns user when found', async () => {
    prismaMock.user.findUnique.mockResolvedValue(mockUser as any);
    const res = await request(app).get(`/admin/users/${mockUser.id}`).set(adminToken);
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(mockUser.id);
  });

  test('GET /admin/users/:id returns 404 when not found', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    const res = await request(app).get('/admin/users/non-existent').set(adminToken);
    expect(res.status).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════════════════
// EXISTING: GROUPS (updated for academicYearId)
// ═══════════════════════════════════════════════════════════════════

describe('Admin — Groups', () => {
  let mockBranch: MockBranch;
  let mockGroup: MockGroup;

  beforeEach(() => {
    jest.clearAllMocks();
    mockBranch = createMockBranch();
    mockGroup = createMockGroup();
  });

  test('GET /admin/groups returns groups with _count', async () => {
    prismaMock.group.findMany.mockResolvedValue([
      { ...mockGroup, _count: { members: 5, students: 15 } },
    ] as any);

    const res = await request(app).get('/admin/groups').set(adminToken);
    expect(res.status).toBe(200);
    expect(res.body.data[0]._count.members).toBe(5);
  });

  test('GET /admin/groups filters by academicYearId', async () => {
    prismaMock.group.findMany.mockResolvedValue([]);
    await request(app)
      .get(`/admin/groups?academicYearId=${mockGroup.academicYearId}`)
      .set(adminToken);

    expect(prismaMock.group.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ academicYearId: mockGroup.academicYearId }),
      }),
    );
  });

  test('POST /admin/groups creates a group with academicYearId', async () => {
    prismaMock.group.create.mockResolvedValue(mockGroup as any);

    const res = await request(app)
      .post('/admin/groups')
      .set(adminToken)
      .send({
        academicYearId: mockGroup.academicYearId,
        name: 'Class 1',
        section: 'A',
        displayOrder: 1,
      });

    expect(res.status).toBe(201);
    expect(res.body.data.id).toBe(mockGroup.id);
  });

  test('POST /admin/groups auto-assigns to active academic year when not provided', async () => {
    const activeAy = { id: 'ay-active', status: 'ACTIVE' };
    prismaMock.academicYear.findFirst.mockResolvedValue(activeAy as any);
    prismaMock.group.create.mockResolvedValue({ ...mockGroup, academicYearId: activeAy.id } as any);

    const res = await request(app)
      .post('/admin/groups')
      .set(adminToken)
      .send({ name: 'Auto AY Group', displayOrder: 5 });

    expect(res.status).toBe(201);
    expect(prismaMock.group.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ academicYearId: activeAy.id }),
      }),
    );
  });

  test('POST /admin/groups returns 400 when no academicYearId provided and no active AY exists', async () => {
    prismaMock.academicYear.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .post('/admin/groups')
      .set(adminToken)
      .send({ name: 'Orphan Group', displayOrder: 5 });

    expect(res.status).toBe(400);
    expect(prismaMock.group.create).not.toHaveBeenCalled();
  });

  test('GET /admin/groups/:id returns group with members and students', async () => {
    const groupDetail = {
      ...mockGroup,
      members: [{ id: 'gm-1', user: { id: 'u-1', name: 'Member', role: 'teacher' } }],
      students: [{ id: 's-1', name: 'Student', isActive: true }],
    };
    prismaMock.group.findUnique.mockResolvedValue(groupDetail as any);

    const res = await request(app).get(`/admin/groups/${mockGroup.id}`).set(adminToken);
    expect(res.status).toBe(200);
    expect(res.body.data.members).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════════════
// EXISTING: STUDENTS (updated for academicYearId)
// ═══════════════════════════════════════════════════════════════════

describe('Admin — Students', () => {
  let mockBranch: MockBranch;
  let mockStudent: MockStudent;

  beforeEach(() => {
    jest.clearAllMocks();
    mockBranch = createMockBranch();
    mockStudent = createMockStudent();
  });

  test('GET /admin/students returns list of students', async () => {
    prismaMock.student.findMany.mockResolvedValue([{ ...mockStudent, group: { name: 'Class 1' } }] as any);
    const res = await request(app).get('/admin/students').set(adminToken);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });

  test('POST /admin/students creates a student with academicYearId', async () => {
    const activeAy = { id: 'ay-active', status: 'ACTIVE' };
    prismaMock.academicYear.findFirst.mockResolvedValue(activeAy as any);
    prismaMock.student.create.mockResolvedValue(mockStudent as any);

    const res = await request(app)
      .post('/admin/students')
      .set(adminToken)
      .send({ name: 'Test Student', groupId: mockStudent.groupId });

    expect(res.status).toBe(201);
    expect(prismaMock.student.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: 'Test Student',
          academicYearId: activeAy.id,
        }),
      }),
    );
  });

  test('POST /admin/students returns 400 when name is missing', async () => {
    const res = await request(app)
      .post('/admin/students')
      .set(adminToken)
      .send({ groupId: mockStudent.groupId });

    expect(res.status).toBe(400);
  });

  test('DELETE /admin/students/:id soft-deletes a student', async () => {
    prismaMock.student.findUnique.mockResolvedValue(mockStudent as any);
    prismaMock.student.update.mockResolvedValue({ ...mockStudent, isActive: false } as any);
    const res = await request(app).delete(`/admin/students/${mockStudent.id}`).set(adminToken);
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Student deactivated');
  });
});

// ═══════════════════════════════════════════════════════════════════
// STATS
// ═══════════════════════════════════════════════════════════════════

describe('Admin — Stats', () => {
  beforeEach(() => jest.clearAllMocks());

  test('GET /admin/stats returns aggregated counts (updated for new schema)', async () => {
    prismaMock.user.count.mockResolvedValue(100);
    prismaMock.group.count.mockResolvedValue(10);
    prismaMock.student.count.mockResolvedValue(500);
    prismaMock.academicYear.count.mockResolvedValue(1);
    prismaMock.branch.count.mockResolvedValue(1);
    prismaMock.apiKey.count.mockResolvedValue(3);
    (prismaMock.user.groupBy as jest.Mock).mockResolvedValue([
      { role: 'super_admin', _count: { role: 1 } },
      { role: 'management', _count: { role: 2 } },
      { role: 'teacher', _count: { role: 20 } },
      { role: 'parent', _count: { role: 77 } },
    ]);

    const res = await request(app).get('/admin/stats').set(adminToken);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      totalUsers: 100,
      totalGroups: 10,
      totalStudents: 500,
      totalAcademicYears: 1,
      totalBranches: 1,
      activeApiKeys: 3,
      byRole: { super_admin: 1, management: 2, teacher: 20, parent: 77 },
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// Phase 04 — Branch Member Management
// ═══════════════════════════════════════════════════════════════════

describe('Phase 04 — Branch Member Management', () => {
  let mockBranch: MockBranch;
  let mockUser: MockUser;

  beforeEach(() => {
    jest.clearAllMocks();
    mockBranch = createMockBranch();
    mockBranch = createMockBranch();
    mockUser = createMockUser({ role: 'teacher' });
  });

  test('POST /admin/branches/:id/members — adds member with role', async () => {
    prismaMock.branch.findUnique.mockResolvedValue(mockBranch as any);
    prismaMock.user.findUnique.mockResolvedValue(mockUser as any);
    prismaMock.branchMember.findUnique.mockResolvedValue(null);
    prismaMock.branchMember.findFirst.mockResolvedValue(null);
    prismaMock.branchMember.create.mockResolvedValue(createMockBranchMember({
      branchId: mockBranch.id,
      userId: mockUser.id,
      role: 'teacher',
    }) as any);

    const res = await request(app)
      .post(`/admin/branches/${mockBranch.id}/members`)
      .set(adminToken)
      .send({ userId: mockUser.id, role: 'teacher' });

    expect(res.status).toBe(201);
  });

  test('POST rejects creating second branch_admin', async () => {
    prismaMock.branch.findUnique.mockResolvedValue(mockBranch as any);
    prismaMock.user.findUnique.mockResolvedValue(mockUser as any);
    prismaMock.branchMember.findUnique.mockResolvedValue(null);
    prismaMock.branchMember.findFirst.mockResolvedValue(createMockBranchMember({ role: 'branch_admin' }) as any);

    const res = await request(app)
      .post(`/admin/branches/${mockBranch.id}/members`)
      .set(adminToken)
      .send({ userId: mockUser.id, role: 'branch_admin' });

    expect(res.status).toBe(409);
  });

  test('POST returns 400 when userId missing', async () => {
    const res = await request(app)
      .post(`/admin/branches/${mockBranch.id}/members`)
      .set(adminToken)
      .send({ role: 'teacher' });

    expect(res.status).toBe(400);
  });

  test('PUT /admin/branches/:id/members/:userId — updates role', async () => {
    const membership = createMockBranchMember({ branchId: mockBranch.id, userId: mockUser.id, role: 'teacher' });
    prismaMock.branchMember.findUnique.mockResolvedValue(membership as any);
    prismaMock.branchMember.update.mockResolvedValue({ ...membership, role: 'sub_admin' } as any);

    const res = await request(app)
      .put(`/admin/branches/${mockBranch.id}/members/${mockUser.id}`)
      .set(adminToken)
      .send({ role: 'sub_admin' });

    expect(res.status).toBe(200);
    expect(prismaMock.branchMember.update).toHaveBeenCalled();
  });

  test('DELETE /admin/branches/:id/members/:userId — removes member', async () => {
    const membership = createMockBranchMember({ branchId: mockBranch.id, userId: mockUser.id, role: 'teacher' });
    prismaMock.branchMember.findUnique.mockResolvedValue(membership as any);
    prismaMock.branchMember.update.mockResolvedValue({ ...membership, isActive: false } as any);

    const res = await request(app)
      .delete(`/admin/branches/${mockBranch.id}/members/${mockUser.id}`)
      .set(adminToken);

    expect(res.status).toBe(204);
  });

  test('DELETE returns 409 when removing last branch_admin', async () => {
    const membership = createMockBranchMember({
      branchId: mockBranch.id,
      userId: mockUser.id,
      role: 'branch_admin',
    });
    prismaMock.branchMember.findUnique.mockResolvedValue(membership as any);
    prismaMock.branchMember.count.mockResolvedValue(0);

    const res = await request(app)
      .delete(`/admin/branches/${mockBranch.id}/members/${mockUser.id}`)
      .set(adminToken);

    expect(res.status).toBe(409);
  });

  test('POST /admin/branches/:id/members/:userId/promote — promotes to admin', async () => {
    const membership = createMockBranchMember({ branchId: mockBranch.id, userId: mockUser.id, role: 'teacher' });
    prismaMock.branchMember.findUnique.mockResolvedValue(membership as any);
    prismaMock.branchMember.findFirst.mockResolvedValue(null);
    prismaMock.branchMember.update.mockResolvedValue({ ...membership, role: 'branch_admin' } as any);

    const res = await request(app)
      .post(`/admin/branches/${mockBranch.id}/members/${mockUser.id}/promote`)
      .set(adminToken)
      .send({ keepTeacherRole: true });

    expect(res.status).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════════════
// BRANCH STATS ENDPOINT
// ═══════════════════════════════════════════════════════════════════

describe('Admin — Branch Stats (/admin/branches/:id/stats)', () => {
  const mockBranch = { id: 'branch-1', name: 'Test Branch', code: 'TST', address: 'Test', phone: null, email: null, isActive: true, _count: { academicYears: 2, branchMembers: 10 } };

  beforeEach(() => jest.clearAllMocks());

  test('GET /admin/branches/:id/stats returns per-branch stats and admins', async () => {
    prismaMock.branch.findUnique.mockResolvedValue(mockBranch as any);
    prismaMock.student.count.mockResolvedValue(150);
    prismaMock.group.count.mockResolvedValue(12);
    prismaMock.user.count.mockResolvedValue(4); // teacher count from User table

    // First findMany: all members (staff count) — excludes super_admin users
    prismaMock.branchMember.findMany.mockResolvedValueOnce([
      { role: 'branch_admin', user: { role: 'super_admin' } },  // filtered out
      { role: 'branch_admin', user: { role: 'management' } },    // kept
      { role: 'teacher', user: { role: 'teacher' } },           // kept
      { role: 'teacher', user: { role: 'teacher' } },
      { role: 'teacher', user: { role: 'teacher' } },
      { role: 'management', user: { role: 'management' } },
      { role: 'management', user: { role: 'management' } },
      { role: 'teacher', user: { role: 'teacher' } },
    ] as any);

    // Second findMany: admin info (branch_admin only, excludes super_admin)
    prismaMock.branchMember.findMany.mockResolvedValueOnce([
      { user: { id: 'u-2', name: 'Admin One', email: 'admin@test.com', phone: null, status: 'active', role: 'management' }, createdAt: new Date('2025-01-01') },
    ] as any);

    const res = await request(app).get(`/admin/branches/${mockBranch.id}/stats`).set(adminToken);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      name: 'Test Branch',
      code: 'TST',
      stats: { totalStaff: 7, totalTeachers: 4, totalStudents: 150, totalClasses: 12, totalAcademicYears: 2 },
    });
    expect(res.body.data.admins).toHaveLength(1);
    expect(res.body.data.admins[0].name).toBe('Admin One');
  });

  test('GET /admin/branches/:id/stats returns 404 for unknown branch', async () => {
    prismaMock.branch.findUnique.mockResolvedValue(null);

    const res = await request(app).get('/admin/branches/unknown/stats').set(adminToken);

    expect(res.status).toBe(404);
  });

  test('GET /admin/branches/:id/stats returns 401 without token', async () => {
    const res = await request(app).get(`/admin/branches/${mockBranch.id}/stats`);
    expect(res.status).toBe(401);
  });

  test('GET /admin/branches/:id/stats returns empty admins array when no branch_admin', async () => {
    prismaMock.branch.findUnique.mockResolvedValue(mockBranch as any);
    (prismaMock.branchMember.groupBy as jest.Mock).mockResolvedValue([]);
    prismaMock.student.count.mockResolvedValue(0);
    prismaMock.group.count.mockResolvedValue(0);
    prismaMock.branchMember.findMany.mockResolvedValueOnce([]);
    prismaMock.branchMember.findMany.mockResolvedValueOnce([]);

    const res = await request(app).get(`/admin/branches/${mockBranch.id}/stats`).set(adminToken);

    expect(res.status).toBe(200);
    expect(res.body.data.admins).toHaveLength(0);
    expect(res.body.data.stats.totalStaff).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════
// REMOVE ADMIN (soft-delete)
// ═══════════════════════════════════════════════════════════════════

describe('Admin — Remove Admin (/admin/branches/:id/remove-admin/:userId)', () => {
  const branchId = 'branch-1';
  const userId = 'user-1';

  beforeEach(() => jest.clearAllMocks());

  test('POST removes admin and deactivates credentials', async () => {
    const mockMembership = { branchId, userId, role: 'branch_admin', isActive: true };

    // Mock $transaction to execute the callback with prismaMock
    (prismaMock.$transaction as jest.Mock).mockImplementation(async (cb: any) => {
      return cb(prismaMock);
    });

    prismaMock.user.update.mockResolvedValue({ id: userId, status: 'inactive' } as any);
    prismaMock.branchMember.findUnique.mockResolvedValue(mockMembership as any);
    prismaMock.branchMember.update.mockResolvedValue({ ...mockMembership, isActive: false } as any);

    const res = await request(app)
      .post(`/admin/branches/${branchId}/remove-admin/${userId}`)
      .set(adminToken);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toContain('Credentials deactivated');

    // Verify user was deactivated
    expect(prismaMock.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: userId }, data: { status: 'inactive' } }),
    );

    // Verify membership was removed
    expect(prismaMock.branchMember.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { branchId_userId: { branchId, userId } }, data: { isActive: false } }),
    );
  });

  test('POST returns 403 for non-super_admin role', async () => {
    const res = await request(app)
      .post(`/admin/branches/${branchId}/remove-admin/${userId}`)
      .set(managementToken);

    expect(res.status).toBe(403);
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  test('POST returns 401 without token', async () => {
    const res = await request(app)
      .post(`/admin/branches/${branchId}/remove-admin/${userId}`);

    expect(res.status).toBe(401);
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  test('POST handles missing membership gracefully', async () => {
    (prismaMock.$transaction as jest.Mock).mockImplementation(async (cb: any) => {
      return cb(prismaMock);
    });

    prismaMock.user.update.mockResolvedValue({ id: userId, status: 'inactive' } as any);
    prismaMock.branchMember.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .post(`/admin/branches/${branchId}/remove-admin/${userId}`)
      .set(adminToken);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // User still deactivated even if membership doesn't exist
    expect(prismaMock.user.update).toHaveBeenCalled();
    expect(prismaMock.branchMember.update).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════
// TEACHER PROFILE CRUD (Phase 14)
// ═══════════════════════════════════════════════════════════════════

describe('Admin — Teacher Profile CRUD (/admin/teachers)', () => {
  const mockUser = { id: 'teacher-u-1', name: 'Ms. Sarah', email: 'sarah@school.com', phone: null, role: 'teacher', status: 'active' };
  const mockProfile = {
    id: 'tp-1', userId: 'teacher-u-1', employeeId: 'TCH-001', qualification: 'M.Sc. Mathematics',
    specialization: 'Mathematics', joiningDate: new Date('2024-01-15'), salary: null,
    phone: '1234567890', emergencyContact: null, address: '123 School St', dateOfBirth: null,
    gender: 'female', bloodGroup: null, fatherName: 'Muhammad', cardId: '12345-6789012-3',
    severeDisease: 'Asthma', experience: '5 years', bio: 'Experienced math teacher',
    createdAt: new Date(), updatedAt: new Date(),
    user: mockUser,
  };

  beforeEach(() => jest.clearAllMocks());

  // TC-011: POST /admin/teachers — Create teacher profile
  describe('POST /admin/teachers', () => {
    test('creates teacher profile with all fields', async () => {
      prismaMock.teacherProfile.findUnique.mockResolvedValue(null); // No existing profile
      prismaMock.user.findUnique.mockResolvedValue(mockUser as any);
      prismaMock.teacherProfile.create.mockResolvedValue(mockProfile as any);

      const res = await request(app)
        .post('/admin/teachers')
        .send({
          userId: 'teacher-u-1', employeeId: 'TCH-001', qualification: 'M.Sc. Mathematics',
          specialization: 'Mathematics', joiningDate: '2024-01-15', phone: '1234567890',
          address: '123 School St', gender: 'female',
        })
        .set(adminToken);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.employeeId).toBe('TCH-001');
      expect(res.body.data.user.name).toBe('Ms. Sarah');
    });

    test('returns 400 when userId is missing', async () => {
      const res = await request(app)
        .post('/admin/teachers')
        .send({ qualification: 'M.Sc.' })
        .set(adminToken);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    test('returns 400 when user role is not teacher', async () => {
      prismaMock.user.findUnique.mockResolvedValue({ ...mockUser, role: 'parent' } as any);

      const res = await request(app)
        .post('/admin/teachers')
        .send({ userId: 'teacher-u-1', employeeId: 'TCH-001' })
        .set(adminToken);

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('role=teacher');
    });

    test('returns 409 if profile already exists', async () => {
      prismaMock.user.findUnique.mockResolvedValue(mockUser as any);
      prismaMock.teacherProfile.findUnique.mockResolvedValue(mockProfile as any);

      const res = await request(app)
        .post('/admin/teachers')
        .send({ userId: 'teacher-u-1' })
        .set(adminToken);

      expect(res.status).toBe(409);
      expect(res.body.message).toContain('already exists');
    });

    test('returns 409 if employeeId is taken', async () => {
      prismaMock.teacherProfile.findUnique
        .mockResolvedValueOnce(null)  // No existing profile by userId
        .mockResolvedValueOnce({ id: 'other', employeeId: 'TCH-001' } as any);  // EmployeeId taken

      prismaMock.user.findUnique.mockResolvedValue(mockUser as any);

      const res = await request(app)
        .post('/admin/teachers')
        .send({ userId: 'teacher-u-1', employeeId: 'TCH-001' })
        .set(adminToken);

      expect(res.status).toBe(409);
      expect(res.body.message).toContain('already in use');
    });

    test('creates teacher with new fields (fatherName, cardId, severeDisease, experience, bio)', async () => {
      prismaMock.teacherProfile.findUnique.mockResolvedValue(null);
      prismaMock.user.findUnique.mockResolvedValue(mockUser as any);
      const extendedProfile = { ...mockProfile, fatherName: 'Ahmed', cardId: 'CNIC-1234', severeDisease: 'Diabetes', experience: '8 years', bio: 'Senior science teacher' };
      prismaMock.teacherProfile.create.mockResolvedValue(extendedProfile as any);

      const res = await request(app)
        .post('/admin/teachers')
        .send({
          userId: 'teacher-u-1', fatherName: 'Ahmed', cardId: 'CNIC-1234',
          severeDisease: 'Diabetes', experience: '8 years', bio: 'Senior science teacher',
        })
        .set(adminToken);

      expect(res.status).toBe(201);
      expect(res.body.data.fatherName).toBe('Ahmed');
      expect(res.body.data.cardId).toBe('CNIC-1234');
      expect(res.body.data.severeDisease).toBe('Diabetes');
      expect(res.body.data.experience).toBe('8 years');
      expect(res.body.data.bio).toBe('Senior science teacher');
    });

    test('creates teacher with complete payload (all fields combined)', async () => {
      prismaMock.teacherProfile.findUnique.mockResolvedValue(null);
      prismaMock.user.findUnique.mockResolvedValue(mockUser as any);
      const fullProfile = {
        ...mockProfile, fatherName: 'Khalid', cardId: 'CNIC-9999',
        severeDisease: 'None', experience: '12 years', bio: 'Senior teacher with PhD',
        user: { ...mockUser, profilePhotoId: 'photo-001' },
      };
      prismaMock.teacherProfile.create.mockResolvedValue(fullProfile as any);
      prismaMock.user.update.mockResolvedValue(mockUser as any);

      const res = await request(app)
        .post('/admin/teachers')
        .send({
          userId: 'teacher-u-1', employeeId: 'TCH-999', qualification: 'PhD',
          specialization: 'Physics', joiningDate: '2024-01-15', phone: '1234567890',
          address: '456 School Rd', gender: 'male', bloodGroup: 'B+',
          fatherName: 'Khalid', cardId: 'CNIC-9999',
          severeDisease: 'None', experience: '12 years', bio: 'Senior teacher with PhD',
          profilePhotoId: 'photo-001',
        })
        .set(adminToken);

      expect(res.status).toBe(201);
      expect(res.body.data.fatherName).toBe('Khalid');
      expect(res.body.data.cardId).toBe('CNIC-9999');
      expect(res.body.data.experience).toBe('12 years');
      expect(res.body.data.bio).toBe('Senior teacher with PhD');
    });
  });

  // TC-012: GET /admin/teachers — List teachers
  describe('GET /admin/teachers', () => {
    test('lists teachers with pagination', async () => {
      prismaMock.teacherProfile.findMany.mockResolvedValue([mockProfile] as any);
      prismaMock.teacherProfile.count.mockResolvedValue(1);
      prismaMock.teacherAssignment.count.mockResolvedValue(2);

      const res = await request(app)
        .get('/admin/teachers')
        .set(adminToken);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.meta.total).toBe(1);
      expect(res.body.data[0]._count.assignments).toBe(2);
    });

    test('applies search filter by name', async () => {
      prismaMock.teacherProfile.findMany.mockResolvedValue([]);
      prismaMock.teacherProfile.count.mockResolvedValue(0);

      await request(app)
        .get('/admin/teachers?search=Sarah')
        .set(adminToken);

      expect(prismaMock.teacherProfile.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: expect.arrayContaining([
              expect.objectContaining({ user: expect.objectContaining({ name: expect.objectContaining({ contains: 'Sarah' }) }) }),
            ]),
          }),
        }),
      );
    });
  });

  // TC-013: GET /admin/teachers/:id — Get teacher detail
  describe('GET /admin/teachers/:id', () => {
    test('returns teacher profile with assignments', async () => {
      prismaMock.teacherProfile.findUnique.mockResolvedValue(mockProfile as any);
      prismaMock.teacherAssignment.findMany.mockResolvedValue([]);

      const res = await request(app)
        .get('/admin/teachers/tp-1')
        .set(adminToken);

      expect(res.status).toBe(200);
      expect(res.body.data.employeeId).toBe('TCH-001');
      expect(res.body.data.assignments).toEqual([]);
    });

    test('returns 404 for unknown teacher', async () => {
      prismaMock.teacherProfile.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .get('/admin/teachers/unknown')
        .set(adminToken);

      expect(res.status).toBe(404);
    });
  });

  // TC-014: PUT /admin/teachers/:id — Update teacher
  describe('PUT /admin/teachers/:id', () => {
    test('updates teacher profile fields', async () => {
      prismaMock.teacherProfile.findUnique.mockResolvedValue(mockProfile as any);
      prismaMock.teacherProfile.update.mockResolvedValue({ ...mockProfile, qualification: 'B.Ed' } as any);

      const res = await request(app)
        .put('/admin/teachers/tp-1')
        .send({ qualification: 'B.Ed' })
        .set(adminToken);

      expect(res.status).toBe(200);
      expect(res.body.data.qualification).toBe('B.Ed');
    });

    test('returns 404 for missing teacher', async () => {
      prismaMock.teacherProfile.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .put('/admin/teachers/unknown')
        .send({ qualification: 'B.Ed' })
        .set(adminToken);

      expect(res.status).toBe(404);
    });

    test('updates teacher new fields (fatherName, cardId, severeDisease, experience, bio)', async () => {
      prismaMock.teacherProfile.findUnique.mockResolvedValue(mockProfile as any);
      const updated = { ...mockProfile, fatherName: 'Abdullah', cardId: 'CNIC-5678', severeDisease: 'None', experience: '10 years', bio: 'Updated bio' };
      prismaMock.teacherProfile.update.mockResolvedValue(updated as any);

      const res = await request(app)
        .put('/admin/teachers/tp-1')
        .send({ fatherName: 'Abdullah', cardId: 'CNIC-5678', severeDisease: 'None', experience: '10 years', bio: 'Updated bio' })
        .set(adminToken);

      expect(res.status).toBe(200);
      expect(res.body.data.fatherName).toBe('Abdullah');
      expect(res.body.data.cardId).toBe('CNIC-5678');
      expect(res.body.data.bio).toBe('Updated bio');
    });
  });

  // TC-015: DELETE /admin/teachers/:id — Delete teacher
  describe('DELETE /admin/teachers/:id', () => {
    test('soft deletes teacher with no assignments', async () => {
      prismaMock.teacherProfile.findUnique.mockResolvedValue(mockProfile as any);
      prismaMock.teacherAssignment.count.mockResolvedValue(0);
      prismaMock.teacherProfile.delete.mockResolvedValue(mockProfile as any);
      prismaMock.user.delete.mockResolvedValue(mockUser as any);

      const res = await request(app)
        .delete('/admin/teachers/tp-1')
        .set(adminToken);

      expect(res.status).toBe(200);
      expect(res.body.message).toContain('deleted');
      expect(prismaMock.teacherProfile.delete).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'tp-1' } }),
      );
      expect(prismaMock.user.delete).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'teacher-u-1' } }),
      );
      });

    test('returns 409 if teacher has active assignments', async () => {
      prismaMock.teacherProfile.findUnique.mockResolvedValue(mockProfile as any);
      prismaMock.teacherAssignment.count.mockResolvedValue(3);

      const res = await request(app)
        .delete('/admin/teachers/tp-1')
        .set(adminToken);

      expect(res.status).toBe(409);
      expect(res.body.message).toContain('historical');
    });

    test('returns 404 for unknown teacher', async () => {
      prismaMock.teacherProfile.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .delete('/admin/teachers/unknown')
        .set(adminToken);

      expect(res.status).toBe(404);
    });
  });

  // ─── Deactivate / Reactivate ──────────────────────────

  describe('POST /admin/teachers/:id/deactivate', () => {
    test('deactivates active teacher', async () => {
      prismaMock.teacherProfile.findUnique.mockResolvedValue({
        id: 'tp-1', userId: 'u-1',
        user: { name: 'Ms. Sarah', status: 'active' },
      } as any);
      prismaMock.user.update.mockResolvedValue(mockUser as any);
      prismaMock.branchMember.updateMany.mockResolvedValue({ count: 1 } as any);

      const res = await request(app)
        .post('/admin/teachers/tp-1/deactivate')
        .set(adminToken);

      expect(res.status).toBe(200);
      expect(res.body.message).toContain('deactivated');
      expect(prismaMock.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'u-1' }, data: { status: 'inactive' } }),
      );
    });

    test('returns 400 if already inactive', async () => {
      prismaMock.teacherProfile.findUnique.mockResolvedValue({
        id: 'tp-1', userId: 'u-1',
        user: { name: 'Ms. Sarah', status: 'inactive' },
      } as any);

      const res = await request(app)
        .post('/admin/teachers/tp-1/deactivate')
        .set(adminToken);

      expect(res.status).toBe(400);
    });

    test('returns 404 for unknown teacher', async () => {
      prismaMock.teacherProfile.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .post('/admin/teachers/unknown/deactivate')
        .set(adminToken);

      expect(res.status).toBe(404);
    });
  });

  describe('POST /admin/teachers/:id/reactivate', () => {
    test('reactivates inactive teacher', async () => {
      prismaMock.teacherProfile.findUnique.mockResolvedValue({
        id: 'tp-1', userId: 'u-1',
        user: { name: 'Ms. Sarah', status: 'inactive' },
      } as any);
      prismaMock.user.update.mockResolvedValue(mockUser as any);
      prismaMock.branchMember.updateMany.mockResolvedValue({ count: 1 } as any);

      const res = await request(app)
        .post('/admin/teachers/tp-1/reactivate')
        .set(adminToken);

      expect(res.status).toBe(200);
      expect(res.body.message).toContain('reactivated');
      expect(prismaMock.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'u-1' }, data: { status: 'active' } }),
      );
    });

    test('returns 400 if already active', async () => {
      prismaMock.teacherProfile.findUnique.mockResolvedValue({
        id: 'tp-1', userId: 'u-1',
        user: { name: 'Ms. Sarah', status: 'active' },
      } as any);

      const res = await request(app)
        .post('/admin/teachers/tp-1/reactivate')
        .set(adminToken);

      expect(res.status).toBe(400);
    });

    test('returns 404 for unknown teacher', async () => {
      prismaMock.teacherProfile.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .post('/admin/teachers/unknown/reactivate')
        .set(adminToken);

      expect(res.status).toBe(404);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// TEACHER ASSIGNMENTS (Phase 14)
// ═══════════════════════════════════════════════════════════════════

describe('Admin — Teacher Assignments', () => {
  const mockTeacher = { id: 'teacher-u-1', name: 'Ms. Sarah', role: 'teacher', status: 'active' };
  const mockAy = { id: 'ay-1' };
  const mockGroup = { id: 'group-1', name: 'Class 1-A', section: null };
  const mockSubject = { id: 'subj-1', name: 'Mathematics', code: 'MATH' };
  const mockAssignment = {
    id: 'assign-1', academicYearId: 'ay-1', teacherId: 'teacher-u-1',
    groupId: 'group-1', subjectId: 'subj-1', isClassTeacher: false,
    teacher: { id: 'teacher-u-1', name: 'Ms. Sarah' },
    group: { id: 'group-1', name: 'Class 1-A', section: null },
    subject: { id: 'subj-1', name: 'Mathematics', code: 'MATH' },
    academicYear: { id: 'ay-1' },
  };

  beforeEach(() => jest.clearAllMocks());

  // TC-017: POST /admin/assignments — Create assignment
  describe('POST /admin/assignments', () => {
    test('creates assignment successfully', async () => {
      prismaMock.user.findUnique.mockResolvedValue(mockTeacher as any);
      prismaMock.academicYear.findUnique.mockResolvedValue(mockAy as any);
      prismaMock.group.findUnique.mockResolvedValue(mockGroup as any);
      prismaMock.subject.findUnique.mockResolvedValue(mockSubject as any);
      prismaMock.teacherAssignment.findUnique.mockResolvedValue(null);
      prismaMock.teacherAssignment.create.mockResolvedValue(mockAssignment as any);

      const res = await request(app)
        .post('/admin/assignments')
        .send({ academicYearId: 'ay-1', teacherId: 'teacher-u-1', groupId: 'group-1', subjectId: 'subj-1' })
        .set(adminToken);

      expect(res.status).toBe(201);
      expect(res.body.data.teacher.name).toBe('Ms. Sarah');
      expect(res.body.data.group.name).toBe('Class 1-A');
    });

    test('returns 400 when required fields missing', async () => {
      const res = await request(app)
        .post('/admin/assignments')
        .send({})
        .set(adminToken);

      expect(res.status).toBe(400);
    });

    test('allows co-teaching with role assignment', async () => {
      prismaMock.user.findUnique.mockResolvedValue(mockTeacher as any);
      prismaMock.academicYear.findUnique.mockResolvedValue(mockAy as any);
      prismaMock.group.findUnique.mockResolvedValue(mockGroup as any);
      prismaMock.subject.findUnique.mockResolvedValue(mockSubject as any);
      prismaMock.teacherAssignment.create.mockResolvedValue({ ...mockAssignment, role: 'assistant' } as any);

      const res = await request(app)
        .post('/admin/assignments')
        .send({ academicYearId: 'ay-1', teacherId: 'teacher-u-1', groupId: 'group-1', subjectId: 'subj-1', role: 'assistant' })
        .set(adminToken);

      expect(res.status).toBe(201);
    });
  });

  // TC-016: GET /admin/teachers/:id/assignments — Get teacher's assignments
  describe('GET /admin/teachers/:id/assignments', () => {
    test('returns assignments for a teacher', async () => {
      prismaMock.teacherAssignment.findMany.mockResolvedValue([mockAssignment] as any);

      const res = await request(app)
        .get('/admin/teachers/teacher-u-1/assignments')
        .set(adminToken);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].subject.name).toBe('Mathematics');
    });

    test('returns empty array when no assignments', async () => {
      prismaMock.teacherAssignment.findMany.mockResolvedValue([]);

      const res = await request(app)
        .get('/admin/teachers/teacher-u-1/assignments')
        .set(adminToken);

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
    });
  });

  // TC-018: GET /admin/groups/:groupId/assignments — Get group's assignments
  describe('GET /admin/groups/:groupId/assignments', () => {
    test('returns all teachers assigned to a group', async () => {
      prismaMock.teacherAssignment.findMany.mockResolvedValue([mockAssignment] as any);

      const res = await request(app)
        .get('/admin/groups/group-1/assignments')
        .set(adminToken);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].teacher.name).toBe('Ms. Sarah');
    });
  });

  // TC-019: PUT /admin/assignments/:id — Update assignment
  describe('PUT /admin/assignments/:id', () => {
    test('updates isClassTeacher flag', async () => {
      prismaMock.teacherAssignment.findUnique.mockResolvedValue(mockAssignment as any);
      prismaMock.teacherAssignment.updateMany.mockResolvedValue({ count: 0 } as any);
      prismaMock.teacherAssignment.update.mockResolvedValue({ ...mockAssignment, isClassTeacher: true } as any);

      const res = await request(app)
        .put('/admin/assignments/assign-1')
        .send({ isClassTeacher: true })
        .set(adminToken);

      expect(res.status).toBe(200);
      expect(res.body.data.isClassTeacher).toBe(true);
    });

    test('un-sets previous class teacher when setting new one', async () => {
      prismaMock.teacherAssignment.findUnique
        .mockResolvedValueOnce(mockAssignment as any);
      // Second call in update — must also exist
      prismaMock.teacherAssignment.update.mockResolvedValue({ ...mockAssignment, isClassTeacher: true } as any);
      prismaMock.teacherAssignment.updateMany.mockResolvedValue({ count: 1 } as any);

      await request(app)
        .put('/admin/assignments/assign-1')
        .send({ isClassTeacher: true })
        .set(adminToken);

      // Verify old class teacher was unset
      expect(prismaMock.teacherAssignment.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            groupId: 'group-1',
            isClassTeacher: true,
            id: { not: 'assign-1' },
          }),
          data: { isClassTeacher: false },
        }),
      );
    });

    test('returns 404 for unknown assignment', async () => {
      prismaMock.teacherAssignment.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .put('/admin/assignments/unknown')
        .send({ isClassTeacher: true })
        .set(adminToken);

      expect(res.status).toBe(404);
    });
  });

  // TC-020: DELETE /admin/assignments/:id
  describe('DELETE /admin/assignments/:id', () => {
    test('deletes assignment successfully', async () => {
      prismaMock.teacherAssignment.findUnique.mockResolvedValue(mockAssignment as any);
      prismaMock.teacherAssignment.delete.mockResolvedValue(mockAssignment as any);

      const res = await request(app)
        .delete('/admin/assignments/assign-1')
        .set(adminToken);

      expect(res.status).toBe(200);
      expect(res.body.message).toContain('removed');
    });

    test('returns 404 for unknown assignment', async () => {
      prismaMock.teacherAssignment.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .delete('/admin/assignments/unknown')
        .set(adminToken);

      expect(res.status).toBe(404);
    });

    test('PUT updates assignment role', async () => {
      prismaMock.teacherAssignment.findUnique.mockResolvedValue(mockAssignment as any);
      prismaMock.teacherAssignment.updateMany.mockResolvedValue({ count: 0 } as any);
      prismaMock.teacherAssignment.update.mockResolvedValue({ ...mockAssignment, role: 'assistant' } as any);
      const res = await request(app)
        .put('/admin/assignments/assign-1')
        .set(adminToken).send({ isClassTeacher: false });
      expect(res.status).toBe(200);
    });

    test('PUT returns 404 for unknown assignment', async () => {
      prismaMock.teacherAssignment.findUnique.mockResolvedValue(null);
      const res = await request(app)
        .put('/admin/assignments/unknown')
        .set(adminToken).send({ isClassTeacher: true });
      expect(res.status).toBe(404);
    });

    test('POST requires groupId', async () => {
      const res = await request(app)
        .post('/admin/assignments')
        .set(adminToken).send({ academicYearId: 'ay-1', teacherId: 't-1', subjectId: 's-1' });
      expect(res.status).toBe(400);
    });

    test('POST rejects inactive teacher', async () => {
      prismaMock.user.findUnique.mockResolvedValue({ id: 't-1', role: 'teacher', status: 'inactive' } as any);
      const res = await request(app)
        .post('/admin/assignments')
        .set(adminToken).send({ academicYearId: 'ay-1', teacherId: 't-1', groupId: 'g-1', subjectId: 's-1' });
      expect(res.status).toBe(400);
    });

    test('POST returns 404 for missing academic year', async () => {
      prismaMock.user.findUnique.mockResolvedValue(mockTeacher as any);
      prismaMock.academicYear.findUnique.mockResolvedValue(null);
      const res = await request(app)
        .post('/admin/assignments')
        .set(adminToken).send({ academicYearId: 'bad-ay', teacherId: 'teacher-u-1', groupId: 'g-1', subjectId: 's-1' });
      expect(res.status).toBe(404);
    });

    test('GET teachers/:id/assignments returns role field', async () => {
      prismaMock.teacherAssignment.findMany.mockResolvedValue([{ ...mockAssignment, role: 'hod' }] as any);
      const res = await request(app)
        .get('/admin/teachers/teacher-u-1/assignments')
        .set(adminToken);
      expect(res.status).toBe(200);
      expect(res.body.data[0].role).toBe('hod');
    });

    test('GET groups/:id/assignments returns teacher info', async () => {
      prismaMock.teacherAssignment.findMany.mockResolvedValue([mockAssignment] as any);
      const res = await request(app)
        .get('/admin/groups/group-1/assignments')
        .set(adminToken);
      expect(res.status).toBe(200);
      expect(res.body.data[0].teacher.name).toBe('Ms. Sarah');
    });

    test('POST assignment with role=hod saves correctly', async () => {
      prismaMock.user.findUnique.mockResolvedValue(mockTeacher as any);
      prismaMock.academicYear.findUnique.mockResolvedValue(mockAy as any);
      prismaMock.group.findUnique.mockResolvedValue(mockGroup as any);
      prismaMock.subject.findUnique.mockResolvedValue(mockSubject as any);
      prismaMock.teacherAssignment.create.mockResolvedValue({ ...mockAssignment, role: 'hod' } as any);
      const res = await request(app)
        .post('/admin/assignments')
        .set(adminToken).send({ academicYearId: 'ay-1', teacherId: 'teacher-u-1', groupId: 'group-1', subjectId: 'subj-1', role: 'hod' });
      expect(res.status).toBe(201);
    });

    test('DELETE /admin/assignments/:id returns 200', async () => {
      prismaMock.teacherAssignment.findUnique.mockResolvedValue(mockAssignment as any);
      prismaMock.teacherAssignment.delete.mockResolvedValue(mockAssignment as any);
      const res = await request(app)
        .delete('/admin/assignments/assign-1')
        .set(adminToken);
      expect(res.status).toBe(200);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// AUTH ENFORCEMENT — Teacher Routes
// ═══════════════════════════════════════════════════════════════════

describe('Phase 14 — Auth Enforcement (Teacher Routes)', () => {
  test('POST /admin/teachers returns 401 without token', async () => {
    const res = await request(app).post('/admin/teachers').send({ userId: 'test' });
    expect(res.status).toBe(401);
  });

  test('GET /admin/teachers returns 401 without token', async () => {
    const res = await request(app).get('/admin/teachers');
    expect(res.status).toBe(401);
  });

  test('POST /admin/assignments returns 401 without token', async () => {
    const res = await request(app).post('/admin/assignments').send({ academicYearId: 'ay-1', teacherId: 't-1', groupId: 'g-1', subjectId: 's-1' });
    expect(res.status).toBe(401);
  });

  test('Teacher role cannot access teacher admin routes', async () => {
    const res = await request(app).get('/admin/teachers').set(teacherToken);
    expect(res.status).toBe(403);
  });

  test('Parent role cannot access teacher admin routes', async () => {
    const res = await request(app).get('/admin/teachers').set(parentToken);
    expect(res.status).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════
// SUBJECTS (Phase 12)
// ═══════════════════════════════════════════════════════════════════

describe('Admin — Subjects (/admin/branches/:id/academic-years/:ayId/subjects)', () => {
  let mockBranch: MockBranch;
  const mockSubject = { id: 'subj-1', academicYearId: 'ay-1', name: 'Mathematics', code: 'MATH', description: null, totalMarks: 100, passingMarks: 50, isElective: false, hodId: null, createdAt: new Date(), hod: null, _count: { groupSubjects: 0, teacherAssignments: 0 } };
  const mockAy = { id: 'ay-1', status: 'ACTIVE' };

  beforeEach(() => {
    jest.clearAllMocks();
    mockBranch = createMockBranch();
    mockBranch = createMockBranch();
  });

  test('POST creates a subject', async () => {
    prismaMock.academicYear.findUnique.mockResolvedValue(mockAy as any);
    prismaMock.subject.findUnique.mockResolvedValue(null); // no code conflict
    prismaMock.subject.create.mockResolvedValue(mockSubject as any);

    const res = await request(app)
      .post(`/admin/branches/${mockBranch.id}/academic-years/ay-1/subjects`)
      .set(adminToken)
      .send({ name: 'Mathematics', code: 'MATH' });

    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe('Mathematics');
  });

  test('POST returns 400 when name missing', async () => {
    const res = await request(app)
      .post(`/admin/branches/${mockBranch.id}/academic-years/ay-1/subjects`)
      .set(adminToken)
      .send({});
    expect(res.status).toBe(400);
  });

  test('POST returns 404 for unknown AY', async () => {
    prismaMock.academicYear.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .post(`/admin/branches/${mockBranch.id}/academic-years/bad-ay/subjects`)
      .set(adminToken)
      .send({ name: 'Math' });
    expect(res.status).toBe(404);
  });

  test('GET lists subjects for an AY', async () => {
    prismaMock.subject.findMany.mockResolvedValue([mockSubject] as any);
    const res = await request(app)
      .get(`/admin/branches/${mockBranch.id}/academic-years/ay-1/subjects`)
      .set(adminToken);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });

  test('PUT updates a subject', async () => {
    prismaMock.subject.findUnique.mockResolvedValue(mockSubject as any);
    prismaMock.subject.update.mockResolvedValue({ ...mockSubject, name: 'Advanced Math' } as any);

    const res = await request(app)
      .put(`/admin/branches/${mockBranch.id}/subjects/subj-1`)
      .set(adminToken)
      .send({ name: 'Advanced Math' });
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('Advanced Math');
  });

  test('DELETE blocks subject linked to groups', async () => {
    prismaMock.subject.findUnique.mockResolvedValue({
      ...mockSubject,
      _count: { groupSubjects: 2, teacherAssignments: 0 },
    } as any);

    const res = await request(app)
      .delete(`/admin/branches/${mockBranch.id}/subjects/subj-1`)
      .set(adminToken);
    expect(res.status).toBe(409);
  });

  test('DELETE deletes subject with no links', async () => {
    prismaMock.subject.findUnique.mockResolvedValue(mockSubject as any);
    prismaMock.subject.delete.mockResolvedValue(mockSubject as any);

    const res = await request(app)
      .delete(`/admin/branches/${mockBranch.id}/subjects/subj-1`)
      .set(adminToken);
    expect(res.status).toBe(200);
  });

  test('POST /link links subject to groups', async () => {
    prismaMock.subject.findUnique.mockResolvedValue(mockSubject as any);
    prismaMock.groupSubject.create.mockResolvedValue({} as any);

    const res = await request(app)
      .post(`/admin/branches/${mockBranch.id}/subjects/subj-1/link`)
      .set(adminToken)
      .send({ groupIds: ['g-1', 'g-2'] });
    expect(res.status).toBe(200);
    expect(prismaMock.groupSubject.create).toHaveBeenCalledTimes(2);
  });

  test('DELETE /unlink removes subject from group', async () => {
    prismaMock.groupSubject.findUnique.mockResolvedValue({} as any);
    prismaMock.groupSubject.delete.mockResolvedValue({} as any);

    const res = await request(app)
      .delete(`/admin/branches/${mockBranch.id}/subjects/subj-1/unlink/g-1`)
      .set(adminToken);
    expect(res.status).toBe(200);
  });

  test('POST returns 409 when code already exists in same AY', async () => {
    prismaMock.academicYear.findUnique.mockResolvedValue(mockAy as any);
    prismaMock.subject.findUnique.mockResolvedValue({ id: 'existing', code: 'MATH' } as any);
    const res = await request(app)
      .post(`/admin/branches/${mockBranch.id}/academic-years/ay-1/subjects`)
      .set(adminToken).send({ name: 'Math', code: 'MATH' });
    expect(res.status).toBe(409);
  });

  test('POST with valid hodId creates subject with HOD', async () => {
    prismaMock.academicYear.findUnique.mockResolvedValue(mockAy as any);
    prismaMock.subject.findUnique.mockResolvedValue(null);
    prismaMock.user.findUnique.mockResolvedValue({ id: 'hod-1', name: 'Dr. Khan' } as any);
    prismaMock.subject.create.mockResolvedValue({ ...mockSubject, hodId: 'hod-1', hod: { id: 'hod-1', name: 'Dr. Khan' } } as any);
    const res = await request(app)
      .post(`/admin/branches/${mockBranch.id}/academic-years/ay-1/subjects`)
      .set(adminToken).send({ name: 'Math', hodId: 'hod-1' });
    expect(res.status).toBe(201);
    expect(res.body.data.hod.name).toBe('Dr. Khan');
  });

  test('POST returns 404 when hodId references non-existent user', async () => {
    prismaMock.academicYear.findUnique.mockResolvedValue(mockAy as any);
    prismaMock.subject.findUnique.mockResolvedValue(null);
    prismaMock.user.findUnique.mockResolvedValue(null);
    const res = await request(app)
      .post(`/admin/branches/${mockBranch.id}/academic-years/ay-1/subjects`)
      .set(adminToken).send({ name: 'Math', hodId: 'bad-hod' });
    expect(res.status).toBe(404);
  });

  test('PUT with hodId=null clears the HOD', async () => {
    prismaMock.subject.findUnique.mockResolvedValue({ ...mockSubject, hodId: 'hod-1' } as any);
    prismaMock.subject.update.mockResolvedValue({ ...mockSubject, hodId: null } as any);
    const res = await request(app)
      .put(`/admin/branches/${mockBranch.id}/subjects/subj-1`)
      .set(adminToken).send({ hodId: null });
    expect(res.status).toBe(200);
  });

  test('DELETE /unlink returns 404 when link does not exist', async () => {
    prismaMock.groupSubject.findUnique.mockResolvedValue(null);
    const res = await request(app)
      .delete(`/admin/branches/${mockBranch.id}/subjects/subj-1/unlink/g-99`)
      .set(adminToken);
    expect(res.status).toBe(404);
  });

  test('Link with invalid groupId is handled gracefully', async () => {
    prismaMock.subject.findUnique.mockResolvedValue(mockSubject as any);
    prismaMock.groupSubject.create.mockRejectedValue(new Error('FK violation'));
    const res = await request(app)
      .post(`/admin/branches/${mockBranch.id}/subjects/subj-1/link`)
      .set(adminToken).send({ groupIds: ['bad-group'] });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════
// SECTIONS (Groups) CRUD
// ═══════════════════════════════════════════════════════════════════

describe('Admin — Sections (/branches/:id/academic-years/:ayId/sections)', () => {
  let mockBranch: MockBranch;
  const mockAy = { id: 'ay-1', status: 'ACTIVE' };
  const mockSection = { id: 'sec-1', academicYearId: 'ay-1', name: 'Class 1', section: 'A', displayOrder: 4, capacity: 30, isActive: true, _count: { members: 0, students: 0 } };

  beforeEach(() => {
    jest.clearAllMocks();
    mockBranch = createMockBranch();
    mockBranch = createMockBranch();
  });

  test('POST creates a section', async () => {
    prismaMock.academicYear.findUnique.mockResolvedValue(mockAy as any);
    prismaMock.group.findFirst.mockResolvedValue(null);
    prismaMock.group.create.mockResolvedValue(mockSection as any);
    const res = await request(app)
      .post(`/admin/branches/${mockBranch.id}/academic-years/ay-1/sections`)
      .set(adminToken).send({ name: 'Class 1', section: 'A', displayOrder: 4 });
    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe('Class 1');
  });

  test('POST returns 400 when name missing', async () => {
    const res = await request(app)
      .post(`/admin/branches/${mockBranch.id}/academic-years/ay-1/sections`)
      .set(adminToken).send({ displayOrder: 4 });
    expect(res.status).toBe(400);
  });

  test('GET lists sections for an AY', async () => {
    prismaMock.group.findMany.mockResolvedValue([mockSection] as any);
    const res = await request(app)
      .get(`/admin/branches/${mockBranch.id}/academic-years/ay-1/sections`)
      .set(adminToken);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });

  test('PUT updates a section', async () => {
    prismaMock.group.findUnique.mockResolvedValue(mockSection as any);
    prismaMock.group.update.mockResolvedValue({ ...mockSection, name: 'Class One' } as any);
    const res = await request(app)
      .put(`/admin/branches/${mockBranch.id}/sections/sec-1`)
      .set(adminToken).send({ name: 'Class One' });
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('Class One');
  });

  test('DELETE hard deletes section with no dependencies', async () => {
    prismaMock.group.findUnique.mockResolvedValue({ ...mockSection, _count: { students: 0, groupSubjects: 0, teacherAssignments: 0 } } as any);
    prismaMock.group.delete.mockResolvedValue(mockSection as any);
    const res = await request(app)
      .delete(`/admin/branches/${mockBranch.id}/sections/sec-1`)
      .set(adminToken);
    expect(res.status).toBe(200);
    expect(prismaMock.group.delete).toHaveBeenCalled();
  });

  test('DELETE returns 409 when section has students', async () => {
    prismaMock.group.findUnique.mockResolvedValue({ ...mockSection, _count: { students: 5, groupSubjects: 0, teacherAssignments: 0 } } as any);
    const res = await request(app)
      .delete(`/admin/branches/${mockBranch.id}/sections/sec-1`)
      .set(adminToken);
    expect(res.status).toBe(409);
  });

  test('DELETE returns 409 when section has linked subjects', async () => {
    prismaMock.group.findUnique.mockResolvedValue({ ...mockSection, _count: { students: 0, groupSubjects: 3, teacherAssignments: 0 } } as any);
    const res = await request(app)
      .delete(`/admin/branches/${mockBranch.id}/sections/sec-1`)
      .set(adminToken);
    expect(res.status).toBe(409);
    expect(res.body.message).toContain('subject link');
  });

  test('DELETE returns 409 when section has teacher assignments', async () => {
    prismaMock.group.findUnique.mockResolvedValue({ ...mockSection, _count: { students: 0, groupSubjects: 0, teacherAssignments: 2 } } as any);
    const res = await request(app)
      .delete(`/admin/branches/${mockBranch.id}/sections/sec-1`)
      .set(adminToken);
    expect(res.status).toBe(409);
    expect(res.body.message).toContain('teacher assignment');
  });

  test('DELETE returns combined message for multiple dependencies', async () => {
    prismaMock.group.findUnique.mockResolvedValue({ ...mockSection, _count: { students: 5, groupSubjects: 2, teacherAssignments: 1 } } as any);
    const res = await request(app)
      .delete(`/admin/branches/${mockBranch.id}/sections/sec-1`)
      .set(adminToken);
    expect(res.status).toBe(409);
    expect(res.body.message).toContain('student');
    expect(res.body.message).toContain('subject link');
    expect(res.body.message).toContain('teacher assignment');
  });

  test('DELETE returns 404 for unknown section', async () => {
    prismaMock.group.findUnique.mockResolvedValue(null);
    const res = await request(app)
      .delete(`/admin/branches/${mockBranch.id}/sections/unknown`)
      .set(adminToken);
    expect(res.status).toBe(404);
  });

  test('PUT returns 404 for unknown section', async () => {
    prismaMock.group.findUnique.mockResolvedValue(null);
    const res = await request(app)
      .put(`/admin/branches/${mockBranch.id}/sections/unknown`)
      .set(adminToken).send({ name: 'Test' });
    expect(res.status).toBe(404);
  });

  test('GET section subjects returns linked subjects', async () => {
    prismaMock.groupSubject.findMany.mockResolvedValue([
      { subject: { id: 's-1', name: 'Math', code: 'MATH' } },
      { subject: { id: 's-2', name: 'English', code: 'ENG' } },
    ] as any);
    const res = await request(app)
      .get(`/admin/branches/${mockBranch.id}/sections/sec-1/subjects`)
      .set(adminToken);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0].name).toBe('Math');
  });

  test('GET section subjects returns empty when none linked', async () => {
    prismaMock.groupSubject.findMany.mockResolvedValue([]);
    const res = await request(app)
      .get(`/admin/branches/${mockBranch.id}/sections/sec-1/subjects`)
      .set(adminToken);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════
// TIMETABLES (Phase 27)
// ═══════════════════════════════════════════════════════════════════

describe('Admin — Timetables', () => {
  const mockTt = { id: 'tt-1', academicYearId: 'ay-1', name: 'Regular', type: 'timetable', isActive: true, createdAt: new Date() };
  const mockAy = { id: 'ay-1', status: 'ACTIVE' };

  beforeEach(() => {
    jest.clearAllMocks();
    mockBranch = createMockBranch();
  });
  let mockBranch: MockBranch;

  test('GET /timetables lists all timetables for AY', async () => {
    prismaMock.timetable.findMany.mockResolvedValue([{ ...mockTt, _count: { slots: 0 }, dayConfigs: [{ dayOfWeek: 1, isActive: true }] }] as any);
    mockBranch = createMockBranch();
    const res = await request(app)
      .get(`/admin/branches/${mockBranch.id}/academic-years/ay-1/timetables`)
      .set(adminToken);
    expect(res.body.data).toHaveLength(1);
  });

  test('POST /timetables creates a new timetable', async () => {
    prismaMock.timetable.findUnique.mockResolvedValue(null);
    prismaMock.timetable.create.mockResolvedValue(mockTt as any);
    prismaMock.timetableDayConfig.create.mockResolvedValue({} as any);
    const res = await request(app)
      .post(`/admin/branches/${mockBranch.id}/academic-years/ay-1/timetables`)
      .set(adminToken)
      .send({ name: 'Regular', type: 'timetable' });
    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe('Regular');
  });

  test('POST /timetables returns 409 for duplicate name', async () => {
    prismaMock.timetable.findUnique.mockResolvedValue(mockTt as any);
    const res = await request(app)
      .post(`/admin/branches/${mockBranch.id}/academic-years/ay-1/timetables`)
      .set(adminToken)
      .send({ name: 'Regular' });
    expect(res.status).toBe(409);
  });

  test('PUT /timetables/:id/rename renames timetable', async () => {
    prismaMock.timetable.findUnique.mockResolvedValue(mockTt as any);
    prismaMock.timetable.update.mockResolvedValue({ ...mockTt, name: 'Updated' } as any);
    const res = await request(app)
      .put(`/admin/branches/${mockBranch.id}/timetables/tt-1/rename`)
      .set(adminToken)
      .send({ newName: 'Updated' });
    expect(res.status).toBe(200);
  });

  test('DELETE /timetables/:id deletes empty timetable', async () => {
    prismaMock.timetableSlot.findMany.mockResolvedValue([]);
    prismaMock.timetableDayConfig.deleteMany.mockResolvedValue({ count: 0 } as any);
    prismaMock.timetableSlot.deleteMany.mockResolvedValue({ count: 0 } as any);
    prismaMock.timetable.delete.mockResolvedValue(mockTt as any);
    const res = await request(app)
      .delete(`/admin/branches/${mockBranch.id}/timetables/tt-1`)
      .set(adminToken);
    expect(res.status).toBe(200);
  });

  test('POST /timetables/:id/slots creates slot (all days)', async () => {
    prismaMock.timetableSlot.findFirst.mockResolvedValue(null);
    prismaMock.timetableSlot.create.mockResolvedValue({ id: 's-1', timetableId: 'tt-1', lectureNumber: 1, startTime: '08:00', endTime: '08:40' } as any);
    const res = await request(app)
      .post(`/admin/branches/${mockBranch.id}/timetables/tt-1/slots`)
      .set(adminToken)
      .send({ startTime: '08:00', endTime: '08:40' });
    expect(res.status).toBe(201);
    expect(res.body.data.lectureNumber).toBe(1);
  });

  test('POST /timetables/:id/slots creates slot (specific day)', async () => {
    prismaMock.timetableSlot.findFirst.mockResolvedValue(null);
    prismaMock.timetableSlot.create.mockResolvedValue({ id: 's-2', timetableId: 'tt-1', dayOfWeek: 3, lectureNumber: 1, startTime: '09:00', endTime: '12:00' } as any);
    const res = await request(app)
      .post(`/admin/branches/${mockBranch.id}/timetables/tt-1/slots`)
      .set(adminToken)
      .send({ dayOfWeek: 3, startTime: '09:00', endTime: '12:00' });
    expect(res.status).toBe(201);
  });

  test('POST /timetables/:id/slots returns 400 when startTime missing', async () => {
    const res = await request(app)
      .post(`/admin/branches/${mockBranch.id}/timetables/tt-1/slots`)
      .set(adminToken)
      .send({ endTime: '08:40' });
    expect(res.status).toBe(400);
  });

  test('POST /timetables/:id/slots returns 400 when endTime missing', async () => {
    const res = await request(app)
      .post(`/admin/branches/${mockBranch.id}/timetables/tt-1/slots`)
      .set(adminToken)
      .send({ startTime: '08:00' });
    expect(res.status).toBe(400);
  });

  test('POST /timetables/:id/slots returns 400 when endTime <= startTime', async () => {
    // 11:30 → 10:30 should fail (string comparison: "11:30" > "10:30")
    const res = await request(app)
      .post(`/admin/branches/${mockBranch.id}/timetables/tt-1/slots`)
      .set(adminToken)
      .send({ startTime: '11:30', endTime: '10:30' });
    expect(res.status).toBe(400);
  });

  test('POST /timetables/:id/slots accepts 12-hour cycle (12:40→01:30)', async () => {
    prismaMock.timetableSlot.findFirst.mockResolvedValue(null);
    prismaMock.timetableSlot.create.mockResolvedValue({ id: 's-1', lectureNumber: 1, startTime: '12:40', endTime: '01:30' } as any);
    // 12:40 → 01:30 is forward in 12-hour cycle
    const res = await request(app)
      .post(`/admin/branches/${mockBranch.id}/timetables/tt-1/slots`)
      .set(adminToken)
      .send({ startTime: '12:40', endTime: '01:30' });
    expect(res.status).toBe(201);
  });

  test('POST /timetables/:id/slots returns 400 when endTime equals startTime', async () => {
    const res = await request(app)
      .post(`/admin/branches/${mockBranch.id}/timetables/tt-1/slots`)
      .set(adminToken)
      .send({ startTime: '08:00', endTime: '08:00' });
    expect(res.status).toBe(400);
  });

  test('GET /timetables/:id/slots lists slots', async () => {
    prismaMock.timetableSlot.findMany.mockResolvedValue([]);
    const res = await request(app)
      .get(`/admin/branches/${mockBranch.id}/timetables/tt-1/slots`)
      .set(adminToken);
    expect(res.status).toBe(200);
  });

  test('DELETE /timetables/:id/slots/:slotId deletes slot', async () => {
    prismaMock.timetableSlot.findUnique.mockResolvedValue({ id: 's-1' } as any);
    prismaMock.timetableSlot.delete.mockResolvedValue({} as any);
    const res = await request(app)
      .delete(`/admin/branches/${mockBranch.id}/timetables/tt-1/slots/s-1`)
      .set(adminToken);
    expect(res.status).toBe(200);
  });

  test('PUT /timetables/:id/days updates day config', async () => {
    prismaMock.timetableDayConfig.upsert.mockResolvedValue({} as any);
    const res = await request(app)
      .put(`/admin/branches/${mockBranch.id}/timetables/tt-1/days`)
      .set(adminToken)
      .send({ days: [{ dayOfWeek: 1, isActive: true }, { dayOfWeek: 2, isActive: false }] });
    expect(res.status).toBe(200);
  });

  test('GET /timetables/:id/days returns day configs', async () => {
    prismaMock.timetableDayConfig.findMany.mockResolvedValue([
      { id: 'dc-1', timetableId: 'tt-1', dayOfWeek: 1, isActive: true },
      { id: 'dc-2', timetableId: 'tt-1', dayOfWeek: 2, isActive: false },
    ] as any);
    const res = await request(app)
      .get(`/admin/branches/${mockBranch.id}/timetables/tt-1/days`)
      .set(adminToken);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
  });

  test('DELETE /timetables/:id returns 409 when entries exist', async () => {
    prismaMock.timetableSlot.findMany.mockResolvedValue([{ id: 's-1' }] as any);
    prismaMock.timetableEntry.count.mockResolvedValue(3);
    const res = await request(app)
      .delete(`/admin/branches/${mockBranch.id}/timetables/tt-1`)
      .set(adminToken);
    expect(res.status).toBe(409);
  });

  test('DELETE /timetables/:id returns 200 when slots exist but no entries', async () => {
    prismaMock.timetableSlot.findMany.mockResolvedValue([{ id: 's-1' }, { id: 's-2' }] as any);
    prismaMock.timetableEntry.count.mockResolvedValue(0);
    prismaMock.timetableDayConfig.deleteMany.mockResolvedValue({ count: 6 } as any);
    prismaMock.timetableSlot.deleteMany.mockResolvedValue({ count: 2 } as any);
    prismaMock.timetable.delete.mockResolvedValue({} as any);
    const res = await request(app)
      .delete(`/admin/branches/${mockBranch.id}/timetables/tt-1`)
      .set(adminToken);
    expect(res.status).toBe(200);
  });

  test('PUT /timetables/:id/rename returns 404 when not found', async () => {
    prismaMock.timetable.findUnique.mockResolvedValue(null);
    const res = await request(app)
      .put(`/admin/branches/${mockBranch.id}/timetables/tt-nonexistent/rename`)
      .set(adminToken)
      .send({ newName: 'New Name' });
    expect(res.status).toBe(404);
  });

  test('DELETE /timetables/:id/slots/:slotId returns 404 when slot not found', async () => {
    prismaMock.timetableSlot.findUnique.mockResolvedValue(null);
    const res = await request(app)
      .delete(`/admin/branches/${mockBranch.id}/timetables/tt-1/slots/bad-slot`)
      .set(adminToken);
    expect(res.status).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════════════════
// TIMETABLE ENTRIES (Phase 27b)
// ═══════════════════════════════════════════════════════════════════

describe('Admin — Timetable Entries', () => {
  let mockBranch: MockBranch;
  const mockSection = { id: 'sec-1', name: 'Class 1', section: 'A', isActive: true };
  const mockSlot = { id: 'slot-1', timetableId: 'tt-1', dayOfWeek: null, lectureNumber: 1, startTime: '08:00', endTime: '08:40' };

  beforeEach(() => {
    jest.clearAllMocks();
    mockBranch = createMockBranch();
  });

  test('GET section timetable returns entries', async () => {
    prismaMock.timetableEntry.findMany.mockResolvedValue([{ id: 'e-1', slotId: 'slot-1', groupId: 'sec-1', note: null, subject: { id: 'subj-1', name: 'Math', code: 'MATH' }, teacher: { id: 't-1', name: 'Ms. Sarah' } }] as any);
    const res = await request(app).get(`/admin/branches/${mockBranch.id}/sections/sec-1/timetable`).set(adminToken);
    expect(res.status).toBe(200);
    expect(res.body.data[0].subject.name).toBe('Math');
  });

  test('PUT upsert entry sets subject and teacher', async () => {
    prismaMock.timetableEntry.upsert.mockResolvedValue({ id: 'e-1', slotId: 'slot-1', groupId: 'sec-1', note: null, subject: { id: 'subj-1', name: 'Math' }, teacher: { id: 't-1', name: 'Ms. Sarah' } } as any);
    const res = await request(app)
      .put(`/admin/branches/${mockBranch.id}/sections/sec-1/timetable/slot-1`)
      .set(adminToken)
      .send({ subjectId: 'subj-1', teacherId: 't-1' });
    expect(res.status).toBe(200);
    expect(res.body.data.teacher.name).toBe('Ms. Sarah');
  });

  test('PUT upsert entry with break note', async () => {
    prismaMock.timetableEntry.upsert.mockResolvedValue({ id: 'e-2', slotId: 'slot-2', groupId: 'sec-1', note: 'break', subject: null, teacher: null } as any);
    const res = await request(app)
      .put(`/admin/branches/${mockBranch.id}/sections/sec-1/timetable/slot-2`)
      .set(adminToken)
      .send({ note: 'break', subjectId: null, teacherId: null });
    expect(res.status).toBe(200);
  });

  test('PUT upsert entry with custom subject text (datesheet)', async () => {
    prismaMock.timetableEntry.upsert.mockResolvedValue({ id: 'e-3', slotId: 'slot-3', groupId: 'sec-1', note: 'Midterm Math', subject: null, teacher: null } as any);
    const res = await request(app)
      .put(`/admin/branches/${mockBranch.id}/sections/sec-1/timetable/slot-3`)
      .set(adminToken)
      .send({ note: 'Midterm Math' });
    expect(res.status).toBe(200);
  });

  test('PUT upsert entry clears existing subject (sets to null)', async () => {
    prismaMock.timetableEntry.upsert.mockResolvedValue({ id: 'e-4', slotId: 'slot-1', groupId: 'sec-1', note: null, subject: null, teacher: { id: 't-1', name: 'Ms. Sarah' } } as any);
    const res = await request(app)
      .put(`/admin/branches/${mockBranch.id}/sections/sec-1/timetable/slot-1`)
      .set(adminToken)
      .send({ subjectId: null, teacherId: 't-1' });
    expect(res.status).toBe(200);
    expect(res.body.data.subject).toBeNull();
  });

  test('PUT upsert entry updates only teacher (subject unchanged)', async () => {
    prismaMock.timetableEntry.upsert.mockResolvedValue({ id: 'e-5', slotId: 'slot-1', groupId: 'sec-1', note: null, subject: { id: 'subj-1', name: 'Math' }, teacher: { id: 't-2', name: 'Mr. Khan' } } as any);
    const res = await request(app)
      .put(`/admin/branches/${mockBranch.id}/sections/sec-1/timetable/slot-1`)
      .set(adminToken)
      .send({ teacherId: 't-2' });
    expect(res.status).toBe(200);
    expect(res.body.data.teacher.name).toBe('Mr. Khan');
    expect(res.body.data.subject.name).toBe('Math');
  });

  test('PUT upsert entry updates only subject (teacher unchanged)', async () => {
    prismaMock.timetableEntry.upsert.mockResolvedValue({ id: 'e-6', slotId: 'slot-1', groupId: 'sec-1', note: null, subject: { id: 'subj-2', name: 'Science' }, teacher: { id: 't-1', name: 'Ms. Sarah' } } as any);
    const res = await request(app)
      .put(`/admin/branches/${mockBranch.id}/sections/sec-1/timetable/slot-1`)
      .set(adminToken)
      .send({ subjectId: 'subj-2' });
    expect(res.status).toBe(200);
    expect(res.body.data.subject.name).toBe('Science');
    expect(res.body.data.teacher.name).toBe('Ms. Sarah');
  });

  test('GET section timetable returns empty array when no entries', async () => {
    prismaMock.timetableEntry.findMany.mockResolvedValue([]);
    const res = await request(app)
      .get(`/admin/branches/${mockBranch.id}/sections/sec-1/timetable`)
      .set(adminToken);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════
// TEACHER TIMETABLES (Phase 27c)
// ═══════════════════════════════════════════════════════════════════

describe('Admin — Teacher Timetables', () => {
  let mockBranch: MockBranch;
  const mockTeacherProfile = { id: 'tp-1', userId: 'teacher-1' };
  const mockTimetable = { id: 'tt-1', name: 'Regular', type: 'timetable' };
  const mockEntries = [
    {
      id: 'e-1', slotId: 'slot-1', groupId: 'sec-1', teacherId: 'teacher-1', subjectId: 'subj-1', note: null,
      slot: { id: 'slot-1', lectureNumber: 1, startTime: '08:00', endTime: '08:40', dayOfWeek: null, timetableId: 'tt-1' },
      subject: { id: 'subj-1', name: 'Math', code: 'MATH' },
      group: { id: 'sec-1', name: 'Class 1', section: 'A' },
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    mockBranch = createMockBranch();
  });

  test('GET teacher timetables returns grouped entries', async () => {
    prismaMock.teacherProfile.findUnique.mockResolvedValue(mockTeacherProfile as any);
    prismaMock.timetableEntry.findMany.mockResolvedValue(mockEntries as any);
    prismaMock.timetable.findMany.mockResolvedValue([mockTimetable] as any);

    const res = await request(app)
      .get(`/admin/branches/${mockBranch.id}/teachers/tp-1/timetables`)
      .set(adminToken);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].name).toBe('Regular');
    expect(res.body.data[0].entries).toHaveLength(1);
    expect(res.body.data[0].entries[0].groupName).toBe('Class 1');
    expect(res.body.data[0].entries[0].lectureNumber).toBe(1);
  });

  test('GET teacher timetables returns empty array when no entries', async () => {
    prismaMock.teacherProfile.findUnique.mockResolvedValue(mockTeacherProfile as any);
    prismaMock.timetableEntry.findMany.mockResolvedValue([]);

    const res = await request(app)
      .get(`/admin/branches/${mockBranch.id}/teachers/tp-1/timetables`)
      .set(adminToken);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  test('GET teacher timetables returns 404 when teacher not found', async () => {
    prismaMock.teacherProfile.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .get(`/admin/branches/${mockBranch.id}/teachers/nonexistent/timetables`)
      .set(adminToken);
    expect(res.status).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════════════════
// FILE UPLOAD (Phase 28)
// ═══════════════════════════════════════════════════════════════════

describe('Admin — File Upload', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('POST /api/upload returns 400 when no file provided', async () => {
    const res = await request(app)
      .post('/api/upload')
      .set(adminToken);
    expect(res.status).toBe(400);
  });

  test('POST /api/upload returns 401 without auth', async () => {
    const res = await request(app).post('/api/upload');
    expect(res.status).toBe(401);
  });

  test('GET /api/uploads/:id returns 401 without auth', async () => {
    const res = await request(app).get('/api/uploads/any-id');
    expect(res.status).toBe(401);
  });

  test('GET /api/uploads/:id/meta returns file metadata', async () => {
    prismaMock.fileRecord.findUnique.mockResolvedValue({
      id: 'file-999', originalName: 'test.jpg', storagePath: '2026/06/test.jpg',
      mimeType: 'image/webp', size: 12345, width: 300, height: 300,
      uploadedById: null, createdAt: new Date(),
    } as any);

    const res = await request(app)
      .get('/api/uploads/file-999/meta')
      .set(adminToken);
    expect(res.status).toBe(200);
    expect(res.body.data.mimeType).toBe('image/webp');
    expect(res.body.data.size).toBe(12345);
  });

  test('GET /api/uploads/:id/meta returns 404 for unknown file', async () => {
    prismaMock.fileRecord.findUnique.mockResolvedValue(null);
    const res = await request(app)
      .get('/api/uploads/unknown/meta')
      .set(adminToken);
    expect(res.status).toBe(404);
  });

  // ─── File processing rules ────────────────────────────────────────

  describe('File processing rules', () => {
    const mockFileRecord = {
      id: 'file-test-1',
      originalName: 'test.svg',
      storagePath: '2026/06/test-0000-4000-8000-000000000000.svg',
      mimeType: 'image/svg+xml',
      size: 100,
      width: null,
      height: null,
      uploadedById: null,
      createdAt: new Date(),
    };

    beforeEach(() => {
      jest.clearAllMocks();
      multerMock.__resetMockFile();
      sharpMock.__resetMockSharp();
      // Default file-type result: webp
      fileTypeMock.__setFileTypeResult({ ext: 'webp', mime: 'image/webp' });
      // Default fileRecord.create mock
      prismaMock.fileRecord.create.mockResolvedValue(mockFileRecord as any);
    });

    test('SVG upload bypasses sharp, stored as image/svg+xml', async () => {
      fileTypeMock.__setFileTypeResult({ ext: 'svg', mime: 'image/svg+xml' });
      multerMock.__setMockFile({
        buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><circle cx="50" cy="50" r="40"/></svg>'),
        originalname: 'icon.svg',
        mimetype: 'image/svg+xml',
        size: 80,
      }, { purpose: 'document' });

      const res = await request(app)
        .post('/api/upload')
        .set(adminToken);

      expect(res.status).toBe(201);
      expect(prismaMock.fileRecord.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            mimeType: 'image/svg+xml',
          }),
        }),
      );
    });

    test('GIF upload bypasses sharp, stored as image/gif', async () => {
      fileTypeMock.__setFileTypeResult({ ext: 'gif', mime: 'image/gif' });
      multerMock.__setMockFile({
        buffer: Buffer.from('GIF89a...mock-gif-data'),
        originalname: 'animation.gif',
        mimetype: 'image/gif',
        size: 200,
      }, { purpose: 'document' });

      const res = await request(app)
        .post('/api/upload')
        .set(adminToken);

      expect(res.status).toBe(201);
      expect(prismaMock.fileRecord.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            mimeType: 'image/gif',
          }),
        }),
      );
    });

    test('Document purpose upload compresses with WebP without resize', async () => {
      fileTypeMock.__setFileTypeResult({ ext: 'jpeg', mime: 'image/jpeg' });
      multerMock.__setMockFile({
        buffer: Buffer.from('mock-jpeg-data'),
        originalname: 'photo.jpg',
        mimetype: 'image/jpeg',
        size: 50000,
      }, { purpose: 'document' });

      const res = await request(app)
        .post('/api/upload')
        .set(adminToken);

      expect(res.status).toBe(201);
      // Should be stored as WebP (compressed)
      expect(prismaMock.fileRecord.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            mimeType: 'image/webp',
          }),
        }),
      );
      // Should NOT have been resized (purpose=document means compress only)
      expect(sharpMock.__resizeCalled).toBe(false);
    });
  });

  // ─── Entity-based document listing ────────────────────────────────

  describe('Entity-based document listing', () => {
    const mockFiles = [
      { id: 'f-1', originalName: 'doc1.pdf', mimeType: 'application/pdf', size: 5000, createdAt: new Date('2026-01-01') },
      { id: 'f-2', originalName: 'doc2.jpg', mimeType: 'image/webp', size: 3000, createdAt: new Date('2026-01-02') },
    ];

    beforeEach(() => {
      jest.clearAllMocks();
    });

    test('POST /api/upload accepts entityType + entityId', async () => {
      fileTypeMock.__setFileTypeResult({ ext: 'jpeg', mime: 'image/jpeg' });
      multerMock.__setMockFile({
        buffer: Buffer.from('mock-data'),
        originalname: 'report.pdf',
        mimetype: 'application/pdf',
        size: 1000,
      }, { purpose: 'document', entityType: 'student', entityId: 'stu-123' });
      prismaMock.fileRecord.create.mockResolvedValue({
        id: 'f-new', originalName: 'report.pdf', mimeType: 'image/webp', size: 800, storagePath: '2026/06/test.webp',
      } as any);

      const res = await request(app)
        .post('/api/upload')
        .set(adminToken);

      expect(res.status).toBe(201);
      expect(prismaMock.fileRecord.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            entityType: 'student',
            entityId: 'stu-123',
          }),
        }),
      );
    });

    test('GET /api/uploads lists files for entity', async () => {
      prismaMock.fileRecord.findMany.mockResolvedValue(mockFiles as any);

      const res = await request(app)
        .get('/api/uploads?entityType=student&entityId=stu-123')
        .set(adminToken);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.data[0].originalName).toBe('doc1.pdf');
      expect(prismaMock.fileRecord.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { entityType: 'student', entityId: 'stu-123' },
        }),
      );
    });

    test('GET /api/uploads returns 400 without entityType', async () => {
      const res = await request(app)
        .get('/api/uploads?entityId=stu-123')
        .set(adminToken);
      expect(res.status).toBe(400);
    });

    test('GET /api/uploads returns 400 with invalid entityType', async () => {
      const res = await request(app)
        .get('/api/uploads?entityType=admin&entityId=xyz')
        .set(adminToken);
      expect(res.status).toBe(400);
    });

    test('GET /api/uploads returns 401 without auth', async () => {
      const res = await request(app).get('/api/uploads?entityType=student&entityId=stu-123');
      expect(res.status).toBe(401);
    });

    test('POST /api/upload returns 400 with invalid entityType', async () => {
      multerMock.__setMockFile({
        buffer: Buffer.from('data'),
        originalname: 'test.txt',
        mimetype: 'text/plain',
        size: 100,
      }, { purpose: 'document', entityType: 'invalidType', entityId: 'x' });

      const res = await request(app)
        .post('/api/upload')
        .set(adminToken);
      expect(res.status).toBe(400);
      expect(res.body.message).toContain('entityType');
    });
  });
});
// ═══════════════════════════════════════════════════════════════════

describe('Admin — Teacher Profile Photo', () => {
  const mockUser = { id: 'teacher-u-1', name: 'Ms. Sarah', email: 'sarah@school.com', phone: null, role: 'teacher', status: 'active', profilePhotoId: null };
  const mockProfile = {
    id: 'tp-1', userId: 'teacher-u-1', employeeId: 'TCH-001', qualification: 'M.Sc. Mathematics',
    specialization: 'Mathematics', joiningDate: new Date('2024-01-15'), salary: null,
    phone: '1234567890', emergencyContact: null, address: '123 School St', dateOfBirth: null,
    gender: 'female', bloodGroup: null, fatherName: null, cardId: null,
    severeDisease: null, experience: null, bio: null,
    createdAt: new Date(), updatedAt: new Date(),
    user: mockUser,
  };
  let mockBranch: MockBranch;

  beforeEach(() => {
    jest.clearAllMocks();
    mockBranch = createMockBranch();
  });

  test('POST /admin/teachers creates teacher with profilePhotoId', async () => {
    prismaMock.teacherProfile.findUnique.mockResolvedValue(null);
    prismaMock.user.findUnique.mockResolvedValue(mockUser as any);
    const extendedProfile = { ...mockProfile, user: { ...mockUser, profilePhotoId: 'file-123' } };
    prismaMock.teacherProfile.create.mockResolvedValue(extendedProfile as any);
    prismaMock.user.update.mockResolvedValue(mockUser as any);

    const res = await request(app)
      .post('/admin/teachers')
      .send({ userId: 'teacher-u-1', profilePhotoId: 'file-123' })
      .set(adminToken);

    expect(res.status).toBe(201);
    expect(res.body.data.user.profilePhotoId).toBe('file-123');
  });

  test('PUT /admin/teachers/:id updates profilePhotoId', async () => {
    prismaMock.teacherProfile.findUnique.mockResolvedValue(mockProfile as any);
    const updated = { ...mockProfile, user: { ...mockUser, profilePhotoId: 'file-456' } };
    prismaMock.teacherProfile.update.mockResolvedValue(updated as any);
    prismaMock.user.update.mockResolvedValue(mockUser as any);

    const res = await request(app)
      .put('/admin/teachers/tp-1')
      .send({ profilePhotoId: 'file-456' })
      .set(adminToken);

    expect(res.status).toBe(200);
    expect(prismaMock.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ profilePhotoId: 'file-456' }),
      }),
    );
  });

  test('PUT /admin/teachers/:id clears profilePhotoId when set to null', async () => {
    prismaMock.teacherProfile.findUnique.mockResolvedValue(mockProfile as any);
    prismaMock.teacherProfile.update.mockResolvedValue(mockProfile as any);
    prismaMock.user.update.mockResolvedValue(mockUser as any);

    const res = await request(app)
      .put('/admin/teachers/tp-1')
      .send({ profilePhotoId: null })
      .set(adminToken);

    expect(res.status).toBe(200);
    expect(prismaMock.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ profilePhotoId: null }),
      }),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════
// ADDITIONAL EDGE CASES
// ═══════════════════════════════════════════════════════════════════

describe('Additional — Branch Empty List', () => {
  let mockBranch: MockBranch;
  beforeEach(() => { jest.clearAllMocks(); mockBranch = createMockBranch(); });

  test('GET /admin/branches returns empty array', async () => {
    prismaMock.branch.findMany.mockResolvedValue([]);
    const res = await request(app).get('/admin/branches').set(adminToken);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });
});

describe('Additional — Section Edge Cases', () => {
  let mockBranch: MockBranch;
  beforeEach(() => { jest.clearAllMocks(); mockBranch = createMockBranch(); });

  test('GET sections returns empty', async () => {
    prismaMock.group.findMany.mockResolvedValue([]);
    const res = await request(app).get(`/admin/branches/${mockBranch.id}/academic-years/ay-1/sections`).set(adminToken);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  test('DELETE section returns 404 for unknown', async () => {
    prismaMock.group.findUnique.mockResolvedValue(null);
    const res = await request(app).delete(`/admin/branches/${mockBranch.id}/sections/unknown`).set(adminToken);
    expect(res.status).toBe(404);
  });
});

describe('Additional — Timetable Days Invalid', () => {
  let mockBranch: MockBranch;
  beforeEach(() => { jest.clearAllMocks(); mockBranch = createMockBranch(); });

  test('PUT days with non-array returns 400', async () => {
    const res = await request(app).put(`/admin/branches/${mockBranch.id}/timetables/tt-1/days`).set(adminToken).send({ days: 'invalid' });
    expect(res.status).toBe(400);
  });
});

describe('Additional — Assignment Edge', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  test('POST assignment with missing fields returns 400', async () => {
    const res = await request(app).post('/admin/assignments').set(adminToken).send({});
    expect(res.status).toBe(400);
  });
});

describe('Additional — Upload 404', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  test('GET /api/uploads/:id returns 404 for unknown', async () => {
    prismaMock.fileRecord.findUnique.mockResolvedValue(null);
    const res = await request(app).get('/api/uploads/unknown').set(adminToken);
    expect(res.status).toBe(404);
  });
});
