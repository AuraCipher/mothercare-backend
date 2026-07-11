/**
 * Tenure routes integration tests — branch members, students, teachers, class movements.
 */

jest.mock('bcryptjs', () => ({
  hash: jest.fn().mockResolvedValue('$2a$12$mocked_hash_for_testing'),
  compare: jest.fn().mockResolvedValue(true),
}));

jest.mock('../../../src/modules/admin/services/tenure.service', () => ({
  tenureService: {
    listBranchTenures: jest.fn().mockResolvedValue([]),
    recordBranchJoin: jest.fn().mockResolvedValue({ id: 't1' }),
    recordBranchLeave: jest.fn().mockResolvedValue({ id: 't1' }),
    listStudentSchoolTenures: jest.fn().mockResolvedValue([]),
    recordStudentJoin: jest.fn().mockResolvedValue({ id: 'st1' }),
    recordStudentLeave: jest.fn().mockResolvedValue({ id: 'st1' }),
    recordClassMovement: jest.fn().mockResolvedValue({ id: 'cm1' }),
  },
}));

import request from 'supertest';
import { prismaMock } from '../../mocks/prisma';
import app from '../../../src/app';
import { tenureService } from '../../../src/modules/admin/services/tenure.service';
import {
  adminAuth,
  branchQuery,
  scopeQuery,
  mockActiveAcademicYear,
  mockStudentWithPerson,
  TEST_BRANCH_ID,
  TEST_AY_ID,
} from '../../helpers/integration';

const END_REASONS = [
  'RESIGNED',
  'TERMINATED',
  'TRANSFERRED',
  'GRADUATED',
  'WITHDRAWN',
  'DECEASED',
  'LEAVE',
  'REJOINED',
  'OTHER',
] as const;

const STUDENT_IDS = ['s1', 's2', 's3', 's4', 's5'];
const MEMBER_IDS = ['bm-1', 'bm-2', 'bm-3', 'bm-4', 'bm-5'];
const TEACHER_USER_IDS = ['t1', 't2', 't3', 't4', 't5'];
const GROUP_IDS = ['g1', 'g2', 'g3', 'g4', 'g5'];

function setupScope() {
  mockActiveAcademicYear();
}

function mockStudentNotFound() {
  (prismaMock.student.findUnique as jest.Mock).mockResolvedValue(null);
}

function mockStudentMissingPerson(studentId = 's1') {
  (prismaMock.student.findUnique as jest.Mock).mockResolvedValue({ id: studentId, personId: null });
}

function mockStudentForClassMovement(studentId = 's1', groupId = 'g1') {
  (prismaMock.student.findUnique as jest.Mock).mockResolvedValue({ id: studentId, groupId });
}

function mockTeacherNotInBranch() {
  (prismaMock.branchMember.findUnique as jest.Mock).mockResolvedValue(null);
}

function mockTeacherInBranch(userId = 't1', memberId = 'bm-t1') {
  (prismaMock.branchMember.findUnique as jest.Mock).mockResolvedValue({ id: memberId });
}

beforeEach(() => {
  jest.clearAllMocks();
  (prismaMock.branch.findUnique as jest.Mock).mockResolvedValue({ id: TEST_BRANCH_ID, code: 'MAIN' });
  (tenureService.listBranchTenures as jest.Mock).mockResolvedValue([]);
  (tenureService.recordBranchJoin as jest.Mock).mockResolvedValue({ id: 't1' });
  (tenureService.recordBranchLeave as jest.Mock).mockResolvedValue({ id: 't1' });
  (tenureService.listStudentSchoolTenures as jest.Mock).mockResolvedValue([]);
  (tenureService.recordStudentJoin as jest.Mock).mockResolvedValue({ id: 'st1' });
  (tenureService.recordStudentLeave as jest.Mock).mockResolvedValue({ id: 'st1' });
  (tenureService.recordClassMovement as jest.Mock).mockResolvedValue({ id: 'cm1' });
});

// ─── GET /admin/branch-members/:id/tenures ───────────────────────────

describe('GET /admin/branch-members/:branchMemberId/tenures', () => {
  test('401 without auth token', async () => {
    const res = await request(app).get('/admin/branch-members/bm-1/tenures');
    expect(res.status).toBe(401);
  });

  test('200 returns empty tenure list', async () => {
    const res = await request(app)
      .get('/admin/branch-members/bm-1/tenures')
      .set(adminAuth);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual([]);
    expect(tenureService.listBranchTenures).toHaveBeenCalledWith('bm-1');
  });

  test('200 returns tenure data from service', async () => {
    const rows = [{ id: 'bt1', sequence: 1, joinedAt: '2024-01-01' }];
    (tenureService.listBranchTenures as jest.Mock).mockResolvedValue(rows);
    const res = await request(app)
      .get('/admin/branch-members/bm-99/tenures')
      .set(adminAuth);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(rows);
  });

  test.each(MEMBER_IDS)('200 lists tenures for member %s', async (memberId) => {
    const res = await request(app)
      .get(`/admin/branch-members/${memberId}/tenures`)
      .set(adminAuth);
    expect(res.status).toBe(200);
    expect(tenureService.listBranchTenures).toHaveBeenCalledWith(memberId);
  });
});

// ─── POST /admin/branch-members/:id/tenures/join ─────────────────────

describe('POST /admin/branch-members/:branchMemberId/tenures/join', () => {
  test('401 without auth token', async () => {
    const res = await request(app).post('/admin/branch-members/bm-1/tenures/join').send({});
    expect(res.status).toBe(401);
  });

  test('201 records join with default date', async () => {
    const res = await request(app)
      .post('/admin/branch-members/bm-1/tenures/join')
      .set(adminAuth)
      .send({});
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBe('t1');
    expect(tenureService.recordBranchJoin).toHaveBeenCalledWith(
      'bm-1',
      expect.any(Date),
      'admin-1',
      undefined,
    );
  });

  test.each([
    '2024-06-01T00:00:00.000Z',
    '2025-01-15T12:00:00.000Z',
    '2026-03-20T08:30:00.000Z',
  ])('201 records join with joinedAt %s', async (joinedAt) => {
    const res = await request(app)
      .post('/admin/branch-members/bm-2/tenures/join')
      .set(adminAuth)
      .send({ joinedAt });
    expect(res.status).toBe(201);
    expect(tenureService.recordBranchJoin).toHaveBeenCalledWith(
      'bm-2',
      new Date(joinedAt),
      'admin-1',
      undefined,
    );
  });

  test.each(['prev-1', 'prev-2', 'prev-3'])('201 records join with previousTenureId %s', async (previousTenureId) => {
    const res = await request(app)
      .post('/admin/branch-members/bm-3/tenures/join')
      .set(adminAuth)
      .send({ previousTenureId });
    expect(res.status).toBe(201);
    expect(tenureService.recordBranchJoin).toHaveBeenCalledWith(
      'bm-3',
      expect.any(Date),
      'admin-1',
      previousTenureId,
    );
  });

  test.each(MEMBER_IDS)('201 join succeeds for member %s', async (memberId) => {
    const res = await request(app)
      .post(`/admin/branch-members/${memberId}/tenures/join`)
      .set(adminAuth)
      .send({});
    expect(res.status).toBe(201);
    expect(tenureService.recordBranchJoin).toHaveBeenCalledWith(
      memberId,
      expect.any(Date),
      'admin-1',
      undefined,
    );
  });
});

// ─── POST /admin/branch-members/:id/tenures/leave ────────────────────

describe('POST /admin/branch-members/:branchMemberId/tenures/leave', () => {
  test('401 without auth token', async () => {
    const res = await request(app)
      .post('/admin/branch-members/bm-1/tenures/leave')
      .send({ endReason: 'RESIGNED' });
    expect(res.status).toBe(401);
  });

  test.each([
    ['empty body', {}],
    ['missing endReason key', { leftAt: '2024-01-01', notes: 'note' }],
    ['empty endReason', { endReason: '' }],
  ])('400 when %s', async (_label, body) => {
    const res = await request(app)
      .post('/admin/branch-members/bm-1/tenures/leave')
      .set(adminAuth)
      .send(body);
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Valid endReason is required');
    expect(tenureService.recordBranchLeave).not.toHaveBeenCalled();
  });

  test.each(END_REASONS)('200 records leave with endReason %s', async (endReason) => {
    const res = await request(app)
      .post('/admin/branch-members/bm-1/tenures/leave')
      .set(adminAuth)
      .send({ endReason });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(tenureService.recordBranchLeave).toHaveBeenCalledWith(
      'bm-1',
      expect.any(Date),
      endReason,
      undefined,
    );
  });

  test.each([
    '2024-06-01T00:00:00.000Z',
    '2025-01-15T12:00:00.000Z',
    '2026-03-20T08:30:00.000Z',
  ])('200 records leave with leftAt %s', async (leftAt) => {
    const res = await request(app)
      .post('/admin/branch-members/bm-2/tenures/leave')
      .set(adminAuth)
      .send({ endReason: 'RESIGNED', leftAt });
    expect(res.status).toBe(200);
    expect(tenureService.recordBranchLeave).toHaveBeenCalledWith(
      'bm-2',
      new Date(leftAt),
      'RESIGNED',
      undefined,
    );
  });

  test('200 records leave with notes', async () => {
    const res = await request(app)
      .post('/admin/branch-members/bm-3/tenures/leave')
      .set(adminAuth)
      .send({ endReason: 'TERMINATED', notes: 'End of contract' });
    expect(res.status).toBe(200);
    expect(tenureService.recordBranchLeave).toHaveBeenCalledWith(
      'bm-3',
      expect.any(Date),
      'TERMINATED',
      'End of contract',
    );
  });

  test.each(MEMBER_IDS)('200 leave succeeds for member %s', async (memberId) => {
    const res = await request(app)
      .post(`/admin/branch-members/${memberId}/tenures/leave`)
      .set(adminAuth)
      .send({ endReason: 'OTHER' });
    expect(res.status).toBe(200);
    expect(tenureService.recordBranchLeave).toHaveBeenCalledWith(
      memberId,
      expect.any(Date),
      'OTHER',
      undefined,
    );
  });
});

// ─── GET /admin/students/:studentId/school-tenures ───────────────────

describe('GET /admin/students/:studentId/school-tenures', () => {
  test('401 without auth token', async () => {
    const res = await request(app).get('/admin/students/s1/school-tenures').query(branchQuery);
    expect(res.status).toBe(401);
  });

  test('404 when student not found', async () => {
    mockStudentNotFound();
    const res = await request(app)
      .get('/admin/students/s-missing/school-tenures')
      .query(branchQuery)
      .set(adminAuth);
    expect(res.status).toBe(404);
    expect(res.body.message).toBe('Student person record not found');
    expect(tenureService.listStudentSchoolTenures).not.toHaveBeenCalled();
  });

  test('404 when student has no personId', async () => {
    mockStudentMissingPerson('s-no-person');
    const res = await request(app)
      .get('/admin/students/s-no-person/school-tenures')
      .query(branchQuery)
      .set(adminAuth);
    expect(res.status).toBe(404);
    expect(res.body.message).toBe('Student person record not found');
  });

  test.each(STUDENT_IDS)('404 when student %s not found', async (studentId) => {
    (prismaMock.student.findUnique as jest.Mock).mockResolvedValue(null);
    const res = await request(app)
      .get(`/admin/students/${studentId}/school-tenures`)
      .query(branchQuery)
      .set(adminAuth);
    expect(res.status).toBe(404);
  });

  test('200 returns empty school tenure list', async () => {
    mockStudentWithPerson('s1', 'person-1');
    const res = await request(app)
      .get('/admin/students/s1/school-tenures')
      .query(branchQuery)
      .set(adminAuth);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual([]);
    expect(tenureService.listStudentSchoolTenures).toHaveBeenCalledWith('person-1');
  });

  test('200 returns school tenure data', async () => {
    mockStudentWithPerson('s2', 'person-2');
    const rows = [{ id: 'st1', sequence: 1 }];
    (tenureService.listStudentSchoolTenures as jest.Mock).mockResolvedValue(rows);
    const res = await request(app)
      .get('/admin/students/s2/school-tenures')
      .query(branchQuery)
      .set(adminAuth);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(rows);
  });

  test.each(STUDENT_IDS)('200 lists school tenures for student %s', async (studentId) => {
    mockStudentWithPerson(studentId, `person-${studentId}`);
    const res = await request(app)
      .get(`/admin/students/${studentId}/school-tenures`)
      .query(branchQuery)
      .set(adminAuth);
    expect(res.status).toBe(200);
    expect(tenureService.listStudentSchoolTenures).toHaveBeenCalledWith(`person-${studentId}`);
  });
});

// ─── POST /admin/students/:studentId/school-tenures/join ─────────────

describe('POST /admin/students/:studentId/school-tenures/join', () => {
  test('401 without auth token', async () => {
    const res = await request(app)
      .post('/admin/students/s1/school-tenures/join')
      .query(scopeQuery)
      .send({});
    expect(res.status).toBe(401);
  });

  test('400 when academic year scope is missing', async () => {
    (prismaMock.academicYear.findFirst as jest.Mock).mockResolvedValue(null);
    mockStudentWithPerson();
    const res = await request(app)
      .post('/admin/students/s1/school-tenures/join')
      .query(branchQuery)
      .set(adminAuth)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('No academic year specified');
  });

  test('404 when student not found', async () => {
    setupScope();
    mockStudentNotFound();
    const res = await request(app)
      .post('/admin/students/s-missing/school-tenures/join')
      .query(scopeQuery)
      .set(adminAuth)
      .send({});
    expect(res.status).toBe(404);
    expect(res.body.message).toBe('Student person record not found');
  });

  test.each(STUDENT_IDS)('404 when student %s not found', async (studentId) => {
    setupScope();
    (prismaMock.student.findUnique as jest.Mock).mockResolvedValue(null);
    const res = await request(app)
      .post(`/admin/students/${studentId}/school-tenures/join`)
      .query(scopeQuery)
      .set(adminAuth)
      .send({});
    expect(res.status).toBe(404);
  });

  test('201 records student school join', async () => {
    setupScope();
    mockStudentWithPerson('s1', 'person-1');
    const res = await request(app)
      .post('/admin/students/s1/school-tenures/join')
      .query(scopeQuery)
      .set(adminAuth)
      .send({});
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(tenureService.recordStudentJoin).toHaveBeenCalledWith(
      'person-1',
      TEST_BRANCH_ID,
      expect.any(Date),
      'admin-1',
    );
  });

  test.each([
    '2024-06-01T00:00:00.000Z',
    '2025-01-15T12:00:00.000Z',
    '2026-03-20T08:30:00.000Z',
  ])('201 records join with joinedAt %s', async (joinedAt) => {
    setupScope();
    mockStudentWithPerson('s3', 'person-3');
    const res = await request(app)
      .post('/admin/students/s3/school-tenures/join')
      .query(scopeQuery)
      .set(adminAuth)
      .send({ joinedAt });
    expect(res.status).toBe(201);
    expect(tenureService.recordStudentJoin).toHaveBeenCalledWith(
      'person-3',
      TEST_BRANCH_ID,
      new Date(joinedAt),
      'admin-1',
    );
  });

  test.each(STUDENT_IDS)('201 join succeeds for student %s', async (studentId) => {
    setupScope();
    mockStudentWithPerson(studentId, `person-${studentId}`);
    const res = await request(app)
      .post(`/admin/students/${studentId}/school-tenures/join`)
      .query(scopeQuery)
      .set(adminAuth)
      .send({});
    expect(res.status).toBe(201);
    expect(tenureService.recordStudentJoin).toHaveBeenCalledWith(
      `person-${studentId}`,
      TEST_BRANCH_ID,
      expect.any(Date),
      'admin-1',
    );
  });
});

// ─── POST /admin/students/:studentId/school-tenures/leave ────────────

describe('POST /admin/students/:studentId/school-tenures/leave', () => {
  test('401 without auth token', async () => {
    const res = await request(app)
      .post('/admin/students/s1/school-tenures/leave')
      .query(branchQuery)
      .send({ endReason: 'WITHDRAWN' });
    expect(res.status).toBe(401);
  });

  test('404 when student not found', async () => {
    mockStudentNotFound();
    const res = await request(app)
      .post('/admin/students/s-missing/school-tenures/leave')
      .query(branchQuery)
      .set(adminAuth)
      .send({ endReason: 'WITHDRAWN' });
    expect(res.status).toBe(404);
    expect(res.body.message).toBe('Student person record not found');
  });

  test.each(STUDENT_IDS)('404 when student %s not found', async (studentId) => {
    (prismaMock.student.findUnique as jest.Mock).mockResolvedValue(null);
    const res = await request(app)
      .post(`/admin/students/${studentId}/school-tenures/leave`)
      .query(branchQuery)
      .set(adminAuth)
      .send({ endReason: 'WITHDRAWN' });
    expect(res.status).toBe(404);
  });

  test.each([
    ['empty body', {}],
    ['missing endReason', { notes: 'leaving' }],
    ['empty endReason', { endReason: '' }],
  ])('400 when %s', async (_label, body) => {
    mockStudentWithPerson();
    const res = await request(app)
      .post('/admin/students/s1/school-tenures/leave')
      .query(branchQuery)
      .set(adminAuth)
      .send(body);
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Valid endReason is required');
  });

  test.each(END_REASONS)('200 records student leave with endReason %s', async (endReason) => {
    mockStudentWithPerson('s1', 'person-1');
    const res = await request(app)
      .post('/admin/students/s1/school-tenures/leave')
      .query(branchQuery)
      .set(adminAuth)
      .send({ endReason });
    expect(res.status).toBe(200);
    expect(tenureService.recordStudentLeave).toHaveBeenCalledWith(
      'person-1',
      expect.any(Date),
      endReason,
      undefined,
    );
  });

  test('200 records leave with notes and leftAt', async () => {
    mockStudentWithPerson('s2', 'person-2');
    const leftAt = '2025-06-01T00:00:00.000Z';
    const res = await request(app)
      .post('/admin/students/s2/school-tenures/leave')
      .query(branchQuery)
      .set(adminAuth)
      .send({ endReason: 'GRADUATED', leftAt, notes: 'Completed' });
    expect(res.status).toBe(200);
    expect(tenureService.recordStudentLeave).toHaveBeenCalledWith(
      'person-2',
      new Date(leftAt),
      'GRADUATED',
      'Completed',
    );
  });

  test.each(STUDENT_IDS)('200 leave succeeds for student %s', async (studentId) => {
    mockStudentWithPerson(studentId, `person-${studentId}`);
    const res = await request(app)
      .post(`/admin/students/${studentId}/school-tenures/leave`)
      .query(branchQuery)
      .set(adminAuth)
      .send({ endReason: 'TRANSFERRED' });
    expect(res.status).toBe(200);
    expect(tenureService.recordStudentLeave).toHaveBeenCalledWith(
      `person-${studentId}`,
      expect.any(Date),
      'TRANSFERRED',
      undefined,
    );
  });
});

// ─── POST /admin/students/:studentId/class-movements ─────────────────

describe('POST /admin/students/:studentId/class-movements', () => {
  test('401 without auth token', async () => {
    const res = await request(app)
      .post('/admin/students/s1/class-movements')
      .query(scopeQuery)
      .send({ toGroupId: 'g2' });
    expect(res.status).toBe(401);
  });

  test('400 when academic year scope is missing', async () => {
    (prismaMock.academicYear.findFirst as jest.Mock).mockResolvedValue(null);
    mockStudentForClassMovement();
    const res = await request(app)
      .post('/admin/students/s1/class-movements')
      .query(branchQuery)
      .set(adminAuth)
      .send({ toGroupId: 'g2' });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('No academic year specified');
  });

  test.each([
    ['empty body', {}],
    ['missing toGroupId', { reason: 'promotion' }],
    ['empty toGroupId', { toGroupId: '' }],
  ])('400 when %s', async (_label, body) => {
    setupScope();
    mockStudentForClassMovement();
    const res = await request(app)
      .post('/admin/students/s1/class-movements')
      .query(scopeQuery)
      .set(adminAuth)
      .send(body);
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('toGroupId is required');
    expect(tenureService.recordClassMovement).not.toHaveBeenCalled();
  });

  test('404 when student not found', async () => {
    setupScope();
    mockStudentNotFound();
    const res = await request(app)
      .post('/admin/students/s-missing/class-movements')
      .query(scopeQuery)
      .set(adminAuth)
      .send({ toGroupId: 'g2' });
    expect(res.status).toBe(404);
    expect(res.body.message).toBe('Student not found');
  });

  test.each(STUDENT_IDS)('404 when student %s not found', async (studentId) => {
    setupScope();
    (prismaMock.student.findUnique as jest.Mock).mockResolvedValue(null);
    const res = await request(app)
      .post(`/admin/students/${studentId}/class-movements`)
      .query(scopeQuery)
      .set(adminAuth)
      .send({ toGroupId: 'g2' });
    expect(res.status).toBe(404);
  });

  test('201 records class movement', async () => {
    setupScope();
    mockStudentForClassMovement('s1', 'g1');
    const res = await request(app)
      .post('/admin/students/s1/class-movements')
      .query(scopeQuery)
      .set(adminAuth)
      .send({ toGroupId: 'g2' });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(tenureService.recordClassMovement).toHaveBeenCalledWith({
      studentId: 's1',
      academicYearId: TEST_AY_ID,
      fromGroupId: 'g1',
      toGroupId: 'g2',
      effectiveAt: expect.any(Date),
      reason: undefined,
      createdById: 'admin-1',
    });
  });

  test.each(GROUP_IDS)('201 moves student to group %s', async (toGroupId) => {
    setupScope();
    mockStudentForClassMovement('s2', 'g-from');
    const res = await request(app)
      .post('/admin/students/s2/class-movements')
      .query(scopeQuery)
      .set(adminAuth)
      .send({ toGroupId });
    expect(res.status).toBe(201);
    expect(tenureService.recordClassMovement).toHaveBeenCalledWith(
      expect.objectContaining({ toGroupId, studentId: 's2' }),
    );
  });

  test.each([
    ['2024-06-01T00:00:00.000Z', 'promotion'],
    ['2025-01-15T12:00:00.000Z', 'section change'],
    ['2026-03-20T08:30:00.000Z', 'batch move'],
  ])('201 with effectiveAt %s and reason', async (effectiveAt, reason) => {
    setupScope();
    mockStudentForClassMovement('s3', 'g3');
    const res = await request(app)
      .post('/admin/students/s3/class-movements')
      .query(scopeQuery)
      .set(adminAuth)
      .send({ toGroupId: 'g4', effectiveAt, reason });
    expect(res.status).toBe(201);
    expect(tenureService.recordClassMovement).toHaveBeenCalledWith(
      expect.objectContaining({
        effectiveAt: new Date(effectiveAt),
        reason,
      }),
    );
  });
});

// ─── GET /admin/teachers/:userId/tenures ─────────────────────────────

describe('GET /admin/teachers/:userId/tenures', () => {
  test('401 without auth token', async () => {
    const res = await request(app).get('/admin/teachers/t1/tenures').query(scopeQuery);
    expect(res.status).toBe(401);
  });

  test('400 when academic year scope is missing', async () => {
    (prismaMock.academicYear.findFirst as jest.Mock).mockResolvedValue(null);
    const res = await request(app)
      .get('/admin/teachers/t1/tenures')
      .set(adminAuth);
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('No academic year specified');
  });

  test('404 when teacher not assigned to branch', async () => {
    setupScope();
    mockTeacherNotInBranch();
    const res = await request(app)
      .get('/admin/teachers/t-missing/tenures')
      .query(scopeQuery)
      .set(adminAuth);
    expect(res.status).toBe(404);
    expect(res.body.message).toBe('Teacher is not assigned to this branch');
    expect(tenureService.listBranchTenures).not.toHaveBeenCalled();
  });

  test.each(TEACHER_USER_IDS)('404 when teacher %s not in branch', async (userId) => {
    setupScope();
    (prismaMock.branchMember.findUnique as jest.Mock).mockResolvedValue(null);
    const res = await request(app)
      .get(`/admin/teachers/${userId}/tenures`)
      .query(scopeQuery)
      .set(adminAuth);
    expect(res.status).toBe(404);
  });

  test('200 returns teacher tenure list', async () => {
    setupScope();
    mockTeacherInBranch('t1', 'bm-t1');
    const rows = [{ id: 'bt1', sequence: 1 }];
    (tenureService.listBranchTenures as jest.Mock).mockResolvedValue(rows);
    const res = await request(app)
      .get('/admin/teachers/t1/tenures')
      .query(scopeQuery)
      .set(adminAuth);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(rows);
    expect(tenureService.listBranchTenures).toHaveBeenCalledWith('bm-t1');
  });

  test.each(TEACHER_USER_IDS)('200 lists tenures for teacher %s', async (userId) => {
    setupScope();
    mockTeacherInBranch(userId, `bm-${userId}`);
    const res = await request(app)
      .get(`/admin/teachers/${userId}/tenures`)
      .query(scopeQuery)
      .set(adminAuth);
    expect(res.status).toBe(200);
    expect(tenureService.listBranchTenures).toHaveBeenCalledWith(`bm-${userId}`);
  });
});

// ─── POST /admin/teachers/:userId/tenures/join ───────────────────────

describe('POST /admin/teachers/:userId/tenures/join', () => {
  test('401 without auth token', async () => {
    const res = await request(app)
      .post('/admin/teachers/t1/tenures/join')
      .query(scopeQuery)
      .send({});
    expect(res.status).toBe(401);
  });

  test('400 when academic year scope is missing', async () => {
    (prismaMock.academicYear.findFirst as jest.Mock).mockResolvedValue(null);
    const res = await request(app)
      .post('/admin/teachers/t1/tenures/join')
      .set(adminAuth)
      .send({});
    expect(res.status).toBe(400);
  });

  test('404 when teacher not in branch', async () => {
    setupScope();
    mockTeacherNotInBranch();
    const res = await request(app)
      .post('/admin/teachers/t-missing/tenures/join')
      .query(scopeQuery)
      .set(adminAuth)
      .send({});
    expect(res.status).toBe(404);
    expect(res.body.message).toBe('Teacher is not assigned to this branch');
  });

  test.each(TEACHER_USER_IDS)('404 when teacher %s not in branch', async (userId) => {
    setupScope();
    (prismaMock.branchMember.findUnique as jest.Mock).mockResolvedValue(null);
    const res = await request(app)
      .post(`/admin/teachers/${userId}/tenures/join`)
      .query(scopeQuery)
      .set(adminAuth)
      .send({});
    expect(res.status).toBe(404);
  });

  test('201 records teacher join', async () => {
    setupScope();
    mockTeacherInBranch('t1', 'bm-t1');
    const res = await request(app)
      .post('/admin/teachers/t1/tenures/join')
      .query(scopeQuery)
      .set(adminAuth)
      .send({});
    expect(res.status).toBe(201);
    expect(tenureService.recordBranchJoin).toHaveBeenCalledWith(
      'bm-t1',
      expect.any(Date),
      'admin-1',
      undefined,
    );
  });

  test.each([
    '2024-06-01T00:00:00.000Z',
    '2025-01-15T12:00:00.000Z',
    '2026-03-20T08:30:00.000Z',
  ])('201 records teacher join with joinedAt %s', async (joinedAt) => {
    setupScope();
    mockTeacherInBranch('t2', 'bm-t2');
    const res = await request(app)
      .post('/admin/teachers/t2/tenures/join')
      .query(scopeQuery)
      .set(adminAuth)
      .send({ joinedAt, previousTenureId: 'prev-x' });
    expect(res.status).toBe(201);
    expect(tenureService.recordBranchJoin).toHaveBeenCalledWith(
      'bm-t2',
      new Date(joinedAt),
      'admin-1',
      'prev-x',
    );
  });

  test.each(TEACHER_USER_IDS)('201 join succeeds for teacher %s', async (userId) => {
    setupScope();
    mockTeacherInBranch(userId, `bm-${userId}`);
    const res = await request(app)
      .post(`/admin/teachers/${userId}/tenures/join`)
      .query(scopeQuery)
      .set(adminAuth)
      .send({});
    expect(res.status).toBe(201);
    expect(tenureService.recordBranchJoin).toHaveBeenCalledWith(
      `bm-${userId}`,
      expect.any(Date),
      'admin-1',
      undefined,
    );
  });
});

// ─── POST /admin/teachers/:userId/tenures/leave ──────────────────────

describe('POST /admin/teachers/:userId/tenures/leave', () => {
  test('401 without auth token', async () => {
    const res = await request(app)
      .post('/admin/teachers/t1/tenures/leave')
      .query(scopeQuery)
      .send({ endReason: 'RESIGNED' });
    expect(res.status).toBe(401);
  });

  test('400 when academic year scope is missing', async () => {
    (prismaMock.academicYear.findFirst as jest.Mock).mockResolvedValue(null);
    const res = await request(app)
      .post('/admin/teachers/t1/tenures/leave')
      .set(adminAuth)
      .send({ endReason: 'RESIGNED' });
    expect(res.status).toBe(400);
  });

  test('404 when teacher not in branch', async () => {
    setupScope();
    mockTeacherNotInBranch();
    const res = await request(app)
      .post('/admin/teachers/t-missing/tenures/leave')
      .query(scopeQuery)
      .set(adminAuth)
      .send({ endReason: 'RESIGNED' });
    expect(res.status).toBe(404);
  });

  test.each(TEACHER_USER_IDS)('404 when teacher %s not in branch', async (userId) => {
    setupScope();
    (prismaMock.branchMember.findUnique as jest.Mock).mockResolvedValue(null);
    const res = await request(app)
      .post(`/admin/teachers/${userId}/tenures/leave`)
      .query(scopeQuery)
      .set(adminAuth)
      .send({ endReason: 'RESIGNED' });
    expect(res.status).toBe(404);
  });

  test.each([
    ['empty body', {}],
    ['missing endReason', { notes: 'leaving' }],
    ['empty endReason', { endReason: '' }],
  ])('400 when %s', async (_label, body) => {
    setupScope();
    mockTeacherInBranch('t1', 'bm-t1');
    const res = await request(app)
      .post('/admin/teachers/t1/tenures/leave')
      .query(scopeQuery)
      .set(adminAuth)
      .send(body);
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Valid endReason is required');
  });

  test.each(END_REASONS)('200 records teacher leave with endReason %s', async (endReason) => {
    setupScope();
    mockTeacherInBranch('t1', 'bm-t1');
    const res = await request(app)
      .post('/admin/teachers/t1/tenures/leave')
      .query(scopeQuery)
      .set(adminAuth)
      .send({ endReason });
    expect(res.status).toBe(200);
    expect(tenureService.recordBranchLeave).toHaveBeenCalledWith(
      'bm-t1',
      expect.any(Date),
      endReason,
      undefined,
    );
  });

  test('200 records teacher leave with notes and leftAt', async () => {
    setupScope();
    mockTeacherInBranch('t2', 'bm-t2');
    const leftAt = '2025-06-01T00:00:00.000Z';
    const res = await request(app)
      .post('/admin/teachers/t2/tenures/leave')
      .query(scopeQuery)
      .set(adminAuth)
      .send({ endReason: 'LEAVE', leftAt, notes: 'Sabbatical' });
    expect(res.status).toBe(200);
    expect(tenureService.recordBranchLeave).toHaveBeenCalledWith(
      'bm-t2',
      new Date(leftAt),
      'LEAVE',
      'Sabbatical',
    );
  });

  test.each(TEACHER_USER_IDS)('200 leave succeeds for teacher %s', async (userId) => {
    setupScope();
    mockTeacherInBranch(userId, `bm-${userId}`);
    const res = await request(app)
      .post(`/admin/teachers/${userId}/tenures/leave`)
      .query(scopeQuery)
      .set(adminAuth)
      .send({ endReason: 'OTHER' });
    expect(res.status).toBe(200);
    expect(tenureService.recordBranchLeave).toHaveBeenCalledWith(
      `bm-${userId}`,
      expect.any(Date),
      'OTHER',
      undefined,
    );
  });
});

// ─── Cross-route auth matrix ─────────────────────────────────────────

describe('Tenure routes — 401 auth matrix', () => {
  test.each([
    '/admin/branch-members/bm-1/tenures',
    '/admin/students/s1/school-tenures',
    '/admin/teachers/t1/tenures',
  ])('GET %s returns 401', async (path) => {
    const res = await request(app).get(path);
    expect(res.status).toBe(401);
  });

  test.each([
    ['/admin/branch-members/bm-1/tenures/join', {}],
    ['/admin/branch-members/bm-1/tenures/leave', { endReason: 'OTHER' }],
    ['/admin/students/s1/school-tenures/join', {}],
    ['/admin/students/s1/school-tenures/leave', { endReason: 'WITHDRAWN' }],
    ['/admin/students/s1/class-movements', { toGroupId: 'g2' }],
    ['/admin/teachers/t1/tenures/join', {}],
    ['/admin/teachers/t1/tenures/leave', { endReason: 'RESIGNED' }],
  ])('POST %s returns 401', async (path, body) => {
    const res = await request(app).post(path).send(body);
    expect(res.status).toBe(401);
  });
});
