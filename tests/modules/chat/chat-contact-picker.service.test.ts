import {
  getAdminContactPicker,
  getStudentContactPicker,
  getTeacherContactPicker,
} from '../../../src/modules/chat/services/chat-contact-picker.service';
import { prisma } from '../../../src/lib/prisma';

jest.mock('../../../src/lib/prisma', () => ({
  prisma: {
    chatDmThread: { findMany: jest.fn() },
    branchMember: { findMany: jest.fn() },
    teacherAssignment: { findMany: jest.fn() },
    group: { findMany: jest.fn() },
    student: { findMany: jest.fn() },
  },
}));

const mockPrisma = prisma as jest.Mocked<typeof prisma>;

const baseInput = {
  userId: 'admin-u1',
  branchId: 'branch-1',
  academicYearId: 'ay-1',
  groupId: 'group-1',
};

beforeEach(() => {
  jest.clearAllMocks();
  (mockPrisma.chatDmThread.findMany as jest.Mock).mockResolvedValue([]);
});

describe('chat-contact-picker.service', () => {
  test('getAdminContactPicker excludes current user and super_admin CEO', async () => {
    (mockPrisma.branchMember.findMany as jest.Mock).mockResolvedValue([
      {
        role: 'teacher',
        user: { id: 'teacher-u1', name: 'Ms. Sarah' },
      },
    ]);
    (mockPrisma.group.findMany as jest.Mock).mockResolvedValue([]);

    const picker = await getAdminContactPicker(baseInput);
    const contactIds = [
      ...picker.sections.flatMap((s) => s.contacts.map((c) => c.userId)),
      ...picker.classGroups.flatMap((g) => g.contacts.map((c) => c.userId)),
    ];

    expect(contactIds).not.toContain('admin-u1');
    expect(contactIds).toContain('teacher-u1');
    expect(mockPrisma.branchMember.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: { not: 'admin-u1' },
          user: expect.objectContaining({ role: { not: 'super_admin' } }),
        }),
      }),
    );
  });

  test('getStudentContactPicker excludes current user from administration', async () => {
    (mockPrisma.branchMember.findMany as jest.Mock).mockResolvedValue([
      {
        role: 'branch_admin',
        user: { id: 'principal-u1', name: 'Principal' },
      },
    ]);
    (mockPrisma.teacherAssignment.findMany as jest.Mock).mockResolvedValue([
      {
        isClassTeacher: true,
        teacher: { id: 'student-u1', name: 'Self Student', status: 'active' },
      },
      {
        isClassTeacher: true,
        teacher: { id: 'teacher-u1', name: 'Ms. Sarah', status: 'active' },
      },
    ]);

    const picker = await getStudentContactPicker({
      ...baseInput,
      userId: 'student-u1',
    });
    const contactIds = picker.sections.flatMap((s) => s.contacts.map((c) => c.userId));

    expect(contactIds).not.toContain('student-u1');
    expect(contactIds).toContain('teacher-u1');
    expect(contactIds).toContain('principal-u1');
  });

  test('getTeacherContactPicker excludes current user from staff sections', async () => {
    (mockPrisma.teacherAssignment.findMany as jest.Mock)
      .mockResolvedValueOnce([{ groupId: 'group-1' }])
      .mockResolvedValueOnce([]);
    (mockPrisma.branchMember.findMany as jest.Mock)
      .mockResolvedValueOnce([
        { role: 'branch_admin', user: { id: 'principal-u1', name: 'Principal' } },
      ])
      .mockResolvedValueOnce([
        { role: 'teacher', user: { id: 'teacher-u2', name: 'Colleague' } },
      ]);
    (mockPrisma.group.findMany as jest.Mock).mockResolvedValue([]);

    const picker = await getTeacherContactPicker({
      userId: 'teacher-u1',
      branchId: 'branch-1',
      academicYearId: 'ay-1',
    });
    const contactIds = picker.sections.flatMap((s) => s.contacts.map((c) => c.userId));

    expect(contactIds).not.toContain('teacher-u1');
    expect(contactIds).toContain('teacher-u2');
    expect(contactIds).toContain('principal-u1');
  });
});
