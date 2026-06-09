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
  let mockCalendar: MockAcademicCalendar;

  beforeEach(() => {
    jest.clearAllMocks();
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
        .get(`/admin/academic-years/${mockAcademicYear.id}`)
        .set(adminToken);

      expect(res.status).toBe(200);
      expect(res.body.data._count.groups).toBe(1);
      expect(res.body.data.groups).toHaveLength(1);
      expect(res.body.data.branch.name).toBe(mockBranch.name);
    });

    test('returns 404 when not found', async () => {
      prismaMock.academicYear.findUnique.mockResolvedValue(null);
      const res = await request(app).get('/admin/academic-years/non-existent').set(adminToken);
      expect(res.status).toBe(404);
    });
  });

  describe('PATCH /admin/academic-years/:id/publish — Publish AY (BA-019, BA-013)', () => {
    test('publishes BUILD_STAGE → ACTIVE', async () => {
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
        .patch(`/admin/academic-years/${mockAcademicYear.id}/publish`)
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
        .patch(`/admin/academic-years/${mockAcademicYear.id}/publish`)
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
        .patch(`/admin/academic-years/${mockAcademicYear.id}/publish`)
        .set(adminToken);

      expect(res.status).toBe(400);
    });
  });

  describe('DELETE /admin/academic-years/:id — Delete AY (BA-020, BA-014)', () => {
    test('deletes an ARCHIVED year', async () => {
      prismaMock.academicYear.findUnique.mockResolvedValue({
        ...mockAcademicYear,
        status: 'ARCHIVED',
        _count: { groups: 0, students: 0, members: 0 },
      } as any);
      prismaMock.academicYear.delete.mockResolvedValue(mockAcademicYear as any);

      const res = await request(app)
        .delete(`/admin/academic-years/${mockAcademicYear.id}`)
        .set(adminToken);

      expect(res.status).toBe(204);
    });

    test('returns 409 when deleting ACTIVE year', async () => {
      prismaMock.academicYear.findUnique.mockResolvedValue({
        ...mockAcademicYear,
        status: 'ACTIVE',
        _count: { groups: 0, students: 0, members: 0 },
      } as any);

      const res = await request(app)
        .delete(`/admin/academic-years/${mockAcademicYear.id}`)
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
        .delete(`/admin/academic-years/${mockAcademicYear.id}`)
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
  let mockAcademicYear: MockAcademicYear;
  let mockUser: MockUser;

  beforeEach(() => {
    jest.clearAllMocks();
    mockAcademicYear = createMockAcademicYear();
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
      .post(`/admin/academic-years/${mockAcademicYear.id}/members`)
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
      .post(`/admin/academic-years/${mockAcademicYear.id}/members`)
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
      .delete(`/admin/academic-years/${mockAcademicYear.id}/members/${mockUser.id}`)
      .set(adminToken);

    expect(res.status).toBe(204);
  });

  test('DELETE returns 404 when membership not found', async () => {
    prismaMock.academicYearMember.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .delete(`/admin/academic-years/${mockAcademicYear.id}/members/${mockUser.id}`)
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
  let mockUser: MockUser;

  beforeEach(() => {
    jest.clearAllMocks();
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
  let mockGroup: MockGroup;

  beforeEach(() => {
    jest.clearAllMocks();
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
  let mockStudent: MockStudent;

  beforeEach(() => {
    jest.clearAllMocks();
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
    (prismaMock.branchMember.groupBy as jest.Mock).mockResolvedValue([
      { role: 'branch_admin', _count: 1 },
      { role: 'teacher', _count: 5 },
      { role: 'management', _count: 2 },
    ]);
    prismaMock.student.count.mockResolvedValue(150);
    prismaMock.group.count.mockResolvedValue(12);
    prismaMock.branchMember.findMany.mockResolvedValue([
      { user: { id: 'u-1', name: 'Admin One', email: 'admin@test.com', phone: null, status: 'active' }, createdAt: new Date('2025-01-01') },
    ] as any);

    const res = await request(app).get(`/admin/branches/${mockBranch.id}/stats`).set(adminToken);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      name: 'Test Branch',
      code: 'TST',
      stats: { totalStaff: 8, totalTeachers: 5, totalStudents: 150, totalClasses: 12, totalAcademicYears: 2 },
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
    prismaMock.branchMember.findMany.mockResolvedValue([]);

    const res = await request(app).get(`/admin/branches/${mockBranch.id}/stats`).set(adminToken);

    expect(res.status).toBe(200);
    expect(res.body.data.admins).toHaveLength(0);
    expect(res.body.data.stats.totalStaff).toBe(0);
  });
});
