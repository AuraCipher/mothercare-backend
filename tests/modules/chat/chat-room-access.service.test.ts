import { prismaMock } from '../../mocks/prisma';
import { ensureChatRoomAccess } from '../../../src/modules/chat/services/chat-room-access.service';
import { ensureRoomMembership } from '../../../src/modules/chat/services/chat-access.service';
import { ensureStudentChatBootstrap } from '../../../src/modules/chat/services/chat-community.bootstrap';
import {
  syncSchoolAnnouncementMembers,
  syncTeacherAnnouncementMembers,
} from '../../../src/modules/chat/services/chat-branch-settings.service';
import { isBranchChatAdmin } from '../../../src/modules/chat/services/chat-permissions.service';

jest.mock('../../../src/modules/chat/services/chat-access.service', () => ({
  ensureRoomMembership: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../../src/modules/chat/services/chat-student-room-access.service', () => ({
  ensureStudentSystemRoomAccess: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../../src/modules/chat/services/chat-community.bootstrap', () => ({
  ensureStudentChatBootstrap: jest.fn().mockResolvedValue({ communityId: 'community-1' }),
}));

jest.mock('../../../src/modules/chat/services/chat-branch-settings.service', () => ({
  syncSchoolAnnouncementMembers: jest.fn().mockResolvedValue(null),
  syncTeacherAnnouncementMembers: jest.fn().mockResolvedValue(null),
}));

jest.mock('../../../src/modules/chat/services/chat-permissions.service', () => ({
  isBranchChatAdmin: jest.fn(),
}));

const ADMIN_ID = 'admin-1';
const TEACHER_ID = 'teacher-1';
const STUDENT_ID = 'student-1';
const ROOM_ID = 'room-school';
const BRANCH_ID = 'branch-1';
const AY_ID = 'ay-1';

describe('ensureChatRoomAccess', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (prismaMock.chatRoomMember.findFirst as jest.Mock).mockResolvedValue(null);
    (prismaMock.chatRoom.findUnique as jest.Mock).mockResolvedValue({
      id: ROOM_ID,
      kind: 'school_announcement',
      branchId: BRANCH_ID,
      academicYearId: AY_ID,
      classGroupId: null,
      studentId: null,
      teacherAssignmentId: null,
      isActive: true,
    });
    (prismaMock.user.findUnique as jest.Mock).mockResolvedValue({
      id: ADMIN_ID,
      role: 'management',
      status: 'active',
    });
  });

  test('skips healing when active membership already exists', async () => {
    (prismaMock.chatRoomMember.findFirst as jest.Mock).mockResolvedValue({
      room: { isActive: true },
    });

    await ensureChatRoomAccess(ROOM_ID, ADMIN_ID);

    expect(isBranchChatAdmin).not.toHaveBeenCalled();
    expect(ensureRoomMembership).not.toHaveBeenCalled();
  });

  test('heals branch admin membership for school announcement room', async () => {
    (isBranchChatAdmin as jest.Mock).mockResolvedValue(true);

    await ensureChatRoomAccess(ROOM_ID, ADMIN_ID);

    expect(syncSchoolAnnouncementMembers).toHaveBeenCalledWith(BRANCH_ID, AY_ID);
    expect(ensureRoomMembership).toHaveBeenCalledWith(ROOM_ID, ADMIN_ID, {
      access: 'moderator',
      canPost: true,
    });
  });

  test('heals teacher membership for class announcement room', async () => {
    (isBranchChatAdmin as jest.Mock).mockResolvedValue(false);
    (prismaMock.user.findUnique as jest.Mock).mockResolvedValue({
      id: TEACHER_ID,
      role: 'teacher',
      status: 'active',
    });
    (prismaMock.chatRoom.findUnique as jest.Mock).mockResolvedValue({
      id: 'room-class',
      kind: 'class_announcement',
      branchId: BRANCH_ID,
      academicYearId: AY_ID,
      classGroupId: 'group-1',
      studentId: null,
      teacherAssignmentId: null,
      isActive: true,
    });
    (prismaMock.teacherAssignment.findFirst as jest.Mock).mockResolvedValue({ id: 'asgn-1' });

    await ensureChatRoomAccess('room-class', TEACHER_ID);

    expect(ensureRoomMembership).toHaveBeenCalledWith('room-class', TEACHER_ID, {
      access: 'moderator',
      canPost: true,
    });
  });

  test('heals student membership via student bootstrap', async () => {
    (isBranchChatAdmin as jest.Mock).mockResolvedValue(false);
    (prismaMock.user.findUnique as jest.Mock).mockResolvedValue({
      id: STUDENT_ID,
      role: 'student',
      status: 'active',
    });
    (prismaMock.chatRoom.findUnique as jest.Mock).mockResolvedValue({
      id: 'room-class',
      kind: 'class_announcement',
      branchId: BRANCH_ID,
      academicYearId: AY_ID,
      classGroupId: 'group-1',
      studentId: null,
      teacherAssignmentId: null,
      isActive: true,
    });
    (prismaMock.student.findFirst as jest.Mock).mockResolvedValue({
      id: 'student-row-1',
      name: 'Ali',
      groupId: 'group-1',
      group: { id: 'group-1', name: 'Class 5', section: 'A' },
    });

    await ensureChatRoomAccess('room-class', STUDENT_ID);

    expect(ensureStudentChatBootstrap).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: STUDENT_ID,
        studentId: 'student-row-1',
        groupId: 'group-1',
        academicYearId: AY_ID,
        branchId: BRANCH_ID,
      }),
    );
  });

  test('heals teacher announcement room for teachers via sync', async () => {
    (isBranchChatAdmin as jest.Mock).mockResolvedValue(false);
    (prismaMock.user.findUnique as jest.Mock).mockResolvedValue({
      id: TEACHER_ID,
      role: 'teacher',
      status: 'active',
    });
    (prismaMock.chatRoom.findUnique as jest.Mock).mockResolvedValue({
      id: 'room-teachers',
      kind: 'teacher_announcement',
      branchId: BRANCH_ID,
      academicYearId: AY_ID,
      classGroupId: null,
      studentId: null,
      teacherAssignmentId: null,
      isActive: true,
    });

    await ensureChatRoomAccess('room-teachers', TEACHER_ID);

    expect(syncTeacherAnnouncementMembers).toHaveBeenCalledWith(BRANCH_ID, AY_ID);
  });
});
