/**
 * Attendance Routes Tests
 *
 * Tests student and teacher attendance GET/POST endpoints.
 * Uses supertest against the real Express app with mocked Prisma.
 */

jest.mock('bcryptjs', () => ({
  hash: jest.fn().mockResolvedValue('$2a$12$mocked_hash_for_testing'),
  compare: jest.fn().mockResolvedValue(true),
}));

import { prismaMock } from '../../mocks/prisma';
import request from 'supertest';
import app from '../../../src/app';
import { createMockUser, createMockStudent } from '../../helpers/factories';
import { generateTestToken, getAuthHeader } from '../../helpers/auth';

const adminToken = getAuthHeader(generateTestToken('admin-1', 'super_admin'));
const managementToken = getAuthHeader(generateTestToken('mgmt-1', 'management'));
const SCOPE_QS = 'academicYearId=ay1&branchId=b1';

function mockScope() {
  (prismaMock.academicYear.findUnique as jest.Mock).mockResolvedValue({ id: 'ay1', branchId: 'b1' });
}

// ═══════════════════════════════════════════════════════════════════
// STUDENT ATTENDANCE
// ═══════════════════════════════════════════════════════════════════

describe('GET /admin/attendance — Student attendance', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockScope();
  });

  test('returns all students when no groupId', async () => {
    const students = [createMockStudent({ id: 's1', name: 'Alice' }), createMockStudent({ id: 's2', name: 'Bob' })];
    (prismaMock.student.findMany as jest.Mock).mockResolvedValue(students);
    const res = await request(app).get(`/admin/attendance?date=2026-06-24&${SCOPE_QS}`).set(adminToken);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(2);
    expect(prismaMock.student.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          isActive: true,
          academicYearId: 'ay1',
          academicYear: { branchId: 'b1' },
        }),
      }),
    );
  });

  test('filters by groupId when provided', async () => {
    (prismaMock.group.findFirst as jest.Mock).mockResolvedValue({ id: 'g1' });
    (prismaMock.student.findMany as jest.Mock).mockResolvedValue([]);
    await request(app).get(`/admin/attendance?date=2026-06-24&groupId=g1&${SCOPE_QS}`).set(adminToken);
    expect(prismaMock.student.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ groupId: 'g1', academicYearId: 'ay1' }) }),
    );
  });

  test('returns 400 without academic year scope', async () => {
    (prismaMock.academicYear.findFirst as jest.Mock).mockResolvedValue(null);
    const res = await request(app).get('/admin/attendance?date=2026-06-24').set(adminToken);
    expect(res.status).toBe(400);
  });

  test('returns 401 without auth header', async () => {
    const res = await request(app).get(`/admin/attendance?date=2026-06-24&${SCOPE_QS}`);
    expect(res.status).toBe(401);
  });

  test('returns 403 for non-management role', async () => {
    const teacherToken = getAuthHeader(generateTestToken('t1', 'teacher'));
    const res = await request(app).get(`/admin/attendance?date=2026-06-24&${SCOPE_QS}`).set(teacherToken);
    expect(res.status).toBe(403);
  });

  test('orders by name when no groupId', async () => {
    (prismaMock.student.findMany as jest.Mock).mockResolvedValue([]);
    await request(app).get(`/admin/attendance?date=2026-06-24&${SCOPE_QS}`).set(adminToken);
    const call = (prismaMock.student.findMany as jest.Mock).mock.calls[0][0];
    expect(call.orderBy).toEqual([{ name: 'asc' }]);
  });

  test('orders by rollNumber when groupId provided', async () => {
    (prismaMock.group.findFirst as jest.Mock).mockResolvedValue({ id: 'g1' });
    (prismaMock.student.findMany as jest.Mock).mockResolvedValue([]);
    await request(app).get(`/admin/attendance?date=2026-06-24&groupId=g1&${SCOPE_QS}`).set(adminToken);
    const call = (prismaMock.student.findMany as jest.Mock).mock.calls[0][0];
    expect(call.orderBy).toEqual([{ rollNumber: 'asc' }]);
  });

  test('includes attendance records for given date', async () => {
    (prismaMock.student.findMany as jest.Mock).mockResolvedValue([{ id: 's1', name: 'Alice', rollNumber: '1', admissionNumber: 'ADM-1', groupId: 'g1', attendances: [{ date: '2026-06-24', status: 'present' }] }]);
    const res = await request(app).get(`/admin/attendance?date=2026-06-24&${SCOPE_QS}`).set(adminToken);
    expect(res.body.data[0].attendances).toBeDefined();
  });

  test('includes attendance records for date range', async () => {
    (prismaMock.student.findMany as jest.Mock).mockResolvedValue([{ id: 's1', name: 'Alice', rollNumber: '1', admissionNumber: 'ADM-1', groupId: 'g1', attendances: [] }]);
    const res = await request(app).get(`/admin/attendance?from=2026-06-01&to=2026-06-30&${SCOPE_QS}`).set(adminToken);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe('POST /admin/attendance/batch — Save attendance', () => {
  beforeEach(() => jest.clearAllMocks());

  test('saves attendance for multiple students', async () => {
    (prismaMock.attendance.upsert as jest.Mock).mockResolvedValue({});
    const res = await request(app)
      .post('/admin/attendance/batch')
      .set(managementToken)
      .send({ date: '2026-06-24', groupId: 'g1', academicYearId: 'ay1', records: [{ studentId: 's1', status: 'present' }] });
    expect(res.status).toBe(200);
    expect(prismaMock.attendance.upsert).toHaveBeenCalledTimes(1);
  });

  test('returns 400 without groupId', async () => {
    const res = await request(app)
      .post('/admin/attendance/batch')
      .set(managementToken)
      .send({ date: '2026-06-24', records: [] });
    expect(res.status).toBe(400);
  });

  test('returns 400 without date', async () => {
    const res = await request(app)
      .post('/admin/attendance/batch')
      .set(managementToken)
      .send({ groupId: 'g1', records: [] });
    expect(res.status).toBe(400);
  });

  test('returns 400 for future dates', async () => {
    const res = await request(app)
      .post('/admin/attendance/batch')
      .set(managementToken)
      .send({ date: '2099-01-01', groupId: 'g1', academicYearId: 'ay1', records: [{ studentId: 's1', status: 'present' }] });
    expect(res.status).toBe(400);
  });

  test('sets markedById from authenticated user', async () => {
    (prismaMock.attendance.upsert as jest.Mock).mockResolvedValue({});
    (prismaMock.academicYear.findFirst as jest.Mock).mockResolvedValue({ id: 'ay1' });
    await request(app)
      .post('/admin/attendance/batch')
      .set(adminToken)
      .send({ date: '2026-06-24', groupId: 'g1', records: [{ studentId: 's1', status: 'present' }] });
    const call = (prismaMock.attendance.upsert as jest.Mock).mock.calls[0][0];
    expect(call.create.markedById).toBe('admin-1');
  });

  test('upserts existing records instead of creating duplicates', async () => {
    (prismaMock.attendance.upsert as jest.Mock).mockResolvedValue({});
    await request(app)
      .post('/admin/attendance/batch')
      .set(managementToken)
      .send({ date: '2026-06-24', groupId: 'g1', academicYearId: 'ay1', records: [{ studentId: 's1', status: 'present' }] });
    expect(prismaMock.attendance.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { studentId_date: { studentId: 's1', date: expect.any(Date) } } })
    );
  });
});

// ═══════════════════════════════════════════════════════════════════
// TEACHER ATTENDANCE
// ═══════════════════════════════════════════════════════════════════

describe('GET /admin/attendance/teachers — Teacher attendance', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockScope();
  });

  test('returns all active teachers', async () => {
    (prismaMock.user.findMany as jest.Mock).mockResolvedValue([{ id: 't1', name: 'Teacher A', role: 'teacher', teacherAttendances: [] }]);
    const res = await request(app).get(`/admin/attendance/teachers?date=2026-06-24&${SCOPE_QS}`).set(adminToken);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(prismaMock.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          role: 'teacher',
          status: 'active',
          branchMembers: { some: { branchId: 'b1', isActive: true } },
        }),
      }),
    );
  });

  test('returns 401 without auth', async () => {
    const res = await request(app).get(`/admin/attendance/teachers?date=2026-06-24&${SCOPE_QS}`);
    expect(res.status).toBe(401);
  });

  test('includes teacher attendances', async () => {
    (prismaMock.user.findMany as jest.Mock).mockResolvedValue([{ id: 't1', name: 'Teacher A', teacherAttendances: [{ date: '2026-06-24', status: 'present' }] }]);
    const res = await request(app).get(`/admin/attendance/teachers?date=2026-06-24&${SCOPE_QS}`).set(adminToken);
    expect(res.body.data[0].attendances).toBeDefined();
  });
});

describe('POST /admin/attendance/teachers/batch — Save teacher attendance', () => {
  beforeEach(() => jest.clearAllMocks());

  test('saves teacher attendance', async () => {
    (prismaMock.teacherAttendance.upsert as jest.Mock).mockResolvedValue({});
    const res = await request(app)
      .post('/admin/attendance/teachers/batch')
      .set(managementToken)
      .send({ date: '2026-06-24', academicYearId: 'ay1', records: [{ teacherId: 't1', status: 'present' }] });
    expect(res.status).toBe(200);
    expect(prismaMock.teacherAttendance.upsert).toHaveBeenCalledTimes(1);
  });

  test('returns 400 without records', async () => {
    const res = await request(app)
      .post('/admin/attendance/teachers/batch')
      .set(managementToken)
      .send({ date: '2026-06-24' });
    expect(res.status).toBe(400);
  });

  test('returns 400 without date', async () => {
    const res = await request(app)
      .post('/admin/attendance/teachers/batch')
      .set(managementToken)
      .send({ records: [] });
    expect(res.status).toBe(400);
  });
});
