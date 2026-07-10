/**
 * Teacher portal chat API — landing + DM routes.
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

jest.mock('../../../src/modules/teacher/services/teacher-chat.service', () => ({
  getTeacherChatLanding: jest.fn(),
  openTeacherDirectMessage: jest.fn(),
}));

import {
  getTeacherChatLanding,
  openTeacherDirectMessage,
} from '../../../src/modules/teacher/services/teacher-chat.service';

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

const mockAssignments = [
  {
    id: 'asgn-1',
    academicYearId: TEST_AY_ID,
    groupId: 'g1',
    subjectId: 'sub1',
    isClassTeacher: true,
    role: 'primary',
    group: { id: 'g1', name: 'Class 5', section: 'A' },
    subject: { id: 'sub1', name: 'Mathematics', code: 'MATH' },
  },
];

function mockTeacherScopeHappyPath() {
  mockActiveAcademicYear();
  (prismaMock.user.findUnique as jest.Mock).mockResolvedValue(mockTeacherUser);
  (prismaMock.teacherProfile.findUnique as jest.Mock).mockResolvedValue(mockTeacherProfile);
  (prismaMock.branchMember.findUnique as jest.Mock).mockResolvedValue(mockBranchMember);
  (prismaMock.teacherAssignment.findMany as jest.Mock).mockResolvedValue(mockAssignments);
  (prismaMock.subject.findMany as jest.Mock).mockResolvedValue([]);
}

const mockLanding = {
  sections: [
    { key: 'school', title: 'School Announcement', rooms: [{ id: 'r1', kind: 'school_announcement' }] },
    { key: 'classes', title: 'My Classes', communities: [{ groupId: 'g1', groupLabel: 'Class 5 — A' }] },
  ],
  rooms: [],
  communities: [{ groupId: 'g1', groupLabel: 'Class 5 — A', rooms: [] }],
  contacts: [],
};

describe('Teacher portal — chat', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getTeacherChatLanding as jest.Mock).mockResolvedValue(mockLanding);
    (openTeacherDirectMessage as jest.Mock).mockResolvedValue({
      roomId: 'dm-1',
      name: 'Principal',
    });
  });

  test('GET /teacher/chat/landing 401 without token', async () => {
    const res = await request(app).get('/teacher/chat/landing').query(scopeQuery);
    expect(res.status).toBe(401);
  });

  test('GET /teacher/chat/landing 400 without academicYearId', async () => {
    mockTeacherScopeHappyPath();
    const res = await request(app)
      .get('/teacher/chat/landing')
      .query({ branchId: TEST_BRANCH_ID })
      .set(teacherToken);
    expect(res.status).toBe(400);
  });

  test('GET /teacher/chat/landing returns scoped landing payload', async () => {
    mockTeacherScopeHappyPath();
    const res = await request(app).get('/teacher/chat/landing').query(scopeQuery).set(teacherToken);

    expect(res.status).toBe(200);
    expect(res.body.data.communities).toHaveLength(1);
    expect(getTeacherChatLanding).toHaveBeenCalledWith({
      userId: 'teacher-u1',
      branchId: TEST_BRANCH_ID,
      academicYearId: TEST_AY_ID,
    });
  });

  test('POST /teacher/chat/dm 400 without participantUserId', async () => {
    mockTeacherScopeHappyPath();
    const res = await request(app)
      .post('/teacher/chat/dm')
      .query(scopeQuery)
      .set(teacherToken)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/participantUserId/i);
  });

  test('POST /teacher/chat/dm opens direct message room', async () => {
    mockTeacherScopeHappyPath();
    const res = await request(app)
      .post('/teacher/chat/dm')
      .query(scopeQuery)
      .set(teacherToken)
      .send({ participantUserId: 'admin-1' });

    expect(res.status).toBe(201);
    expect(res.body.data.roomId).toBe('dm-1');
    expect(openTeacherDirectMessage).toHaveBeenCalledWith({
      userId: 'teacher-u1',
      branchId: TEST_BRANCH_ID,
      academicYearId: TEST_AY_ID,
      participantUserId: 'admin-1',
    });
  });
});
