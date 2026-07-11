import type { ChatMessageType, ChatRoomKind } from '@prisma/client';
import { prisma } from '../../../lib/prisma';
import { ensureStudentChatBootstrap } from './chat-community.bootstrap';
import { ensureTeacherChatBootstrap } from './teacher-chat-bootstrap.service';
import { ensureRoomMembership } from './chat-access.service';
import { fanoutSystemChatMessage } from './system-message-fanout.service';

export async function createSystemRoomMessage(input: {
  roomId: string;
  type?: ChatMessageType;
  title?: string;
  content?: string;
  metadata?: Record<string, unknown>;
}) {
  const message = await prisma.chatMessage.create({
    data: {
      roomId: input.roomId,
      senderId: null,
      type: input.type ?? 'text',
      title: input.title,
      content: input.content,
      metadata: {
        systemNotification: true,
        ...input.metadata,
      } as object,
    },
    include: {
      room: { select: { academicYearId: true, name: true, kind: true } },
      mediaFile: { select: { id: true, mimeType: true, publicUrl: true, purpose: true } },
    },
  });

  await prisma.chatRoom.update({
    where: { id: input.roomId },
    data: { updatedAt: new Date() },
  });

  await fanoutSystemChatMessage(message);
  return message;
}

export type StudentSystemRoomKind = Extract<
  ChatRoomKind,
  'system_attendance' | 'system_payment' | 'system_result'
>;

export type TeacherSystemRoomKind = Extract<
  ChatRoomKind,
  'system_teacher_attendance' | 'system_teacher_payroll'
>;

async function ensureStudentSystemRoom(studentId: string, kind: StudentSystemRoomKind) {
  const student = await prisma.student.findUnique({
    where: { id: studentId },
    select: {
      id: true,
      name: true,
      userId: true,
      groupId: true,
      academicYearId: true,
      academicYear: { select: { branchId: true } },
      group: { select: { name: true, section: true } },
    },
  });
  if (!student?.userId || !student.groupId || !student.academicYear?.branchId) {
    throw new Error(`Student ${studentId} is missing chat bootstrap context`);
  }

  const groupLabel = student.group
    ? `${student.group.name}${student.group.section ? ` · ${student.group.section}` : ''}`
    : 'Class';

  await ensureStudentChatBootstrap({
    userId: student.userId,
    studentId: student.id,
    groupId: student.groupId,
    groupLabel,
    academicYearId: student.academicYearId,
    branchId: student.academicYear.branchId,
    studentName: student.name,
  });

  const room = await prisma.chatRoom.findFirst({
    where: { studentId: student.id, kind, academicYearId: student.academicYearId },
  });
  if (!room) throw new Error(`System room ${kind} not found for student ${studentId}`);
  return { room, student };
}

async function ensureTeacherSystemRoom(
  teacherUserId: string,
  academicYearId: string,
  branchId: string,
  kind: TeacherSystemRoomKind,
) {
  await ensureTeacherChatBootstrap({ userId: teacherUserId, academicYearId, branchId });

  const suffix = kind === 'system_teacher_attendance' ? 'attendance' : 'payroll';
  const singletonKey = `ay:${academicYearId}:teacher_user:${teacherUserId}:${suffix}`;
  const name = kind === 'system_teacher_attendance' ? 'My Attendance' : 'My Payroll';
  const description =
    kind === 'system_teacher_attendance'
      ? 'Your attendance updates from school'
      : 'Salary and payroll updates';

  let room = await prisma.chatRoom.findUnique({ where: { singletonKey } });
  if (!room) {
    room = await prisma.chatRoom.create({
      data: {
        academicYearId,
        branchId,
        kind,
        name,
        singletonKey,
        source: 'system_bootstrap',
        onlyStaffCanPost: true,
        studentsCanPost: false,
        description,
      },
    });
  }

  await ensureRoomMembership(room.id, teacherUserId, { access: 'observer', canPost: false });
  return room;
}

export async function deliverStudentSystemNotification(input: {
  studentId: string;
  templateKey: string;
  title: string;
  body: string;
  roomKind: StudentSystemRoomKind;
  category: string;
  dedupeId?: string;
  metadata?: Record<string, unknown>;
}) {
  const { room } = await ensureStudentSystemRoom(input.studentId, input.roomKind);

  if (input.dedupeId) {
    const existing = await prisma.chatMessage.findFirst({
      where: {
        roomId: room.id,
        metadata: { path: ['dedupeId'], equals: input.dedupeId },
      },
    });
    if (existing) return { message: existing, skipped: true as const };
  }

  const message = await createSystemRoomMessage({
    roomId: room.id,
    title: input.title,
    content: input.body,
    metadata: {
      templateKey: input.templateKey,
      category: input.category,
      audience: 'student',
      dedupeId: input.dedupeId,
      ...input.metadata,
    },
  });

  return { message, skipped: false as const };
}

export async function deliverTeacherAttendanceNotification(input: {
  teacherUserId: string;
  academicYearId: string;
  branchId: string;
  templateKey: string;
  title: string;
  body: string;
  dedupeId?: string;
  metadata?: Record<string, unknown>;
}) {
  const room = await ensureTeacherSystemRoom(
    input.teacherUserId,
    input.academicYearId,
    input.branchId,
    'system_teacher_attendance',
  );

  if (input.dedupeId) {
    const existing = await prisma.chatMessage.findFirst({
      where: {
        roomId: room.id,
        metadata: { path: ['dedupeId'], equals: input.dedupeId },
      },
    });
    if (existing) return { message: existing, skipped: true as const };
  }

  const message = await createSystemRoomMessage({
    roomId: room.id,
    title: input.title,
    content: input.body,
    metadata: {
      templateKey: input.templateKey,
      category: 'attendance',
      audience: 'teacher',
      dedupeId: input.dedupeId,
      ...input.metadata,
    },
  });

  return { message, skipped: false as const };
}

export async function deliverTeacherPayrollNotification(input: {
  teacherUserId: string;
  academicYearId: string;
  branchId: string;
  templateKey: string;
  title: string;
  body: string;
  dedupeId?: string;
  metadata?: Record<string, unknown>;
}) {
  const room = await ensureTeacherSystemRoom(
    input.teacherUserId,
    input.academicYearId,
    input.branchId,
    'system_teacher_payroll',
  );

  if (input.dedupeId) {
    const existing = await prisma.chatMessage.findFirst({
      where: {
        roomId: room.id,
        metadata: { path: ['dedupeId'], equals: input.dedupeId },
      },
    });
    if (existing) return { message: existing, skipped: true as const };
  }

  const message = await createSystemRoomMessage({
    roomId: room.id,
    title: input.title,
    content: input.body,
    metadata: {
      templateKey: input.templateKey,
      category: 'payroll',
      audience: 'teacher',
      dedupeId: input.dedupeId,
      ...input.metadata,
    },
  });

  return { message, skipped: false as const };
}

export async function deliverPendingAttendanceNotifications(limit = 100) {
  const pending = await prisma.attendanceNotification.findMany({
    where: { sent: false },
    take: limit,
    orderBy: { createdAt: 'asc' },
  });

  let delivered = 0;
  for (const row of pending) {
    try {
      const { room } = await ensureStudentSystemRoom(row.studentId, 'system_attendance');
      const message = await createSystemRoomMessage({
        roomId: room.id,
        title: 'Attendance update',
        content: row.message,
        metadata: {
          templateKey: `attendance.${row.status}`,
          category: 'attendance',
          audience: 'student',
          dedupeId: `attendance:${row.studentId}:${row.date.toISOString().slice(0, 10)}:${row.status}`,
          attendanceNotificationId: row.id,
        },
      });
      await prisma.attendanceNotification.update({
        where: { id: row.id },
        data: {
          sent: true,
          sentAt: new Date(),
          roomId: room.id,
          chatMessageId: message.id,
        },
      });
      delivered++;
    } catch (err) {
      console.error('Failed to deliver attendance notification', row.id, err);
    }
  }

  return { delivered, pending: pending.length };
}

export async function deliverPendingPaymentNotifications(limit = 100) {
  const pending = await prisma.paymentNotification.findMany({
    where: { sent: false },
    take: limit,
    orderBy: { createdAt: 'asc' },
  });

  let delivered = 0;
  for (const row of pending) {
    try {
      const { room } = await ensureStudentSystemRoom(row.studentId, 'system_payment');
      const message = await createSystemRoomMessage({
        roomId: room.id,
        title: row.title,
        content: row.message,
        metadata: {
          category: 'payment',
          audience: 'student',
          dedupeId: row.paymentId ? `payment:${row.paymentId}` : `payment_notification:${row.id}`,
          paymentNotificationId: row.id,
        },
      });
      await prisma.paymentNotification.update({
        where: { id: row.id },
        data: {
          sent: true,
          sentAt: new Date(),
          roomId: room.id,
          chatMessageId: message.id,
        },
      });
      delivered++;
    } catch (err) {
      console.error('Failed to deliver payment notification', row.id, err);
    }
  }

  return { delivered, pending: pending.length };
}
