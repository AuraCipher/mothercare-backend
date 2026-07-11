/**
 * Teacher my-attendance / my-payroll routes.
 */
import { prismaMock } from '../../mocks/prisma';
import request from 'supertest';
import app from '../../../src/app';
import { generateTestToken, getAuthHeader } from '../../helpers/auth';
import {
  TEST_AY_ID,
  TEST_BRANCH_ID,
  mockActiveAcademicYear,
  scopeQuery,
} from '../../helpers/integration';

jest.mock('../../../src/modules/admin/services/expenses.service', () => ({
  expensesService: {
    listPayrollHistory: jest.fn().mockResolvedValue([{ salaryMonth: 'July 2026', outgoingPayment: { amount: 5000000 } }]),
  },
}));

const teacherToken = getAuthHeader(
  generateTestToken('teacher-u1', 'teacher', {
    name: 'Ms. Sarah',
    branchIds: [TEST_BRANCH_ID],
  }),
);

const mockTeacherUser = {
  id: 'teacher-u1',
  name: 'Ms. Sarah',
  email: 'sarah@school.com',
  username: 'sarah',
  role: 'teacher',
  status: 'active',
  profilePhotoId: null,
};

const mockTeacherProfile = {
  id: 'tp-1',
  userId: 'teacher-u1',
  employeeId: 'TCH-001',
  portalAccess: 'FULL',
  canViewParentContact: false,
  hodParentContactScope: 'ASSIGNED_ONLY',
};

const mockBranchMember = {
  id: 'bm-t1',
  branchId: TEST_BRANCH_ID,
  userId: 'teacher-u1',
  role: 'teacher',
  isActive: true,
};

function mockTeacherScopeHappyPath() {
  mockActiveAcademicYear();
  (prismaMock.user.findUnique as jest.Mock).mockResolvedValue(mockTeacherUser);
  (prismaMock.teacherProfile.findUnique as jest.Mock).mockResolvedValue(mockTeacherProfile);
  (prismaMock.branchMember.findUnique as jest.Mock).mockResolvedValue(mockBranchMember);
  (prismaMock.teacherAssignment.findMany as jest.Mock).mockResolvedValue([]);
  (prismaMock.subject.findMany as jest.Mock).mockResolvedValue([]);
}

describe('Teacher personal records routes', () => {
  beforeEach(() => jest.clearAllMocks());

  test('GET /teacher/my-attendance returns rows', async () => {
    mockTeacherScopeHappyPath();
    (prismaMock.teacherAttendance.findMany as jest.Mock).mockResolvedValue([
      { id: 'ta1', date: new Date('2026-07-10'), status: 'present', note: null },
    ]);

    const res = await request(app)
      .get('/teacher/my-attendance')
      .query(scopeQuery)
      .set(teacherToken);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].status).toBe('present');
  });

  test('GET /teacher/my-payroll returns payroll history', async () => {
    mockTeacherScopeHappyPath();

    const res = await request(app)
      .get('/teacher/my-payroll')
      .query(scopeQuery)
      .set(teacherToken);

    expect(res.status).toBe(200);
    expect(res.body.data[0].salaryMonth).toBe('July 2026');
  });
});
