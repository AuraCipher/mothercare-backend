/**
 * Staff portal + campus read-only routes.
 */
import { prismaMock } from '../../mocks/prisma';
import request from 'supertest';
import app from '../../../src/app';
import { generateTestToken, getAuthHeader } from '../../helpers/auth';
import { TEST_AY_ID, TEST_BRANCH_ID, mockActiveAcademicYear } from '../../helpers/integration';

jest.mock('../../../src/modules/staff/services/staff-chat.service', () => ({
  getStaffChatLanding: jest.fn(),
  openStaffDirectMessage: jest.fn(),
  getStaffChatContacts: jest.fn(),
}));

jest.mock('../../../src/modules/staff/services/staff-profile.service', () => ({
  getStaffSelfProfile: jest.fn().mockResolvedValue({ name: 'Admin User' }),
}));

jest.mock('../../../src/modules/staff/services/staff-campus.service', () => ({
  getCampusOverview: jest.fn().mockResolvedValue({ studentCount: 120, classCount: 8, teacherCount: 12, staffCount: 4 }),
  getCampusFeesSummary: jest.fn().mockResolvedValue({ month: 7, year: 2026, totalDue: 1000, totalCollected: 800, pendingCount: 5, collectionRate: 80 }),
  listCampusStaff: jest.fn().mockResolvedValue([{ id: 'u1', name: 'Ms. Sarah', branchRole: 'teacher' }]),
  getCampusAttendanceToday: jest.fn().mockResolvedValue({ date: '2026-07-11', summary: { present: 100, absent: 5, late: 2, total: 107 }, classes: [] }),
  getCampusResultsSummary: jest.fn().mockResolvedValue([{ id: 'es1', name: 'Mid Term', examCount: 3 }]),
}));

const adminToken = getAuthHeader(
  generateTestToken('admin-1', 'management', {
    name: 'Demo Principal',
    branchIds: [TEST_BRANCH_ID],
  }),
);

const teacherToken = getAuthHeader(
  generateTestToken('teacher-u1', 'teacher', {
    name: 'Ms. Sarah',
    branchIds: [TEST_BRANCH_ID],
  }),
);

const scopeQuery = { branchId: TEST_BRANCH_ID, academicYearId: TEST_AY_ID };

describe('Staff portal routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockActiveAcademicYear();
    (prismaMock.branchMember.findFirst as jest.Mock).mockResolvedValue({
      branchId: TEST_BRANCH_ID,
      userId: 'admin-1',
      role: 'branch_admin',
      isActive: true,
    });
  });

  test('GET /staff/campus/overview requires scope', async () => {
    const res = await request(app).get('/staff/campus/overview').set(adminToken);
    expect(res.status).toBe(400);
  });

  test('GET /staff/campus/overview returns snapshot', async () => {
    const res = await request(app)
      .get('/staff/campus/overview')
      .query(scopeQuery)
      .set(adminToken);

    expect(res.status).toBe(200);
    expect(res.body.data.studentCount).toBe(120);
  });

  test('GET /staff/campus/fees returns summary', async () => {
    const res = await request(app)
      .get('/staff/campus/fees')
      .query(scopeQuery)
      .set(adminToken);

    expect(res.status).toBe(200);
    expect(res.body.data.collectionRate).toBe(80);
  });

  test('teacher cannot access staff campus routes', async () => {
    const res = await request(app)
      .get('/staff/campus/overview')
      .query(scopeQuery)
      .set(teacherToken);

    expect(res.status).toBe(403);
  });
});
