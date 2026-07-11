import { prisma } from '../../../lib/prisma';
import { groupLabel } from './teacher-chat-bootstrap.service';

export type PickerContact = {
  userId: string;
  name: string;
  subtitle?: string | null;
  roleLabel: string;
  dmRoomId: string | null;
};

export type PickerSection = {
  key: string;
  title: string;
  contacts: PickerContact[];
};

export type PickerClassGroup = {
  groupId: string;
  groupLabel: string;
  contacts: PickerContact[];
};

export type ContactPickerData = {
  sections: PickerSection[];
  classGroups: PickerClassGroup[];
};

async function dmRoomMap(userId: string, academicYearId: string): Promise<Map<string, string>> {
  const dmThreads = await prisma.chatDmThread.findMany({
    where: {
      academicYearId,
      OR: [{ participantAId: userId }, { participantBId: userId }],
    },
    select: { roomId: true, participantAId: true, participantBId: true },
  });
  const map = new Map<string, string>();
  for (const t of dmThreads) {
    const other = t.participantAId === userId ? t.participantBId : t.participantAId;
    map.set(other, t.roomId);
  }
  return map;
}

function withDm(contacts: Omit<PickerContact, 'dmRoomId'>[], dm: Map<string, string>): PickerContact[] {
  return contacts.map((c) => ({ ...c, dmRoomId: dm.get(c.userId) ?? null }));
}

export async function getStudentContactPicker(input: {
  userId: string;
  branchId: string;
  groupId: string;
  academicYearId: string;
}): Promise<ContactPickerData> {
  const dm = await dmRoomMap(input.userId, input.academicYearId);

  const adminMembers = await prisma.branchMember.findMany({
    where: {
      branchId: input.branchId,
      isActive: true,
      role: { in: ['branch_admin', 'sub_admin', 'management'] },
      user: { status: 'active' },
    },
    include: { user: { select: { id: true, name: true } } },
    orderBy: { user: { name: 'asc' } },
  });

  const classTeachers = await prisma.teacherAssignment.findMany({
    where: { groupId: input.groupId, academicYearId: input.academicYearId },
    include: { teacher: { select: { id: true, name: true, status: true } } },
    orderBy: { teacher: { name: 'asc' } },
  });

  const adminContacts = withDm(
    adminMembers.map((m) => ({
      userId: m.user.id,
      name: m.user.name,
      roleLabel: m.role === 'branch_admin' ? 'Principal' : m.role === 'sub_admin' ? 'Admin' : 'Management',
    })),
    dm,
  );

  const teacherContacts = withDm(
    classTeachers
      .filter((a) => a.teacher.status === 'active')
      .map((a) => ({
        userId: a.teacher.id,
        name: a.teacher.name,
        roleLabel: a.isClassTeacher ? 'Class teacher' : 'Subject teacher',
      })),
    dm,
  );

  return {
    sections: [
      { key: 'administration', title: 'Administration', contacts: adminContacts },
      { key: 'teachers', title: 'Teachers', contacts: teacherContacts },
    ],
    classGroups: [],
  };
}

export async function getTeacherContactPicker(input: {
  userId: string;
  branchId: string;
  academicYearId: string;
}): Promise<ContactPickerData> {
  const dm = await dmRoomMap(input.userId, input.academicYearId);

  const assignments = await prisma.teacherAssignment.findMany({
    where: { teacherId: input.userId, academicYearId: input.academicYearId },
    select: { groupId: true },
  });
  const groupIds = [...new Set(assignments.map((a) => a.groupId))];

  const adminMembers = await prisma.branchMember.findMany({
    where: {
      branchId: input.branchId,
      isActive: true,
      userId: { not: input.userId },
      role: { in: ['branch_admin', 'sub_admin', 'management'] },
      user: { status: 'active' },
    },
    include: { user: { select: { id: true, name: true } } },
    orderBy: { user: { name: 'asc' } },
  });

  const teacherMembers = await prisma.branchMember.findMany({
    where: {
      branchId: input.branchId,
      isActive: true,
      userId: { not: input.userId },
      role: 'teacher',
      user: { status: 'active' },
    },
    include: { user: { select: { id: true, name: true } } },
    orderBy: { user: { name: 'asc' } },
  });

  const groups = await prisma.group.findMany({
    where: { id: { in: groupIds }, isActive: true },
    orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }, { section: 'asc' }],
    select: { id: true, name: true, section: true },
  });

  const classGroups: PickerClassGroup[] = [];
  for (const g of groups) {
    const students = await prisma.student.findMany({
      where: { groupId: g.id, academicYearId: input.academicYearId, isActive: true, status: 'ACTIVE' },
      select: {
        id: true,
        name: true,
        rollNumber: true,
        parents: {
          include: {
            parent: {
              include: { user: { select: { id: true, name: true, status: true } } },
            },
          },
        },
      },
      orderBy: [{ rollNumber: 'asc' }, { name: 'asc' }],
    });

    const parentContacts: PickerContact[] = [];
    const seenParents = new Set<string>();
    for (const s of students) {
      for (const sp of s.parents) {
        const parentUser = sp.parent.user;
        if (!parentUser || parentUser.status !== 'active' || seenParents.has(parentUser.id)) continue;
        seenParents.add(parentUser.id);
        parentContacts.push({
          userId: parentUser.id,
          name: parentUser.name,
          subtitle: `Parent of ${s.name}${s.rollNumber ? ' (Roll ${s.rollNumber})' : ''}`,
          roleLabel: sp.relation || 'Parent',
          dmRoomId: dm.get(parentUser.id) ?? null,
        });
      }
    }

    if (parentContacts.length > 0) {
      classGroups.push({
        groupId: g.id,
        groupLabel: groupLabel(g.name, g.section),
        contacts: parentContacts.sort((a, b) => a.name.localeCompare(b.name)),
      });
    }
  }

  return {
    sections: [
      {
        key: 'administration',
        title: 'Administration',
        contacts: withDm(
          adminMembers.map((m) => ({
            userId: m.user.id,
            name: m.user.name,
            roleLabel: m.role === 'branch_admin' ? 'Principal' : m.role === 'sub_admin' ? 'Admin' : 'Management',
          })),
          dm,
        ),
      },
      {
        key: 'teachers',
        title: 'Teachers',
        contacts: withDm(
          teacherMembers.map((m) => ({
            userId: m.user.id,
            name: m.user.name,
            roleLabel: 'Teacher',
          })),
          dm,
        ),
      },
    ],
    classGroups,
  };
}

export async function getAdminContactPicker(input: {
  userId: string;
  branchId: string;
  academicYearId: string;
}): Promise<ContactPickerData> {
  const dm = await dmRoomMap(input.userId, input.academicYearId);

  const staffMembers = await prisma.branchMember.findMany({
    where: {
      branchId: input.branchId,
      isActive: true,
      userId: { not: input.userId },
      role: { in: ['teacher', 'branch_admin', 'sub_admin', 'management'] },
      user: { status: 'active' },
    },
    include: { user: { select: { id: true, name: true } } },
    orderBy: { user: { name: 'asc' } },
  });

  const teachers = staffMembers.filter((m) => m.role === 'teacher');
  const admins = staffMembers.filter((m) => m.role !== 'teacher');

  const groups = await prisma.group.findMany({
    where: { academicYearId: input.academicYearId, isActive: true },
    orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }, { section: 'asc' }],
    select: { id: true, name: true, section: true },
  });

  const classGroups: PickerClassGroup[] = [];
  for (const g of groups) {
    const students = await prisma.student.findMany({
      where: { groupId: g.id, academicYearId: input.academicYearId, isActive: true, status: 'ACTIVE' },
      include: { user: { select: { id: true, name: true, status: true } } },
      orderBy: [{ rollNumber: 'asc' }, { name: 'asc' }],
    });

    const studentContacts = students
      .filter((s) => s.user?.status === 'active')
      .map((s) => ({
        userId: s.user!.id,
        name: s.name,
        subtitle: s.rollNumber ? `Roll ${s.rollNumber}` : null,
        roleLabel: 'Student',
        dmRoomId: dm.get(s.user!.id) ?? null,
      }));

    if (studentContacts.length > 0) {
      classGroups.push({
        groupId: g.id,
        groupLabel: groupLabel(g.name, g.section),
        contacts: studentContacts,
      });
    }
  }

  return {
    sections: [
      {
        key: 'administration',
        title: 'Administration',
        contacts: withDm(
          admins.map((m) => ({
            userId: m.user.id,
            name: m.user.name,
            roleLabel: m.role === 'branch_admin' ? 'Principal' : m.role === 'sub_admin' ? 'Admin' : 'Management',
          })),
          dm,
        ),
      },
      {
        key: 'teachers',
        title: 'Teachers',
        contacts: withDm(
          teachers.map((m) => ({
            userId: m.user.id,
            name: m.user.name,
            roleLabel: 'Teacher',
          })),
          dm,
        ),
      },
    ],
    classGroups,
  };
}
