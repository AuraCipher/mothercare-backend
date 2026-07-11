/**
 * Direct message policy — class role gates + student contacts.
 */
import { prismaMock } from '../../mocks/prisma';
import {
  assertCanCreateDirectMessage,
  getStudentDmFlags,
  listStudentDmContacts,
} from '../../../src/modules/chat/services/chat-dm-policy.service';

jest.mock('../../../src/modules/chat/services/teacher-app-chat-permissions.service', () => ({
  teacherAppChatAllowsPost: jest.fn().mockResolvedValue(true),
}));

const STUDENT_USER = 'stu-user-1';
const TEACHER_USER = 'teacher-1';
const AY_ID = 'ay1';
const BRANCH_ID = 'b1';
const GROUP_ID = 'g1';

describe('chat-dm-policy.service', () => {
  beforeEach(() => jest.clearAllMocks());

  test('student without role cannot initiate DMs', async () => {
    (prismaMock.classRoleAssignment.findMany as jest.Mock).mockResolvedValue([]);

    const flags = await getStudentDmFlags(STUDENT_USER, AY_ID);
    expect(flags.canInitiate).toBe(false);
    expect(flags.canSend).toBe(false);
  });

  test('student with initiate role can start DMs', async () => {
    (prismaMock.classRoleAssignment.findMany as jest.Mock).mockResolvedValue([
      {
        isMessagingRestricted: false,
        roleDefinition: { canInitiateDms: true, canReceiveDms: true },
      },
    ]);

    const flags = await getStudentDmFlags(STUDENT_USER, AY_ID);
    expect(flags.canInitiate).toBe(true);
    expect(flags.canSend).toBe(true);
  });

  test('student may message class teacher when allowed', async () => {
    (prismaMock.user.findUnique as jest.Mock)
      .mockResolvedValueOnce({ id: STUDENT_USER, role: 'student', status: 'active' })
      .mockResolvedValueOnce({ id: TEACHER_USER, role: 'teacher', status: 'active', name: 'Ms. Sarah' });
    (prismaMock.classRoleAssignment.findMany as jest.Mock).mockResolvedValue([
      {
        isMessagingRestricted: false,
        roleDefinition: { canInitiateDms: true, canReceiveDms: true },
      },
    ]);
    (prismaMock.student.findFirst as jest.Mock).mockResolvedValue({
      id: 'stu-1',
      groupId: GROUP_ID,
      name: 'Ahmed',
    });
    (prismaMock.teacherAssignment.findFirst as jest.Mock).mockResolvedValue({ id: 'asgn-1' });

    await expect(
      assertCanCreateDirectMessage({
        initiatorUserId: STUDENT_USER,
        participantUserId: TEACHER_USER,
        branchId: BRANCH_ID,
        academicYearId: AY_ID,
      }),
    ).resolves.toBeUndefined();
  });

  test('student cannot message non-class-teacher staff', async () => {
    (prismaMock.user.findUnique as jest.Mock)
      .mockResolvedValueOnce({ id: STUDENT_USER, role: 'student', status: 'active' })
      .mockResolvedValueOnce({ id: TEACHER_USER, role: 'teacher', status: 'active', name: 'Other' });
    (prismaMock.classRoleAssignment.findMany as jest.Mock).mockResolvedValue([
      {
        isMessagingRestricted: false,
        roleDefinition: { canInitiateDms: true, canReceiveDms: true },
      },
    ]);
    (prismaMock.student.findFirst as jest.Mock).mockResolvedValue({
      id: 'stu-1',
      groupId: GROUP_ID,
      name: 'Ahmed',
    });
    (prismaMock.teacherAssignment.findFirst as jest.Mock).mockResolvedValue(null);

    await expect(
      assertCanCreateDirectMessage({
        initiatorUserId: STUDENT_USER,
        participantUserId: TEACHER_USER,
        branchId: BRANCH_ID,
        academicYearId: AY_ID,
      }),
    ).rejects.toMatchObject({ status: 403, message: expect.stringContaining('class teachers') });
  });

  test('listStudentDmContacts returns class teachers when student can initiate', async () => {
    (prismaMock.branchMember.findMany as jest.Mock).mockResolvedValue([]);
    (prismaMock.teacherAssignment.findMany as jest.Mock).mockResolvedValue([
      {
        isClassTeacher: true,
        teacher: { id: TEACHER_USER, name: 'Ms. Sarah', role: 'teacher', status: 'active' },
      },
    ]);
    (prismaMock.chatDmThread.findMany as jest.Mock).mockResolvedValue([]);

    const contacts = await listStudentDmContacts({
      userId: STUDENT_USER,
      branchId: BRANCH_ID,
      groupId: GROUP_ID,
      academicYearId: AY_ID,
    });

    expect(contacts).toHaveLength(1);
    expect(contacts[0].name).toBe('Ms. Sarah');
    expect(contacts[0].roleLabel).toBe('Class teacher');
  });
});
