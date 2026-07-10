import { prismaMock } from '../../mocks/prisma';
import {
  isBranchChatAdmin,
  resolveCanPost,
} from '../../../src/modules/chat/services/chat-permissions.service';

const TEST_BRANCH = 'branch-demo';
const ADMIN_USER = 'admin-user';
const TEACHER_USER = 'teacher-user';
const STUDENT_USER = 'student-user';

const schoolRoom = {
  id: 'room-school',
  kind: 'school_announcement' as const,
  branchId: TEST_BRANCH,
  onlyStaffCanPost: true,
};

describe('chat permissions — school announcement', () => {
  beforeEach(() => jest.clearAllMocks());

  test('branch admin can post in school announcement', async () => {
    (prismaMock.user.findUnique as jest.Mock).mockResolvedValue({
      id: ADMIN_USER,
      role: 'management',
      status: 'active',
    });
    (prismaMock.branchMember.findUnique as jest.Mock).mockResolvedValue({
      role: 'branch_admin',
      isActive: true,
    });
    (prismaMock.branchChatSettings.upsert as jest.Mock).mockResolvedValue({
      schoolAnnouncementPosterUserIds: [],
    });

    const allowed = await resolveCanPost(ADMIN_USER, schoolRoom, {
      canPost: false,
      access: 'observer',
      isMuted: false,
      isPostingRestricted: false,
      canRead: true,
    });

    expect(allowed).toBe(true);
    expect(await isBranchChatAdmin(ADMIN_USER, TEST_BRANCH)).toBe(true);
  });

  test('appointed teacher can post in school announcement', async () => {
    (prismaMock.user.findUnique as jest.Mock).mockResolvedValue({
      id: TEACHER_USER,
      role: 'teacher',
      status: 'active',
    });
    (prismaMock.branchMember.findUnique as jest.Mock).mockResolvedValue({
      role: 'teacher',
      isActive: true,
    });
    (prismaMock.branchChatSettings.upsert as jest.Mock).mockResolvedValue({
      schoolAnnouncementPosterUserIds: [TEACHER_USER],
    });

    const allowed = await resolveCanPost(TEACHER_USER, schoolRoom, {
      canPost: false,
      access: 'observer',
      isMuted: false,
      isPostingRestricted: false,
      canRead: true,
    });

    expect(allowed).toBe(true);
  });

  test('regular teacher cannot post in school announcement', async () => {
    (prismaMock.user.findUnique as jest.Mock).mockResolvedValue({
      id: TEACHER_USER,
      role: 'teacher',
      status: 'active',
    });
    (prismaMock.branchMember.findUnique as jest.Mock).mockResolvedValue({
      role: 'teacher',
      isActive: true,
    });
    (prismaMock.branchChatSettings.upsert as jest.Mock).mockResolvedValue({
      schoolAnnouncementPosterUserIds: [],
    });

    const allowed = await resolveCanPost(TEACHER_USER, schoolRoom, {
      canPost: true,
      access: 'moderator',
      isMuted: false,
      isPostingRestricted: false,
      canRead: true,
    });

    expect(allowed).toBe(false);
  });

  test('student cannot post in school announcement', async () => {
    (prismaMock.branchChatSettings.upsert as jest.Mock).mockResolvedValue({
      schoolAnnouncementPosterUserIds: [],
    });
    (prismaMock.user.findUnique as jest.Mock).mockResolvedValue({
      id: STUDENT_USER,
      role: 'student',
      status: 'active',
    });
    (prismaMock.branchMember.findUnique as jest.Mock).mockResolvedValue(null);

    const allowed = await resolveCanPost(STUDENT_USER, schoolRoom, {
      canPost: false,
      access: 'observer',
      isMuted: false,
      isPostingRestricted: false,
      canRead: true,
    });

    expect(allowed).toBe(false);
  });

  test('muted member cannot post even if appointed', async () => {
    (prismaMock.branchChatSettings.upsert as jest.Mock).mockResolvedValue({
      schoolAnnouncementPosterUserIds: [TEACHER_USER],
    });

    const allowed = await resolveCanPost(TEACHER_USER, schoolRoom, {
      canPost: true,
      access: 'moderator',
      isMuted: true,
      isPostingRestricted: false,
      canRead: true,
    });

    expect(allowed).toBe(false);
  });
});
