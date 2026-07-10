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
  academicYearId: 'ay-demo',
  classGroupId: null,
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

const classRoom = {
  id: 'room-class',
  kind: 'class_announcement' as const,
  branchId: TEST_BRANCH,
  academicYearId: 'ay-demo',
  classGroupId: 'group-1',
  onlyStaffCanPost: true,
};

const groupRoom = {
  id: 'room-group',
  kind: 'group_chat' as const,
  branchId: TEST_BRANCH,
  academicYearId: 'ay-demo',
  classGroupId: 'group-1',
  onlyStaffCanPost: false,
};

const activeMember = {
  canPost: true,
  access: 'moderator' as const,
  isMuted: false,
  isPostingRestricted: false,
  canRead: true,
};

describe('chat permissions — class announcement', () => {
  beforeEach(() => jest.clearAllMocks());

  test('class teacher can post in class announcement', async () => {
    (prismaMock.teacherAssignment.findFirst as jest.Mock).mockResolvedValue({ id: 'asgn-1' });

    const allowed = await resolveCanPost(TEACHER_USER, classRoom, activeMember);
    expect(allowed).toBe(true);
  });

  test('subject-only teacher cannot post in class announcement', async () => {
    (prismaMock.teacherAssignment.findFirst as jest.Mock).mockResolvedValue(null);

    const allowed = await resolveCanPost(TEACHER_USER, classRoom, activeMember);
    expect(allowed).toBe(false);
  });

  test('branch admin can post in class announcement', async () => {
    (prismaMock.user.findUnique as jest.Mock).mockResolvedValue({
      id: ADMIN_USER,
      role: 'management',
      status: 'active',
    });
    (prismaMock.branchMember.findUnique as jest.Mock).mockResolvedValue({
      role: 'branch_admin',
      isActive: true,
    });

    const allowed = await resolveCanPost(ADMIN_USER, classRoom, activeMember);
    expect(allowed).toBe(true);
  });
});

describe('chat permissions — subject group', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (prismaMock.user.findUnique as jest.Mock).mockResolvedValue({
      id: TEACHER_USER,
      role: 'teacher',
      status: 'active',
    });
    (prismaMock.branchMember.findUnique as jest.Mock).mockResolvedValue({
      role: 'teacher',
      isActive: true,
    });
  });

  test('assigned subject teacher can post in group chat', async () => {
    (prismaMock.chatRoom.findUnique as jest.Mock).mockResolvedValue({
      teacherAssignmentId: 'asgn-math',
      communityId: 'comm-1',
    });
    (prismaMock.teacherAssignment.findUnique as jest.Mock).mockResolvedValue({
      teacherId: TEACHER_USER,
    });

    const allowed = await resolveCanPost(TEACHER_USER, groupRoom, activeMember);
    expect(allowed).toBe(true);
  });

  test('student with class role can post when canPostInGroups is enabled', async () => {
    (prismaMock.chatRoom.findUnique as jest.Mock).mockResolvedValue({
      teacherAssignmentId: 'asgn-math',
      communityId: 'comm-1',
    });
    (prismaMock.teacherAssignment.findUnique as jest.Mock).mockResolvedValue({
      teacherId: 'other-teacher',
    });
    (prismaMock.classRoleAssignment.findFirst as jest.Mock).mockResolvedValue({ id: 'role-1' });

    const allowed = await resolveCanPost(STUDENT_USER, groupRoom, {
      ...activeMember,
      canPost: false,
      access: 'member',
    });
    expect(allowed).toBe(true);
  });

  test('unassigned teacher cannot post in group chat', async () => {
    (prismaMock.chatRoom.findUnique as jest.Mock).mockResolvedValue({
      teacherAssignmentId: 'asgn-math',
      communityId: 'comm-1',
    });
    (prismaMock.teacherAssignment.findUnique as jest.Mock).mockResolvedValue({
      teacherId: 'other-teacher',
    });
    (prismaMock.classRoleAssignment.findFirst as jest.Mock).mockResolvedValue(null);

    const allowed = await resolveCanPost(TEACHER_USER, groupRoom, activeMember);
    expect(allowed).toBe(false);
  });
});
