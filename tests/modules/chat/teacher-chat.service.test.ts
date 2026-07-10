import { prismaMock } from '../../mocks/prisma';
import { getTeacherChatLanding } from '../../../src/modules/teacher/services/teacher-chat.service';

jest.mock('../../../src/modules/chat/services/teacher-chat-bootstrap.service', () => ({
  ensureTeacherChatBootstrap: jest.fn().mockResolvedValue(undefined),
  groupLabel: (name: string, section: string | null) => (section ? `${name} — ${section}` : name),
}));

const mockListRoomsForUser = jest.fn();
jest.mock('../../../src/modules/chat/services/chat-access.service', () => ({
  listRoomsForUser: (...args: unknown[]) => mockListRoomsForUser(...args),
}));

const TEACHER_ID = 'teacher-u1';
const BRANCH_ID = 'branch-1';
const AY_ID = 'ay-1';
const GROUP_A = 'group-a';
const GROUP_B = 'group-b';

describe('getTeacherChatLanding', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    (prismaMock.teacherAssignment.findMany as jest.Mock).mockResolvedValue([
      { id: 'asgn-a-math', groupId: GROUP_A },
      { id: 'asgn-b-eng', groupId: GROUP_B },
    ]);

    mockListRoomsForUser.mockResolvedValue([
      {
        id: 'school',
        kind: 'school_announcement',
        name: 'School Announcement',
        unreadCount: 0,
        lastMessageAt: null,
        canPost: false,
        classGroupId: null,
      },
      {
        id: 'teachers',
        kind: 'teacher_announcement',
        name: 'Teachers Announcement',
        unreadCount: 1,
        lastMessageAt: null,
        canPost: true,
        classGroupId: null,
      },
      {
        id: 'class-a',
        kind: 'class_announcement',
        name: 'Playgroup Announcements',
        unreadCount: 0,
        lastMessageAt: null,
        canPost: true,
        classGroupId: GROUP_A,
      },
      {
        id: 'group-a-math',
        kind: 'group_chat',
        name: 'Mathematics',
        unreadCount: 2,
        lastMessageAt: null,
        canPost: true,
        classGroupId: GROUP_A,
      },
      {
        id: 'group-a-sci',
        kind: 'group_chat',
        name: 'Science',
        unreadCount: 5,
        lastMessageAt: null,
        canPost: false,
        classGroupId: GROUP_A,
      },
      {
        id: 'group-b-eng',
        kind: 'group_chat',
        name: 'English',
        unreadCount: 0,
        lastMessageAt: null,
        canPost: true,
        classGroupId: GROUP_B,
      },
    ]);

    (prismaMock.chatRoom.findMany as jest.Mock).mockResolvedValue([
      { id: 'group-a-math', teacherAssignmentId: 'asgn-a-math' },
      { id: 'group-a-sci', teacherAssignmentId: 'asgn-other-teacher' },
      { id: 'group-b-eng', teacherAssignmentId: 'asgn-b-eng' },
    ]);

    (prismaMock.group.findMany as jest.Mock).mockResolvedValue([
      { id: GROUP_A, name: 'Playgroup', section: 'A', displayOrder: 1 },
      { id: GROUP_B, name: 'Class 5', section: 'B', displayOrder: 2 },
    ]);

    (prismaMock.branchMember.findMany as jest.Mock).mockResolvedValue([
      {
        user: { id: 'admin-1', name: 'Principal', role: 'management', status: 'active' },
      },
    ]);
    (prismaMock.chatDmThread.findMany as jest.Mock).mockResolvedValue([]);
  });

  test('returns only assigned class communities and subject groups', async () => {
    const landing = await getTeacherChatLanding({
      userId: TEACHER_ID,
      branchId: BRANCH_ID,
      academicYearId: AY_ID,
    });

    expect(landing.communities).toHaveLength(2);

    const playgroup = landing.communities.find((c) => c.groupId === GROUP_A)!;
    expect(playgroup.groupLabel).toBe('Playgroup — A');
    expect(playgroup.rooms.map((r) => r.id)).toEqual(['class-a', 'group-a-math']);
    expect(playgroup.unreadCount).toBe(2);

    const class5 = landing.communities.find((c) => c.groupId === GROUP_B)!;
    expect(class5.rooms.map((r) => r.id)).toEqual(['group-b-eng']);
  });

  test('includes school and teacher announcement sections', async () => {
    const landing = await getTeacherChatLanding({
      userId: TEACHER_ID,
      branchId: BRANCH_ID,
      academicYearId: AY_ID,
    });

    const school = landing.sections.find((s) => s.key === 'school');
    const teachers = landing.sections.find((s) => s.key === 'teachers');
    const classes = landing.sections.find((s) => s.key === 'classes');

    expect(school?.rooms?.map((r) => r.kind)).toEqual(['school_announcement']);
    expect(teachers?.rooms?.map((r) => r.kind)).toEqual(['teacher_announcement']);
    expect(classes?.title).toBe('My Classes');
    expect(classes?.communities).toHaveLength(2);
  });

  test('lists staff contacts excluding self', async () => {
    const landing = await getTeacherChatLanding({
      userId: TEACHER_ID,
      branchId: BRANCH_ID,
      academicYearId: AY_ID,
    });

    expect(landing.contacts).toHaveLength(1);
    expect(landing.contacts[0].name).toBe('Principal');
  });
});
