/**
 * Admin branch chat settings — school announcement poster appoint API.
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

const adminToken = getAuthHeader(
  generateTestToken('admin-1', 'management', {
    name: 'Demo Principal',
    branchIds: [TEST_BRANCH_ID],
  }),
);

const teacherPosterId = 'teacher-poster-1';

function mockBranchExists() {
  (prismaMock.branch.findUnique as jest.Mock).mockResolvedValue({
    id: TEST_BRANCH_ID,
    name: 'Test Branch',
    code: 'TST',
  });
}

function mockChatSettingsEmpty() {
  (prismaMock.branchChatSettings.upsert as jest.Mock).mockResolvedValue({
    branchId: TEST_BRANCH_ID,
    schoolAnnouncementPosterUserIds: [],
    teacherAnnouncementPosterUserIds: [],
    allowAllTeachersTeacherAnnouncement: false,
  });
}

describe('Admin — branch chat settings', () => {
  beforeEach(() => jest.clearAllMocks());

  test('GET /admin/branches/:id/chat-settings returns defaults', async () => {
    mockActiveAcademicYear();
    mockBranchExists();
    mockChatSettingsEmpty();

    const res = await request(app)
      .get(`/admin/branches/${TEST_BRANCH_ID}/chat-settings`)
      .query(scopeQuery)
      .set(adminToken);

    expect(res.status).toBe(200);
    expect(res.body.data.branchId).toBe(TEST_BRANCH_ID);
    expect(res.body.data.schoolAnnouncementPosterUserIds).toEqual([]);
  });

  test('PATCH appoints school announcement poster and syncs memberships', async () => {
    mockActiveAcademicYear();
    mockBranchExists();

    (prismaMock.user.findMany as jest.Mock)
      .mockResolvedValueOnce([
        {
          id: teacherPosterId,
          role: 'teacher',
          status: 'active',
          branchMembers: [{ id: 'bm-1' }],
        },
      ])
      .mockResolvedValueOnce([
        { id: teacherPosterId, name: 'Ms. Nadia', username: 'demo_teacher_playgroup' },
      ]);

    (prismaMock.branchChatSettings.upsert as jest.Mock).mockResolvedValue({
      branchId: TEST_BRANCH_ID,
      schoolAnnouncementPosterUserIds: [teacherPosterId],
      teacherAnnouncementPosterUserIds: [],
      allowAllTeachersTeacherAnnouncement: false,
    });

    (prismaMock.chatRoom.findFirst as jest.Mock).mockResolvedValue({
      id: 'school-room-1',
      kind: 'school_announcement',
      branchId: TEST_BRANCH_ID,
    });

    (prismaMock.branchMember.findMany as jest.Mock).mockResolvedValue([
      { userId: 'admin-1' },
    ]);
    (prismaMock.user.findMany as jest.Mock).mockImplementation(async (args: any) => {
      if (args?.where?.role === 'super_admin') return [];
      if (args?.where?.id?.in) {
        return [{ id: teacherPosterId, name: 'Ms. Nadia', username: 'demo_teacher_playgroup' }];
      }
      return [];
    });
    (prismaMock.chatRoomMember.findMany as jest.Mock).mockResolvedValue([]);
    (prismaMock.chatRoomMember.upsert as jest.Mock).mockResolvedValue({});

    const res = await request(app)
      .patch(`/admin/branches/${TEST_BRANCH_ID}/chat-settings`)
      .query(scopeQuery)
      .set(adminToken)
      .send({ schoolAnnouncementPosterUserIds: [teacherPosterId] });

    expect(res.status).toBe(200);
    expect(res.body.data.schoolAnnouncementPosterUserIds).toEqual([teacherPosterId]);
    expect(prismaMock.chatRoomMember.upsert).toHaveBeenCalled();
  });

  test('PATCH rejects non-teacher poster', async () => {
    mockActiveAcademicYear();
    mockBranchExists();

    (prismaMock.user.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'student-1',
        role: 'student',
        status: 'active',
        branchMembers: [{ id: 'bm-1' }],
      },
    ]);

    const res = await request(app)
      .patch(`/admin/branches/${TEST_BRANCH_ID}/chat-settings`)
      .query(scopeQuery)
      .set(adminToken)
      .send({ schoolAnnouncementPosterUserIds: ['student-1'] });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/active teachers/i);
  });

  test('PATCH allow-all teachers announcement syncs memberships', async () => {
    mockActiveAcademicYear();
    mockBranchExists();

    (prismaMock.branchChatSettings.upsert as jest.Mock).mockResolvedValue({
      branchId: TEST_BRANCH_ID,
      schoolAnnouncementPosterUserIds: [],
      teacherAnnouncementPosterUserIds: [],
      allowAllTeachersTeacherAnnouncement: true,
    });

    (prismaMock.chatRoom.findFirst as jest.Mock)
      .mockResolvedValueOnce({
        id: 'school-room-1',
        kind: 'school_announcement',
        branchId: TEST_BRANCH_ID,
      })
      .mockResolvedValueOnce({
        id: 'teacher-room-1',
        kind: 'teacher_announcement',
        branchId: TEST_BRANCH_ID,
      });

    (prismaMock.branchMember.findMany as jest.Mock).mockResolvedValue([
      { userId: 'teacher-2' },
    ]);
    (prismaMock.user.findMany as jest.Mock).mockResolvedValue([]);
    (prismaMock.chatRoomMember.findMany as jest.Mock).mockResolvedValue([]);
    (prismaMock.chatRoomMember.upsert as jest.Mock).mockResolvedValue({});

    const res = await request(app)
      .patch(`/admin/branches/${TEST_BRANCH_ID}/chat-settings`)
      .query(scopeQuery)
      .set(adminToken)
      .send({ allowAllTeachersTeacherAnnouncement: true });

    expect(res.status).toBe(200);
    expect(res.body.data.allowAllTeachersTeacherAnnouncement).toBe(true);
    expect(prismaMock.chatRoomMember.upsert).toHaveBeenCalled();
  });
});
