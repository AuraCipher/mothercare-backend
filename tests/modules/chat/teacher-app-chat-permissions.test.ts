import { prismaMock } from '../../mocks/prisma';
import {
  appChatAllowsPost,
  loadTeacherAppChatPermissions,
  teacherAppChatAllowsPost,
} from '../../../src/modules/chat/services/teacher-app-chat-permissions.service';

const TEACHER_ID = 'teacher-u1';
const BRANCH_ID = 'branch-1';

const mockProfile = {
  portalAccess: 'FULL' as const,
  portalPermissions: { app: { schoolAnnouncementPost: 'deny' } },
  canViewParentContact: false,
  hodParentContactScope: 'ASSIGNED_ONLY' as const,
};

describe('teacher app chat permissions', () => {
  beforeEach(() => jest.clearAllMocks());

  test('appChatAllowsPost maps room kinds to sub-features', () => {
    const app = {
      allowed: true,
      canSchoolAnnouncementPost: false,
      canTeachersAnnouncementPost: true,
      canClassAnnouncementPost: true,
      canSubjectGroupPost: false,
      canDirectMessages: true,
      canAttachments: true,
    };
    expect(appChatAllowsPost(app, 'school_announcement')).toBe(false);
    expect(appChatAllowsPost(app, 'teacher_announcement')).toBe(true);
    expect(appChatAllowsPost(app, 'group_chat')).toBe(false);
  });

  test('loadTeacherAppChatPermissions resolves app flags from profile', async () => {
    (prismaMock.user.findUnique as jest.Mock).mockResolvedValue({
      id: TEACHER_ID,
      role: 'teacher',
      status: 'active',
    });
    (prismaMock.teacherProfile.findUnique as jest.Mock).mockResolvedValue(mockProfile);
    (prismaMock.branch.findUnique as jest.Mock).mockResolvedValue({
      teacherParentContactEnabled: true,
      teachersCanMarkAttendance: true,
      teachersCanEnterMarks: true,
    });

    const app = await loadTeacherAppChatPermissions(TEACHER_ID, BRANCH_ID);
    expect(app?.canSchoolAnnouncementPost).toBe(false);
    expect(app?.canTeachersAnnouncementPost).toBe(true);
  });

  test('teacherAppChatAllowsPost returns true for non-teachers', async () => {
    (prismaMock.user.findUnique as jest.Mock).mockResolvedValue({
      id: 'admin-1',
      role: 'management',
      status: 'active',
    });

    const ok = await teacherAppChatAllowsPost('admin-1', BRANCH_ID, 'school_announcement');
    expect(ok).toBe(true);
  });
});
