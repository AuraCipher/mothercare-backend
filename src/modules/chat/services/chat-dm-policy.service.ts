import { prisma } from '../../../lib/prisma';
import { teacherAppChatAllowsPost } from './teacher-app-chat-permissions.service';
import { isBranchChatAdmin } from './chat-permissions.service';

const STAFF_ROLES = new Set(['teacher', 'management', 'branch_admin', 'sub_admin', 'super_admin', 'staff']);

export type StudentDmFlags = {
  canInitiate: boolean;
  canReceive: boolean;
  canSend: boolean;
  isMessagingRestricted: boolean;
};

export async function getStudentDmFlags(
  userId: string,
  academicYearId: string,
): Promise<StudentDmFlags> {
  const assignments = await prisma.classRoleAssignment.findMany({
    where: {
      userId,
      removedAt: null,
      community: { academicYearId },
      roleDefinition: { isActive: true },
    },
    select: {
      isMessagingRestricted: true,
      roleDefinition: { select: { canInitiateDms: true, canReceiveDms: true } },
    },
  });

  if (assignments.length === 0) {
    return {
      canInitiate: false,
      canReceive: false,
      canSend: false,
      isMessagingRestricted: false,
    };
  }

  if (assignments.every((a) => a.isMessagingRestricted)) {
    return {
      canInitiate: false,
      canReceive: false,
      canSend: false,
      isMessagingRestricted: true,
    };
  }

  const active = assignments.filter((a) => !a.isMessagingRestricted);
  const canInitiate = active.some((a) => a.roleDefinition.canInitiateDms);
  const canReceive = active.some((a) => a.roleDefinition.canReceiveDms);

  return {
    canInitiate,
    canReceive,
    canSend: canInitiate || canReceive,
    isMessagingRestricted: false,
  };
}

export async function canUserSendInDirectMessage(
  userId: string,
  branchId: string | null | undefined,
  academicYearId: string,
): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true, status: true },
  });
  if (!user || user.status !== 'active') return false;

  if (STAFF_ROLES.has(user.role)) {
    if (user.role === 'teacher') {
      return teacherAppChatAllowsPost(userId, branchId, 'direct_message');
    }
    return true;
  }

  if (user.role === 'student') {
    const flags = await getStudentDmFlags(userId, academicYearId);
    return flags.canSend;
  }

  return false;
}

async function assertStaffCanInitiateDm(
  userId: string,
  branchId: string,
  academicYearId: string,
): Promise<void> {
  const allowed = await canUserSendInDirectMessage(userId, branchId, academicYearId);
  if (!allowed) {
    throw { status: 403, message: 'Direct messages are not enabled for your account' };
  }
}

async function assertStudentCanInitiateDm(userId: string, academicYearId: string): Promise<void> {
  const flags = await getStudentDmFlags(userId, academicYearId);
  if (flags.isMessagingRestricted) {
    throw { status: 403, message: 'Messaging is restricted for your account' };
  }
  if (!flags.canInitiate) {
    throw { status: 403, message: 'You do not have permission to start direct messages' };
  }
}

async function assertStudentCanReceiveDm(userId: string, academicYearId: string): Promise<void> {
  const flags = await getStudentDmFlags(userId, academicYearId);
  if (flags.isMessagingRestricted) {
    throw { status: 403, message: 'Messaging is restricted for this student' };
  }
  if (!flags.canReceive) {
    throw { status: 403, message: 'This student cannot receive direct messages' };
  }
}

async function getStudentEnrollment(userId: string, academicYearId: string) {
  return prisma.student.findFirst({
    where: {
      userId,
      academicYearId,
      isActive: true,
      status: 'ACTIVE',
    },
    select: { id: true, groupId: true, name: true },
  });
}

async function assertStudentMayMessageStaff(
  studentUserId: string,
  staffUserId: string,
  branchId: string,
  academicYearId: string,
): Promise<void> {
  const isAdmin = await prisma.branchMember.findFirst({
    where: {
      branchId,
      userId: staffUserId,
      isActive: true,
      role: { in: ['branch_admin', 'sub_admin', 'management'] },
    },
    select: { id: true },
  });
  if (isAdmin) return;

  const student = await getStudentEnrollment(studentUserId, academicYearId);
  if (!student?.groupId) {
    throw { status: 400, message: 'Student is not enrolled in a class' };
  }

  const teacherAssignment = await prisma.teacherAssignment.findFirst({
    where: {
      groupId: student.groupId,
      academicYearId,
      teacherId: staffUserId,
    },
    select: { id: true },
  });
  if (!teacherAssignment) {
    throw { status: 403, message: 'You may only message your class teachers or administration' };
  }
}

async function assertTeacherMayMessageParent(
  teacherUserId: string,
  parentUserId: string,
  academicYearId: string,
): Promise<void> {
  const parentProfile = await prisma.parentProfile.findUnique({
    where: { userId: parentUserId },
    select: {
      children: {
        select: { student: { select: { groupId: true, academicYearId: true, isActive: true, status: true } } },
      },
    },
  });
  if (!parentProfile) {
    throw { status: 404, message: 'Parent not found' };
  }

  const groupIds = await prisma.teacherAssignment.findMany({
    where: { teacherId: teacherUserId, academicYearId },
    select: { groupId: true },
  });
  const taught = new Set(groupIds.map((g) => g.groupId));

  const hasChild = parentProfile.children.some(
    (c) =>
      c.student.isActive &&
      c.student.status === 'ACTIVE' &&
      c.student.academicYearId === academicYearId &&
      c.student.groupId != null &&
      taught.has(c.student.groupId),
  );
  if (!hasChild) {
    throw { status: 403, message: 'You may only message parents of students in your classes' };
  }
}

/** @deprecated use assertStudentMayMessageStaff */
async function assertStudentMayMessageClassTeacher(
  studentUserId: string,
  teacherUserId: string,
  academicYearId: string,
): Promise<void> {
  const student = await getStudentEnrollment(studentUserId, academicYearId);
  if (!student?.groupId) {
    throw { status: 400, message: 'Student is not enrolled in a class' };
  }
  const branchId = (
    await prisma.student.findFirst({
      where: { userId: studentUserId, academicYearId },
      select: { academicYear: { select: { branchId: true } } },
    })
  )?.academicYear?.branchId;
  if (!branchId) throw { status: 400, message: 'Branch context missing' };
  await assertStudentMayMessageStaff(studentUserId, teacherUserId, branchId, academicYearId);
}

async function assertStaffMayMessageStudent(
  staffUserId: string,
  studentUserId: string,
  branchId: string,
  academicYearId: string,
): Promise<void> {
  if (await isBranchChatAdmin(staffUserId, branchId)) return;

  const student = await getStudentEnrollment(studentUserId, academicYearId);
  if (!student?.groupId) {
    throw { status: 404, message: 'Student not found in this academic year' };
  }

  const assignment = await prisma.teacherAssignment.findFirst({
    where: {
      teacherId: staffUserId,
      groupId: student.groupId,
      academicYearId,
    },
    select: { id: true },
  });
  if (!assignment) {
    throw { status: 403, message: 'You may only message students in your assigned classes' };
  }
}

async function assertParticipantIsBranchStaff(
  userId: string,
  branchId: string,
): Promise<void> {
  const membership = await prisma.branchMember.findFirst({
    where: {
      branchId,
      userId,
      isActive: true,
      role: { in: ['teacher', 'branch_admin', 'sub_admin', 'management'] },
    },
    select: { id: true },
  });
  if (!membership) {
    throw { status: 403, message: 'Contact is not available for direct messages' };
  }
}

/** Validate a new or continued DM between two users. */
export async function assertCanCreateDirectMessage(input: {
  initiatorUserId: string;
  participantUserId: string;
  branchId: string;
  academicYearId: string;
}): Promise<void> {
  if (input.initiatorUserId === input.participantUserId) {
    throw { status: 400, message: 'Cannot message yourself' };
  }

  const [initiator, participant] = await Promise.all([
    prisma.user.findUnique({
      where: { id: input.initiatorUserId },
      select: { id: true, role: true, status: true },
    }),
    prisma.user.findUnique({
      where: { id: input.participantUserId },
      select: { id: true, role: true, status: true, name: true },
    }),
  ]);

  if (!initiator || initiator.status !== 'active') {
    throw { status: 403, message: 'Your account cannot send messages' };
  }
  if (!participant || participant.status !== 'active') {
    throw { status: 404, message: 'Contact not found' };
  }

  const initiatorIsStudent = initiator.role === 'student';
  const participantIsStudent = participant.role === 'student';
  const participantIsParent = participant.role === 'parent';
  const initiatorIsStaff = STAFF_ROLES.has(initiator.role);
  const participantIsStaff = STAFF_ROLES.has(participant.role);

  if (initiatorIsStudent) {
    await assertStudentCanInitiateDm(input.initiatorUserId, input.academicYearId);
    if (participantIsStaff) {
      await assertStudentMayMessageStaff(
        input.initiatorUserId,
        input.participantUserId,
        input.branchId,
        input.academicYearId,
      );
    } else {
      throw { status: 403, message: 'You can only message teachers and administration' };
    }
  } else if (initiatorIsStaff) {
    await assertStaffCanInitiateDm(
      input.initiatorUserId,
      input.branchId,
      input.academicYearId,
    );
    if (participantIsStudent) {
      if (!(await isBranchChatAdmin(input.initiatorUserId, input.branchId))) {
        await assertStaffMayMessageStudent(
          input.initiatorUserId,
          input.participantUserId,
          input.branchId,
          input.academicYearId,
        );
      }
      await assertStudentCanReceiveDm(input.participantUserId, input.academicYearId);
    } else if (participantIsParent) {
      if (initiator.role === 'teacher') {
        await assertTeacherMayMessageParent(
          input.initiatorUserId,
          input.participantUserId,
          input.academicYearId,
        );
      } else if (!(await isBranchChatAdmin(input.initiatorUserId, input.branchId))) {
        throw { status: 403, message: 'Only teachers and administrators may message parents' };
      }
    } else if (participantIsStaff) {
      await assertParticipantIsBranchStaff(input.participantUserId, input.branchId);
    } else {
      throw { status: 403, message: 'Contact is not available for direct messages' };
    }
  } else {
    throw { status: 403, message: 'Direct messages are not available for your role' };
  }
}

export type StudentDmContact = {
  userId: string;
  name: string;
  role: string;
  roleLabel: string;
  dmRoomId: string | null;
};

/** Teachers and administration a student may message. */
export async function listStudentDmContacts(input: {
  userId: string;
  branchId: string;
  groupId: string;
  academicYearId: string;
}): Promise<StudentDmContact[]> {
  const picker = await import('./chat-contact-picker.service').then((m) =>
    m.getStudentContactPicker(input),
  );
  return picker.sections.flatMap((s) =>
    s.contacts.map((c) => ({
      userId: c.userId,
      name: c.name,
      role: 'staff',
      roleLabel: c.roleLabel,
      dmRoomId: c.dmRoomId,
    })),
  );
}
