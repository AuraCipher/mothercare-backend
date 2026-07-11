/**
 * Attendance routes — full integration matrix (auth, scope, RBAC, validation, success).
 * Covers all 8 endpoints in attendance.routes.ts.
 */

jest.mock('bcryptjs', () => ({
  hash: jest.fn().mockResolvedValue('$2a$12$mocked_hash_for_testing'),
  compare: jest.fn().mockResolvedValue(true),
}));

jest.mock('../../../src/modules/admin/services/staff.service', () => ({
  staffService: {
    resolveUserAccess: jest.fn().mockResolvedValue({
      isRestricted: false,
      isFullAdmin: true,
      permissions: [],
    }),
  },
}));

import request from 'supertest';
import { prismaMock } from '../../mocks/prisma';
import app from '../../../src/app';
import { staffService } from '../../../src/modules/admin/services/staff.service';
import { createMockStudent } from '../../helpers/factories';
import {
  adminAuth,
  scopeQuery,
  TEST_AY_ID,
  TEST_BRANCH_ID,
  type HttpMethod,
} from '../../helpers/integration';
import { generateExpiredToken, generateTestToken, getAuthHeader } from '../../helpers/auth';
import type { ResolvedModulePermission } from '../../../src/modules/admin/staff-permissions.constants';

const GROUP_ID = 'g1';
const STUDENT_ID = 's1';
const TEACHER_ID = 't1';
const STAFF_USER_ID = 'st1';
const VALID_DATE = '2026-06-24';
const OTHER_BRANCH = 'branch-x';

const GROUP_IDS = ['g1', 'g2', 'g3', 'g4', 'g5'];
const STUDENT_IDS = ['s1', 's2', 's3', 's4', 's5'];
const TEACHER_IDS = ['t1', 't2', 't3', 't4', 't5'];
const STAFF_IDS = ['st1', 'st2', 'st3', 'st4', 'st5'];
const SINGLE_DATES = ['2026-06-01', '2026-06-10', '2026-06-15', '2026-06-20', '2026-06-24'];
const DATE_RANGES = [
  ['2026-06-01', '2026-06-07'],
  ['2026-06-08', '2026-06-14'],
  ['2026-06-15', '2026-06-21'],
  ['2026-06-22', '2026-06-30'],
] as const;
const ATTENDANCE_STATUSES = ['present', 'absent', 'late', 'leave'] as const;
const NOTIFY_STATUSES = ['absent', 'late', 'leave'] as const;

const expiredAuth = getAuthHeader(generateExpiredToken('admin-1', 'super_admin'));
const teacherAuth = getAuthHeader(generateTestToken('teacher-1', 'teacher'));
const parentAuth = getAuthHeader(generateTestToken('parent-1', 'parent'));
const wrongBranchAuth = getAuthHeader(
  generateTestToken('mgmt-1', 'management', { branchIds: [OTHER_BRANCH] } as Record<string, unknown>),
);
const managementAuth = getAuthHeader(
  generateTestToken('mgmt-1', 'management', { branchIds: [TEST_BRANCH_ID] } as Record<string, unknown>),
);

let currentAy: { id: string; branchId: string; status: string } = {
  id: TEST_AY_ID,
  branchId: TEST_BRANCH_ID,
  status: 'ACTIVE',
};

type RouteSpec = {
  label: string;
  method: HttpMethod;
  path: string;
  query?: Record<string, string>;
  body?: Record<string, unknown>;
  attendanceModule?: boolean;
  studentsModule?: boolean;
  isWrite?: boolean;
  successStatus?: number;
};

const ALL_ROUTES: RouteSpec[] = [
  {
    label: 'GET student attendance list',
    method: 'get',
    path: '/admin/attendance',
    query: { date: VALID_DATE },
    attendanceModule: true,
  },
  {
    label: 'POST student attendance batch',
    method: 'post',
    path: '/admin/attendance/batch',
    body: {
      date: VALID_DATE,
      groupId: GROUP_ID,
      academicYearId: TEST_AY_ID,
      branchId: TEST_BRANCH_ID,
      records: [{ studentId: STUDENT_ID, status: 'present' }],
    },
    attendanceModule: true,
    isWrite: true,
  },
  {
    label: 'GET student attendance report',
    method: 'get',
    path: `/admin/students/${STUDENT_ID}/attendance`,
    studentsModule: true,
  },
  {
    label: 'GET teacher attendance',
    method: 'get',
    path: '/admin/attendance/teachers',
    query: { date: VALID_DATE },
    attendanceModule: true,
  },
  {
    label: 'POST teacher attendance batch',
    method: 'post',
    path: '/admin/attendance/teachers/batch',
    body: {
      date: VALID_DATE,
      academicYearId: TEST_AY_ID,
      branchId: TEST_BRANCH_ID,
      records: [{ teacherId: TEACHER_ID, status: 'present' }],
    },
    attendanceModule: true,
    isWrite: true,
  },
  {
    label: 'GET staff attendance',
    method: 'get',
    path: '/admin/attendance/staff',
    query: { date: VALID_DATE },
    attendanceModule: true,
  },
  {
    label: 'POST staff attendance batch',
    method: 'post',
    path: '/admin/attendance/staff/batch',
    body: {
      date: VALID_DATE,
      academicYearId: TEST_AY_ID,
      branchId: TEST_BRANCH_ID,
      records: [{ staffUserId: STAFF_USER_ID, status: 'present' }],
    },
    attendanceModule: true,
    isWrite: true,
  },
  {
    label: 'POST attendance notify',
    method: 'post',
    path: '/admin/attendance/notify',
    body: {
      date: VALID_DATE,
      academicYearId: TEST_AY_ID,
      branchId: TEST_BRANCH_ID,
      records: [{ studentId: STUDENT_ID, status: 'absent' }],
    },
    attendanceModule: true,
    isWrite: true,
  },
];

const ATTENDANCE_READ_ROUTES = ALL_ROUTES.filter((r) => r.attendanceModule && r.method === 'get');
const ATTENDANCE_WRITE_ROUTES = ALL_ROUTES.filter((r) => r.attendanceModule && r.isWrite);
const STUDENT_REPORT_ROUTE = ALL_ROUTES.find((r) => r.studentsModule)!;

function mockStaffAccess(permissions: ResolvedModulePermission[]) {
  (staffService.resolveUserAccess as jest.Mock).mockResolvedValue({
    isRestricted: true,
    isFullAdmin: false,
    permissions,
  });
}

function mockFullAdminAccess() {
  (staffService.resolveUserAccess as jest.Mock).mockResolvedValue({
    isRestricted: false,
    isFullAdmin: true,
    permissions: [],
  });
}

function mockActiveAcademicYearLocal(overrides: Record<string, unknown> = {}) {
  currentAy = {
    id: TEST_AY_ID,
    branchId: TEST_BRANCH_ID,
    status: 'ACTIVE',
    ...overrides,
  } as typeof currentAy;
  (prismaMock.academicYear.findUnique as jest.Mock).mockImplementation(
    async (args: { select?: { calendar?: unknown } }) => {
      if (args?.select?.calendar) {
        return { calendar: { startDate: new Date('2020-01-01'), endDate: new Date('2099-12-31') } };
      }
      return { ...currentAy };
    },
  );
  (prismaMock.academicYear.findFirst as jest.Mock).mockResolvedValue({ ...currentAy });
  return currentAy;
}


function setupStudentFindManyMock() {
  (prismaMock.student.findMany as jest.Mock).mockImplementation(
    async (args: { where?: { id?: { in?: string[] }; groupId?: string }; select?: { attendances?: unknown } }) => {
      const base = STUDENT_IDS.map((id) => ({ id, groupId: GROUP_ID }));
      let rows = base;
      const where = args?.where;
      if (where?.id?.in) {
        rows = rows.filter((s) => where.id!.in!.includes(s.id));
      }
      if (where?.groupId) {
        rows = rows.filter((s) => s.groupId === where.groupId);
      }
      if (args?.select?.attendances) {
        return rows.map((s, i) => mockStudentRow(s.id, `Student ${i + 1}`, s.groupId));
      }
      return rows;
    },
  );
}

function setupUserFindManyMock() {
  (prismaMock.user.findMany as jest.Mock).mockImplementation(
    async (args: { where?: { role?: string; id?: { in?: string[] } }; select?: Record<string, unknown> }) => {
      if (args?.where?.role === 'teacher') {
        let teachers = TEACHER_IDS.map((id, i) => mockTeacherRow(id, `Teacher ${i + 1}`));
        if (args.where.id?.in) {
          teachers = teachers.filter((t) => args.where!.id!.in!.includes(t.id));
        }
        return teachers;
      }
      let staff = STAFF_IDS.map((id, i) => {
        const roles: Array<'management' | 'canteen_staff' | 'worker'> = ['management', 'canteen_staff', 'worker'];
        return mockStaffRow(id, `Staff ${i + 1}`, roles[i % 3]);
      });
      if (args?.where?.id?.in) {
        staff = staff.filter((s) => args.where!.id!.in!.includes(s.id));
      }
      return staff;
    },
  );
}

function mockTenuredBranchMember(userId = TEACHER_ID) {
  (prismaMock.branchMember.findUnique as jest.Mock).mockImplementation(
    async (args: { where?: { branchId_userId?: { userId?: string } } }) => {
      const uid = args?.where?.branchId_userId?.userId ?? userId;
      return {
        id: 'bm-1',
        branchId: TEST_BRANCH_ID,
        userId: uid,
        isActive: true,
        resignedAt: null,
        tenures: [{ joinedAt: new Date('2020-01-01'), leftAt: null, sequence: 1 }],
      };
    },
  );
}

function mockStudentRow(id: string, name: string, groupId = GROUP_ID) {
  return {
    ...createMockStudent({ id, name, groupId }),
    attendances: [{ date: VALID_DATE, status: 'present', note: null }],
  };
}

function mockTeacherRow(id: string, name: string) {
  return {
    id,
    name,
    teacherAttendances: [{ date: VALID_DATE, status: 'present', note: null }],
  };
}

function mockStaffRow(id: string, name: string, role: 'management' | 'canteen_staff' | 'worker') {
  return {
    id,
    name,
    staffProfile: { employeeId: `EMP-${id}` },
    branchMembers: [{ role }],
    staffAttendances: [{ date: VALID_DATE, status: 'present', note: null }],
  };
}

function setupAttendanceMocks() {
  mockActiveAcademicYearLocal();
  setupStudentFindManyMock();
  setupUserFindManyMock();

  (prismaMock.group.findFirst as jest.Mock).mockResolvedValue({ id: GROUP_ID });
  (prismaMock.student.findFirst as jest.Mock).mockResolvedValue({ id: STUDENT_ID });
  (prismaMock.attendance.findMany as jest.Mock).mockResolvedValue([
    { date: VALID_DATE, status: 'present', note: null },
    { date: '2026-06-23', status: 'absent', note: 'sick' },
    { date: '2026-06-22', status: 'late', note: null },
  ]);
  (prismaMock.attendance.upsert as jest.Mock).mockResolvedValue({});
  (prismaMock.teacherAttendance.upsert as jest.Mock).mockResolvedValue({});
  (prismaMock.staffAttendance.upsert as jest.Mock).mockResolvedValue({});
  (prismaMock.attendanceNotification.findFirst as jest.Mock).mockResolvedValue(null);
  (prismaMock.attendanceNotification.findMany as jest.Mock).mockResolvedValue([]);
  (prismaMock.attendanceNotification.create as jest.Mock).mockResolvedValue({ id: 'n1' });

  mockTenuredBranchMember(TEACHER_ID);
}

function sendRequest(
  spec: Pick<RouteSpec, 'method' | 'path' | 'body' | 'query'>,
  opts?: {
    auth?: { Authorization: string };
    query?: Record<string, string>;
    body?: Record<string, unknown>;
    withScope?: boolean;
  },
) {
  const withScope = opts?.withScope !== false;
  const query = withScope
    ? { ...scopeQuery, ...spec.query, ...opts?.query }
    : { ...opts?.query };
  const body = opts?.body ?? spec.body;
  let req = request(app)[spec.method](spec.path);
  if (query && Object.keys(query).length) req = req.query(query);
  if (opts?.auth) req = req.set(opts.auth);
  if (body && spec.method !== 'get') return req.send(body);
  return req;
}

describe('Attendance full integration routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupAttendanceMocks();
    mockFullAdminAccess();
  });

  // ─── 1. Auth matrix ─────────────────────────────────────────────

  describe('auth — 401 without token', () => {
    test.each(ALL_ROUTES.map((r) => [r.label, r] as const))('%s', async (_label, spec) => {
      const res = await sendRequest(spec);
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });
  });

  describe('auth — 401 with expired token', () => {
    test.each(ALL_ROUTES.map((r) => [r.label, r] as const))('%s', async (_label, spec) => {
      const res = await sendRequest(spec, { auth: expiredAuth });
      expect(res.status).toBe(401);
    });
  });

  describe('auth — 403 for teacher role', () => {
    test.each(ALL_ROUTES.map((r) => [r.label, r] as const))('%s', async (_label, spec) => {
      const res = await sendRequest(spec, { auth: teacherAuth });
      expect(res.status).toBe(403);
    });
  });

  describe('auth — 403 for parent role', () => {
    test.each(ALL_ROUTES.map((r) => [r.label, r] as const))('%s', async (_label, spec) => {
      const res = await sendRequest(spec, { auth: parentAuth });
      expect(res.status).toBe(403);
    });
  });

  // ─── 2. Scope matrix ────────────────────────────────────────────

  describe('scope — 400 without academic year', () => {
    beforeEach(() => {
      (prismaMock.academicYear.findUnique as jest.Mock).mockResolvedValue(null);
      (prismaMock.academicYear.findFirst as jest.Mock).mockResolvedValue(null);
    });

    test.each(ALL_ROUTES.map((r) => [r.label, r] as const))('%s', async (_label, spec) => {
      const body =
        spec.body && spec.method !== 'get'
          ? Object.fromEntries(
              Object.entries(spec.body).filter(([k]) => k !== 'academicYearId' && k !== 'branchId'),
            )
          : undefined;
      const res = await sendRequest(spec, {
        auth: adminAuth,
        withScope: false,
        query: { branchId: TEST_BRANCH_ID },
        body,
      });
      expect([400, 404]).toContain(res.status);
      expect(res.body.message).toMatch(/academic year/i);
    });
  });

  describe('scope — 404 when academic year not found', () => {
    beforeEach(() => {
      (prismaMock.academicYear.findUnique as jest.Mock).mockResolvedValue(null);
      (prismaMock.academicYear.findFirst as jest.Mock).mockResolvedValue(null);
    });

    test.each(ALL_ROUTES.map((r) => [r.label, r] as const))('%s', async (_label, spec) => {
      const res = await sendRequest(spec, {
        auth: adminAuth,
        query: { branchId: TEST_BRANCH_ID, academicYearId: 'missing-ay' },
      });
      expect(res.status).toBe(404);
      expect(res.body.message).toMatch(/academic year not found/i);
    });
  });

  describe('scope — 400 when branchId does not match academic year', () => {
    beforeEach(() => {
      mockActiveAcademicYearLocal({ branchId: OTHER_BRANCH });
    });

    test.each(ALL_ROUTES.map((r) => [r.label, r] as const))('%s', async (_label, spec) => {
      const res = await sendRequest(spec, { auth: adminAuth });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/does not belong|not in the selected/i);
    });
  });

  describe('scope — 403 management user without branch access', () => {
    test.each(ALL_ROUTES.map((r) => [r.label, r] as const))('%s', async (_label, spec) => {
      const res = await sendRequest(spec, { auth: wrongBranchAuth });
      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/access denied/i);
    });
  });

  // ─── 3. RBAC matrix ─────────────────────────────────────────────

  describe('RBAC — 403 without ATTENDANCE read permission', () => {
    beforeEach(() => {
      mockStaffAccess([
        { module: 'FEES', canCreate: true, canRead: true, canUpdate: true, canDelete: false },
      ]);
    });

    test.each(ATTENDANCE_READ_ROUTES.map((r) => [r.label, r] as const))('%s', async (_label, spec) => {
      const res = await sendRequest(spec, { auth: adminAuth });
      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/no read permission for attendance/i);
    });
  });

  describe('RBAC — 403 without ATTENDANCE create permission', () => {
    beforeEach(() => {
      mockStaffAccess([
        { module: 'FEES', canCreate: true, canRead: true, canUpdate: true, canDelete: false },
      ]);
    });

    test.each(ATTENDANCE_WRITE_ROUTES.map((r) => [r.label, r] as const))('%s', async (_label, spec) => {
      const res = await sendRequest(spec, { auth: adminAuth });
      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/no create permission for attendance/i);
    });
  });

  describe('RBAC — 403 without STUDENTS read for student report', () => {
    beforeEach(() => {
      mockStaffAccess([
        { module: 'ATTENDANCE', canCreate: true, canRead: true, canUpdate: true, canDelete: false },
      ]);
    });

    test('GET student attendance report', async () => {
      const res = await sendRequest(STUDENT_REPORT_ROUTE, { auth: adminAuth });
      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/no read permission for students/i);
    });
  });

  describe('RBAC — read-only staff can GET attendance routes', () => {
    beforeEach(() => {
      mockStaffAccess([
        { module: 'ATTENDANCE', canCreate: false, canRead: true, canUpdate: false, canDelete: false },
      ]);
    });

    test.each(ATTENDANCE_READ_ROUTES.map((r) => [r.label, r] as const))('%s', async (_label, spec) => {
      const res = await sendRequest(spec, { auth: adminAuth });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe('RBAC — read-only staff can GET student report with STUDENTS read', () => {
    beforeEach(() => {
      mockStaffAccess([
        { module: 'STUDENTS', canCreate: false, canRead: true, canUpdate: false, canDelete: false },
      ]);
    });

    test('GET student attendance report', async () => {
      const res = await sendRequest(STUDENT_REPORT_ROUTE, { auth: adminAuth });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe('RBAC — read-only staff cannot POST attendance', () => {
    beforeEach(() => {
      mockStaffAccess([
        { module: 'ATTENDANCE', canCreate: false, canRead: true, canUpdate: false, canDelete: false },
      ]);
    });

    test.each(ATTENDANCE_WRITE_ROUTES.map((r) => [r.label, r] as const))('%s', async (_label, spec) => {
      const res = await sendRequest(spec, { auth: adminAuth });
      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/no create permission for attendance/i);
    });
  });

  describe('RBAC — create staff can POST attendance writes', () => {
    beforeEach(() => {
      mockStaffAccess([
        { module: 'ATTENDANCE', canCreate: true, canRead: true, canUpdate: false, canDelete: false },
      ]);
    });

    test.each(ATTENDANCE_WRITE_ROUTES.map((r) => [r.label, r] as const))('%s', async (_label, spec) => {
      const res = await sendRequest(spec, { auth: adminAuth });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  // ─── 4. Success matrix ──────────────────────────────────────────

  describe('success — all routes with scope', () => {
    test.each(ALL_ROUTES.map((r) => [r.label, r] as const))('%s', async (_label, spec) => {
      const res = await sendRequest(spec, { auth: adminAuth });
      expect(res.status).toBe(spec.successStatus ?? 200);
      expect(res.body.success).toBe(true);
    });
  });

  // ─── 5. GET /admin/attendance ───────────────────────────────────

  describe('GET /admin/attendance — list behaviour', () => {
    test('returns 400 when groupId not in academic year', async () => {
      (prismaMock.group.findFirst as jest.Mock).mockResolvedValueOnce(null);
      const res = await sendRequest(
        { method: 'get', path: '/admin/attendance', query: { date: VALID_DATE, groupId: 'missing-g' } },
        { auth: adminAuth },
      );
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/group not found/i);
    });

    test('returns empty list with total 0', async () => {
      (prismaMock.student.findMany as jest.Mock).mockResolvedValueOnce([]);
      const res = await sendRequest(
        { method: 'get', path: '/admin/attendance', query: { date: VALID_DATE } },
        { auth: adminAuth },
      );
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
      expect(res.body.total).toBe(0);
    });

    test('includes total count matching data length', async () => {
      const res = await sendRequest(
        { method: 'get', path: '/admin/attendance', query: { date: VALID_DATE } },
        { auth: adminAuth },
      );
      expect(res.body.total).toBe(res.body.data.length);
    });

    test('orders by name when no groupId', async () => {
      await sendRequest(
        { method: 'get', path: '/admin/attendance', query: { date: VALID_DATE } },
        { auth: adminAuth },
      );
      const call = (prismaMock.student.findMany as jest.Mock).mock.calls.at(-1)?.[0];
      expect(call.orderBy).toEqual([{ name: 'asc' }]);
    });

    test('orders by rollNumber when groupId provided', async () => {
      await sendRequest(
        { method: 'get', path: '/admin/attendance', query: { date: VALID_DATE, groupId: GROUP_ID } },
        { auth: adminAuth },
      );
      const call = (prismaMock.student.findMany as jest.Mock).mock.calls.at(-1)?.[0];
      expect(call.orderBy).toEqual([{ rollNumber: 'asc' }]);
    });

    test.each(SINGLE_DATES)('filters by single date %s', async (date) => {
      const res = await sendRequest(
        { method: 'get', path: '/admin/attendance', query: { date } },
        { auth: adminAuth },
      );
      expect(res.status).toBe(200);
      const call = (prismaMock.student.findMany as jest.Mock).mock.calls.at(-1)?.[0];
      expect(call.select.attendances.where.date).toEqual({ equals: new Date(date) });
    });

    test.each(DATE_RANGES)('filters by range %s to %s', async (from, to) => {
      const res = await sendRequest(
        { method: 'get', path: '/admin/attendance', query: { from, to } },
        { auth: adminAuth },
      );
      expect(res.status).toBe(200);
      const call = (prismaMock.student.findMany as jest.Mock).mock.calls.at(-1)?.[0];
      expect(call.select.attendances.where.date).toEqual({
        gte: new Date(from),
        lte: new Date(to),
      });
    });

    test.each(GROUP_IDS)('filters students by groupId %s', async (groupId) => {
      await sendRequest(
        { method: 'get', path: '/admin/attendance', query: { date: VALID_DATE, groupId } },
        { auth: adminAuth },
      );
      const call = (prismaMock.student.findMany as jest.Mock).mock.calls.at(-1)?.[0];
      expect(call.where.groupId).toBe(groupId);
    });

    test.each(STUDENT_IDS)('returns student %s with attendances array', async (studentId) => {
      (prismaMock.student.findMany as jest.Mock).mockResolvedValueOnce([mockStudentRow(studentId, 'Test')]);
      const res = await sendRequest(
        { method: 'get', path: '/admin/attendance', query: { date: VALID_DATE } },
        { auth: adminAuth },
      );
      expect(res.body.data[0].id).toBe(studentId);
      expect(res.body.data[0].attendances).toBeDefined();
    });
  });

  // ─── 6. POST /admin/attendance/batch ────────────────────────────

  describe('POST /admin/attendance/batch — validation', () => {
    const basePath = '/admin/attendance/batch';

    test.each([
      ['missing date', { groupId: GROUP_ID, records: [] }],
      ['missing groupId', { date: VALID_DATE, records: [] }],
      ['missing records', { date: VALID_DATE, groupId: GROUP_ID }],
      ['records not array', { date: VALID_DATE, groupId: GROUP_ID, records: 'bad' }],
    ])('400 — %s', async (_label, body) => {
      const res = await request(app)
        .post(basePath)
        .query(scopeQuery)
        .set(adminAuth)
        .send(body);
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/required/i);
    });

    test('400 — future date rejected', async () => {
      const res = await request(app)
        .post(basePath)
        .query(scopeQuery)
        .set(adminAuth)
        .send({ date: '2099-01-01', groupId: GROUP_ID, records: [{ studentId: STUDENT_ID, status: 'present' }] });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/future/i);
    });

    test('400 — date outside academic year calendar', async () => {
      (prismaMock.academicYear.findUnique as jest.Mock).mockImplementation(
        async (args: { select?: { calendar?: unknown } }) => {
          if (args?.select?.calendar) {
            return { calendar: { startDate: new Date('2026-01-01'), endDate: new Date('2026-01-31') } };
          }
          return { ...currentAy };
        },
      );
      const res = await request(app)
        .post(basePath)
        .query(scopeQuery)
        .set(adminAuth)
        .send({ date: '2026-06-24', groupId: GROUP_ID, records: [{ studentId: STUDENT_ID, status: 'present' }] });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/outside the academic year/i);
    });

    test('400 — group not found in academic year', async () => {
      (prismaMock.group.findFirst as jest.Mock).mockResolvedValueOnce(null);
      const res = await request(app)
        .post(basePath)
        .query(scopeQuery)
        .set(adminAuth)
        .send({ date: VALID_DATE, groupId: 'bad-group', records: [{ studentId: STUDENT_ID, status: 'present' }] });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/group not found/i);
    });

    test('400 — students not in scoped group', async () => {
      (prismaMock.student.findMany as jest.Mock).mockResolvedValueOnce([]);
      const res = await request(app)
        .post(basePath)
        .query(scopeQuery)
        .set(adminAuth)
        .send({ date: VALID_DATE, groupId: GROUP_ID, records: [{ studentId: STUDENT_ID, status: 'present' }] });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/not in the selected group/i);
    });

    test.each(ATTENDANCE_STATUSES)('saves status %s', async (status) => {
      const res = await request(app)
        .post(basePath)
        .query(scopeQuery)
        .set(adminAuth)
        .send({ date: VALID_DATE, groupId: GROUP_ID, records: [{ studentId: STUDENT_ID, status }] });
      expect(res.status).toBe(200);
      const call = (prismaMock.attendance.upsert as jest.Mock).mock.calls.at(-1)?.[0];
      expect(call.create.status).toBe(status);
    });

    test.each([
      ['missing studentId', { status: 'present' }],
      ['missing status', { studentId: STUDENT_ID }],
      ['empty record', {}],
    ])('skips invalid record — %s', async (_label, record) => {
      const res = await request(app)
        .post(basePath)
        .query(scopeQuery)
        .set(adminAuth)
        .send({ date: VALID_DATE, groupId: GROUP_ID, records: [record] });
      expect(res.status).toBe(200);
      expect(res.body.data.saved).toBe(0);
      expect(prismaMock.attendance.upsert).not.toHaveBeenCalled();
    });

    test.each(STUDENT_IDS)('upserts attendance for student %s', async (studentId) => {
      (prismaMock.student.findMany as jest.Mock).mockResolvedValueOnce([{ id: studentId }]);
      await request(app)
        .post(basePath)
        .query(scopeQuery)
        .set(adminAuth)
        .send({ date: VALID_DATE, groupId: GROUP_ID, records: [{ studentId, status: 'present' }] });
      expect(prismaMock.attendance.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { studentId_date: { studentId, date: expect.any(Date) } },
        }),
      );
    });

    test('sets markedById from authenticated user', async () => {
      await request(app)
        .post(basePath)
        .query(scopeQuery)
        .set(adminAuth)
        .send({ date: VALID_DATE, groupId: GROUP_ID, records: [{ studentId: STUDENT_ID, status: 'present' }] });
      const call = (prismaMock.attendance.upsert as jest.Mock).mock.calls.at(-1)?.[0];
      expect(call.create.markedById).toBe('admin-1');
      expect(call.update.markedById).toBe('admin-1');
    });

    test('persists optional note', async () => {
      await request(app)
        .post(basePath)
        .query(scopeQuery)
        .set(adminAuth)
        .send({
          date: VALID_DATE,
          groupId: GROUP_ID,
          records: [{ studentId: STUDENT_ID, status: 'absent', note: 'Medical leave' }],
        });
      const call = (prismaMock.attendance.upsert as jest.Mock).mock.calls.at(-1)?.[0];
      expect(call.create.note).toBe('Medical leave');
    });

    test('returns saved and total counts', async () => {
      const res = await request(app)
        .post(basePath)
        .query(scopeQuery)
        .set(adminAuth)
        .send({
          date: VALID_DATE,
          groupId: GROUP_ID,
          records: [
            { studentId: STUDENT_ID, status: 'present' },
            { studentId: 's2', status: 'absent' },
          ],
        });
      expect(res.body.data).toEqual({ saved: 2, total: 2 });
    });
  });

  // ─── 7. GET /admin/students/:id/attendance ──────────────────────

  describe('GET /admin/students/:id/attendance — report', () => {
    test('404 when student not in academic year', async () => {
      (prismaMock.student.findFirst as jest.Mock).mockResolvedValueOnce(null);
      const res = await sendRequest(STUDENT_REPORT_ROUTE, { auth: adminAuth });
      expect(res.status).toBe(404);
      expect(res.body.message).toMatch(/student not found/i);
    });

    test('returns records and summary', async () => {
      const res = await sendRequest(STUDENT_REPORT_ROUTE, { auth: adminAuth });
      expect(res.status).toBe(200);
      expect(res.body.data.records).toHaveLength(3);
      expect(res.body.data.summary).toMatchObject({
        present: 1,
        absent: 1,
        late: 1,
        total: 3,
      });
    });

    test('summary percentage is 0 when no records', async () => {
      (prismaMock.attendance.findMany as jest.Mock).mockResolvedValueOnce([]);
      const res = await sendRequest(STUDENT_REPORT_ROUTE, { auth: adminAuth });
      expect(res.body.data.summary.percentage).toBe(0);
      expect(res.body.data.summary.total).toBe(0);
    });

    test.each([
      [{ present: 2, absent: 0, late: 0, total: 2, percentage: 100 }],
      [{ present: 1, absent: 1, late: 0, total: 2, percentage: 50 }],
      [{ present: 0, absent: 3, late: 0, total: 3, percentage: 0 }],
    ])('computes summary %j', async (expected) => {
      const records = [
        ...Array.from({ length: expected.present }, () => ({ date: VALID_DATE, status: 'present', note: null })),
        ...Array.from({ length: expected.absent }, () => ({ date: VALID_DATE, status: 'absent', note: null })),
        ...Array.from({ length: expected.late }, () => ({ date: VALID_DATE, status: 'late', note: null })),
      ];
      (prismaMock.attendance.findMany as jest.Mock).mockResolvedValueOnce(records);
      const res = await sendRequest(STUDENT_REPORT_ROUTE, { auth: adminAuth });
      expect(res.body.data.summary).toMatchObject(expected);
    });

    test.each(DATE_RANGES)('applies from/to filter %s — %s', async (from, to) => {
      await sendRequest(STUDENT_REPORT_ROUTE, {
        auth: adminAuth,
        query: { from, to },
      });
      const call = (prismaMock.attendance.findMany as jest.Mock).mock.calls.at(-1)?.[0];
      expect(call.where.date).toEqual({
        gte: new Date(from),
        lte: new Date(to),
      });
    });

    test.each(STUDENT_IDS)('loads report for student %s', async (studentId) => {
      (prismaMock.student.findFirst as jest.Mock).mockResolvedValueOnce({ id: studentId });
      const res = await sendRequest(
        { method: 'get', path: `/admin/students/${studentId}/attendance` },
        { auth: adminAuth },
      );
      expect(res.status).toBe(200);
      expect(prismaMock.student.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ id: studentId }) }),
      );
    });
  });

  // ─── 8. GET /admin/attendance/teachers ──────────────────────────

  describe('GET /admin/attendance/teachers', () => {
    test('returns empty teacher list', async () => {
      (prismaMock.user.findMany as jest.Mock).mockResolvedValueOnce([]);
      const res = await sendRequest(
        { method: 'get', path: '/admin/attendance/teachers', query: { date: VALID_DATE } },
        { auth: adminAuth },
      );
      expect(res.body.data).toEqual([]);
      expect(res.body.total).toBe(0);
    });

    test.each(TEACHER_IDS)('includes teacher %s attendances', async (teacherId) => {
      (prismaMock.user.findMany as jest.Mock).mockResolvedValueOnce([mockTeacherRow(teacherId, 'T')]);
      const res = await sendRequest(
        { method: 'get', path: '/admin/attendance/teachers', query: { date: VALID_DATE } },
        { auth: adminAuth },
      );
      expect(res.body.data[0].id).toBe(teacherId);
      expect(res.body.data[0].attendances).toBeDefined();
    });

    test.each(SINGLE_DATES)('filters teacher attendance by date %s', async (date) => {
      await sendRequest(
        { method: 'get', path: '/admin/attendance/teachers', query: { date } },
        { auth: adminAuth },
      );
      const call = (prismaMock.user.findMany as jest.Mock).mock.calls.at(-1)?.[0];
      expect(call.select.teacherAttendances.where.date).toEqual({ equals: new Date(date) });
    });

    test.each(DATE_RANGES)('filters teacher attendance by range %s — %s', async (from, to) => {
      await sendRequest(
        { method: 'get', path: '/admin/attendance/teachers', query: { from, to } },
        { auth: adminAuth },
      );
      const call = (prismaMock.user.findMany as jest.Mock).mock.calls.at(-1)?.[0];
      expect(call.select.teacherAttendances.where.date).toEqual({
        gte: new Date(from),
        lte: new Date(to),
      });
    });

    test('queries active teachers in branch', async () => {
      await sendRequest(
        { method: 'get', path: '/admin/attendance/teachers', query: { date: VALID_DATE } },
        { auth: adminAuth },
      );
      const call = (prismaMock.user.findMany as jest.Mock).mock.calls.at(-1)?.[0];
      expect(call.where).toMatchObject({
        role: 'teacher',
        status: 'active',
        branchMembers: { some: { branchId: TEST_BRANCH_ID, isActive: true } },
      });
    });
  });

  // ─── 9. POST /admin/attendance/teachers/batch ───────────────────

  describe('POST /admin/attendance/teachers/batch', () => {
    const basePath = '/admin/attendance/teachers/batch';

    test.each([
      ['missing date', { records: [] }],
      ['missing records', { date: VALID_DATE }],
      ['records not array', { date: VALID_DATE, records: 'x' }],
      ['future date', { date: '2099-01-01', records: [{ teacherId: TEACHER_ID, status: 'present' }] }],
    ])('400 — %s', async (_label, body) => {
      const res = await request(app).post(basePath).query(scopeQuery).set(adminAuth).send(body);
      expect(res.status).toBe(400);
    });

    test('400 — teacher not active in branch', async () => {
      (prismaMock.user.findMany as jest.Mock).mockResolvedValueOnce([]);
      const res = await request(app)
        .post(basePath)
        .query(scopeQuery)
        .set(adminAuth)
        .send({ date: VALID_DATE, records: [{ teacherId: TEACHER_ID, status: 'present' }] });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/not active in the selected branch/i);
    });

    test('400 — attendance outside employee tenure', async () => {
      (prismaMock.branchMember.findUnique as jest.Mock).mockResolvedValueOnce({
        id: 'bm-1',
        isActive: true,
        tenures: [{ joinedAt: new Date('2026-07-01'), leftAt: null, sequence: 1 }],
      });
      const res = await request(app)
        .post(basePath)
        .query(scopeQuery)
        .set(adminAuth)
        .send({ date: VALID_DATE, records: [{ teacherId: TEACHER_ID, status: 'present' }] });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/tenure|joining/i);
    });

    test.each(ATTENDANCE_STATUSES)('saves teacher status %s', async (status) => {
      const res = await request(app)
        .post(basePath)
        .query(scopeQuery)
        .set(adminAuth)
        .send({ date: VALID_DATE, records: [{ teacherId: TEACHER_ID, status }] });
      expect(res.status).toBe(200);
      const call = (prismaMock.teacherAttendance.upsert as jest.Mock).mock.calls.at(-1)?.[0];
      expect(call.create.status).toBe(status);
    });

    test.each(TEACHER_IDS.slice(0, 3))('upserts teacher %s attendance', async (teacherId) => {
      (prismaMock.user.findMany as jest.Mock).mockResolvedValueOnce([{ id: teacherId }]);
      mockTenuredBranchMember(teacherId);
      await request(app)
        .post(basePath)
        .query(scopeQuery)
        .set(adminAuth)
        .send({ date: VALID_DATE, records: [{ teacherId, status: 'present' }] });
      expect(prismaMock.teacherAttendance.upsert).toHaveBeenCalled();
    });
  });

  // ─── 10. GET /admin/attendance/staff ─────────────────────────────

  describe('GET /admin/attendance/staff', () => {
    test.each(['management', 'canteen_staff', 'worker'] as const)(
      'maps payroll role %s in response',
      async (role) => {
        (prismaMock.user.findMany as jest.Mock).mockResolvedValueOnce([mockStaffRow(STAFF_USER_ID, 'Worker', role)]);
        const res = await sendRequest(
          { method: 'get', path: '/admin/attendance/staff', query: { date: VALID_DATE } },
          { auth: adminAuth },
        );
        expect(res.body.data[0].branchRole).toBe(role);
      },
    );

    test('includes employeeId from staff profile', async () => {
      const res = await sendRequest(
        { method: 'get', path: '/admin/attendance/staff', query: { date: VALID_DATE } },
        { auth: adminAuth },
      );
      expect(res.body.data[0].employeeId).toBe(`EMP-${STAFF_IDS[0]}`);
    });

    test.each(SINGLE_DATES)('filters staff attendance by date %s', async (date) => {
      await sendRequest(
        { method: 'get', path: '/admin/attendance/staff', query: { date } },
        { auth: adminAuth },
      );
      const call = (prismaMock.user.findMany as jest.Mock).mock.calls.at(-1)?.[0];
      expect(call.select.staffAttendances.where.date).toEqual({ equals: new Date(date) });
    });

    test.each(STAFF_IDS)('returns staff member %s', async (staffId) => {
      (prismaMock.user.findMany as jest.Mock).mockResolvedValueOnce([mockStaffRow(staffId, 'S', 'worker')]);
      const res = await sendRequest(
        { method: 'get', path: '/admin/attendance/staff', query: { date: VALID_DATE } },
        { auth: adminAuth },
      );
      expect(res.body.data[0].id).toBe(staffId);
    });
  });

  // ─── 11. POST /admin/attendance/staff/batch ─────────────────────

  describe('POST /admin/attendance/staff/batch', () => {
    const basePath = '/admin/attendance/staff/batch';

    test.each([
      ['missing date', { records: [] }],
      ['missing records', { date: VALID_DATE }],
      ['records not array', { date: VALID_DATE, records: 42 }],
      ['future date', { date: '2099-12-31', records: [{ staffUserId: STAFF_USER_ID, status: 'present' }] }],
    ])('400 — %s', async (_label, body) => {
      const res = await request(app).post(basePath).query(scopeQuery).set(adminAuth).send(body);
      expect(res.status).toBe(400);
    });

    test('400 — staff not active in branch', async () => {
      (prismaMock.user.findMany as jest.Mock).mockResolvedValueOnce([]);
      const res = await request(app)
        .post(basePath)
        .query(scopeQuery)
        .set(adminAuth)
        .send({ date: VALID_DATE, records: [{ staffUserId: STAFF_USER_ID, status: 'present' }] });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/not active in the selected branch/i);
    });

    test.each(ATTENDANCE_STATUSES)('saves staff status %s', async (status) => {
      const res = await request(app)
        .post(basePath)
        .query(scopeQuery)
        .set(adminAuth)
        .send({ date: VALID_DATE, records: [{ staffUserId: STAFF_USER_ID, status }] });
      expect(res.status).toBe(200);
      const call = (prismaMock.staffAttendance.upsert as jest.Mock).mock.calls.at(-1)?.[0];
      expect(call.create.status).toBe(status);
    });

    test.each(STAFF_IDS.slice(0, 3))('upserts staff %s attendance', async (staffUserId) => {
      (prismaMock.user.findMany as jest.Mock).mockResolvedValueOnce([{ id: staffUserId }]);
      mockTenuredBranchMember(staffUserId);
      await request(app)
        .post(basePath)
        .query(scopeQuery)
        .set(adminAuth)
        .send({ date: VALID_DATE, records: [{ staffUserId, status: 'present' }] });
      expect(prismaMock.staffAttendance.upsert).toHaveBeenCalled();
    });
  });

  // ─── 12. POST /admin/attendance/notify ────────────────────────────

  describe('POST /admin/attendance/notify', () => {
    const basePath = '/admin/attendance/notify';

    test.each([
      ['missing date', { records: [{ studentId: STUDENT_ID, status: 'absent' }] }],
      ['missing records', { date: VALID_DATE }],
      ['records not array', { date: VALID_DATE, records: null }],
    ])('400 — %s', async (_label, body) => {
      const res = await request(app).post(basePath).query(scopeQuery).set(adminAuth).send(body);
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/required/i);
    });

    test('400 — students not in branch or academic year', async () => {
      (prismaMock.student.findMany as jest.Mock).mockResolvedValueOnce([]);
      const res = await request(app)
        .post(basePath)
        .query(scopeQuery)
        .set(adminAuth)
        .send({ date: VALID_DATE, records: [{ studentId: STUDENT_ID, status: 'absent' }] });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/not in the selected branch/i);
    });

    test('skips duplicate notifications', async () => {
      (prismaMock.attendanceNotification.findFirst as jest.Mock).mockResolvedValueOnce({ id: 'existing' });
      const res = await request(app)
        .post(basePath)
        .query(scopeQuery)
        .set(adminAuth)
        .send({ date: VALID_DATE, records: [{ studentId: STUDENT_ID, status: 'absent' }] });
      expect(res.status).toBe(200);
      expect(res.body.data.queued).toBe(0);
      expect(prismaMock.attendanceNotification.create).not.toHaveBeenCalled();
    });

    test.each(NOTIFY_STATUSES)('queues notification for status %s', async (status) => {
      const res = await request(app)
        .post(basePath)
        .query(scopeQuery)
        .set(adminAuth)
        .send({ date: VALID_DATE, records: [{ studentId: STUDENT_ID, status }] });
      expect(res.status).toBe(200);
      expect(res.body.data.queued).toBe(1);
      const call = (prismaMock.attendanceNotification.create as jest.Mock).mock.calls.at(-1)?.[0];
      expect(call.data.status).toBe(status);
      expect(call.data.message).toMatch(/You (were marked|arrived late)/);
    });

    test('skips unknown status without creating notification', async () => {
      const res = await request(app)
        .post(basePath)
        .query(scopeQuery)
        .set(adminAuth)
        .send({ date: VALID_DATE, records: [{ studentId: STUDENT_ID, status: 'custom' }] });
      expect(res.status).toBe(200);
      expect(res.body.data.queued).toBe(0);
      expect(prismaMock.attendanceNotification.create).not.toHaveBeenCalled();
    });

    test('returns queued count for multiple new notifications', async () => {
      const res = await request(app)
        .post(basePath)
        .query(scopeQuery)
        .set(adminAuth)
        .send({
          date: VALID_DATE,
          records: [
            { studentId: 's1', status: 'absent' },
            { studentId: 's2', status: 'late' },
          ],
        });
      expect(res.body.data.queued).toBe(2);
      expect(res.body.data.message).toMatch(/Attendance contact/i);
    });

    test('skips records missing studentId or status', async () => {
      const res = await request(app)
        .post(basePath)
        .query(scopeQuery)
        .set(adminAuth)
        .send({
          date: VALID_DATE,
          records: [{ studentId: STUDENT_ID }, { status: 'absent' }, {}],
        });
      expect(res.status).toBe(200);
      expect(res.body.data.queued).toBe(0);
    });

    test.each(STUDENT_IDS.slice(0, 3))('queues notification for student %s', async (studentId) => {
      const res = await request(app)
        .post(basePath)
        .query(scopeQuery)
        .set(adminAuth)
        .send({ date: VALID_DATE, records: [{ studentId, status: 'absent' }] });
      expect(res.status).toBe(200);
      expect(prismaMock.attendanceNotification.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ studentId }) }),
      );
    });
  });
});
