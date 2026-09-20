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

/**
 * Serialize check+insert+mark of notification outbox rows per logical event.
 * Postgres advisory locks are transaction-scoped (released on commit/
 * rollback) and work across concurrent requests/workers on the same
 * database — unlike app-level mutexes. Every path that turns an outbox row
 * into a ChatMessage MUST go through these per-row functions so concurrent
 * identical events converge to one message.
 */
export async function withEventLock<T>(key: string, fn: (tx: typeof prisma) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
    return fn(tx as typeof prisma);
  });
}

export function attendanceEventKey(studentId: string, date: Date, status: string): string {
  return `attendance:${studentId}:${date.toISOString().slice(0, 10)}:${status}`;
}

export function paymentEventKey(kind: string, paymentId: string | null, rowId: string): string {
  return paymentId != null ? `payment:${kind}:${paymentId}` : `payment_notification:${rowId}`;
}

export function paymentDedupeId(kind: string, paymentId: string | null, rowId: string): string {
  // M7: recorded and reverted events live in separate dedupe namespaces so a
  // revert is never swallowed as a duplicate of the recorded event.
  if (paymentId == null) return `payment_notification:${rowId}`;
  return kind === 'reverted' ? `payment_reverted:${paymentId}` : `payment:${paymentId}`;
}

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

  const dedupeWhere = input.dedupeId
    ? {
        roomId: room.id,
        metadata: { path: ['dedupeId'], equals: input.dedupeId },
      }
    : null;
  if (dedupeWhere) {
    // M10: skip only identical replays (same dedupeId AND same rendered
    // title/content). A re-mark/re-publish with NEW content is new
    // information and must deliver, not collapse into the old message.
    const existing = await prisma.chatMessage.findFirst({
      where: { ...dedupeWhere, title: input.title, content: input.body },
    });
    if (existing) return { message: existing, skipped: true as const };
  }

  // M7: the unique index (roomId, dedupeId, content-hash) turns a concurrent
  // identical-insert race into a P2002 — adopt the winner instead of 500ing.
  try {
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
  } catch (err: any) {
    if (!input.dedupeId || err?.code !== 'P2002') throw err;
    const winner = await prisma.chatMessage.findFirst({
      where: dedupeWhere as never,
      orderBy: { createdAt: 'asc' },
    });
    if (winner) return { message: winner, skipped: true as const };
    throw err;
  }
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

  const dedupeWhere = input.dedupeId
    ? {
        roomId: room.id,
        metadata: { path: ['dedupeId'], equals: input.dedupeId },
      }
    : null;
  if (dedupeWhere) {
    // M10: skip only identical replays (same dedupeId AND same rendered
    // title/content). A re-mark/re-publish with NEW content is new
    // information and must deliver, not collapse into the old message.
    const existing = await prisma.chatMessage.findFirst({
      where: { ...dedupeWhere, title: input.title, content: input.body },
    });
    if (existing) return { message: existing, skipped: true as const };
  }

  // M7: the unique index (roomId, dedupeId, content-hash) turns a concurrent
  // identical-insert race into a P2002 — adopt the winner instead of 500ing.
  try {
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
  } catch (err: any) {
    if (!input.dedupeId || err?.code !== 'P2002') throw err;
    const winner = await prisma.chatMessage.findFirst({
      where: dedupeWhere as never,
      orderBy: { createdAt: 'asc' },
    });
    if (winner) return { message: winner, skipped: true as const };
    throw err;
  }
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

  const dedupeWhere = input.dedupeId
    ? {
        roomId: room.id,
        metadata: { path: ['dedupeId'], equals: input.dedupeId },
      }
    : null;
  if (dedupeWhere) {
    // M10: skip only identical replays (same dedupeId AND same rendered
    // title/content). A re-mark/re-publish with NEW content is new
    // information and must deliver, not collapse into the old message.
    const existing = await prisma.chatMessage.findFirst({
      where: { ...dedupeWhere, title: input.title, content: input.body },
    });
    if (existing) return { message: existing, skipped: true as const };
  }

  // M7: the unique index (roomId, dedupeId, content-hash) turns a concurrent
  // identical-insert race into a P2002 — adopt the winner instead of 500ing.
  try {
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
  } catch (err: any) {
    if (!input.dedupeId || err?.code !== 'P2002') throw err;
    const winner = await prisma.chatMessage.findFirst({
      where: dedupeWhere as never,
      orderBy: { createdAt: 'asc' },
    });
    if (winner) return { message: winner, skipped: true as const };
    throw err;
  }
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
      if (await deliverAttendanceRow(row.id)) delivered++;
    } catch (err) {
      console.error('Failed to deliver attendance notification', row.id, err);
    }
  }

  return { delivered, pending: pending.length };
}

/** Deliver ONE attendance outbox row under its event lock. Returns true if a message was inserted. */
export async function deliverAttendanceRow(rowId: string): Promise<boolean> {
  const row = await prisma.attendanceNotification.findUnique({ where: { id: rowId } });
  if (!row || row.sent) return false;
  // M7: heavy bootstrap runs outside any lock (idempotent + P2002-convergent).
  const { room } = await ensureStudentSystemRoom(row.studentId, 'system_attendance');
  const dedupeId = `attendance:${row.studentId}:${row.date.toISOString().slice(0, 10)}:${row.status}`;
  const where = {
    roomId: room.id,
    title: 'Attendance update',
    content: row.message,
    metadata: { path: ['dedupeId'], equals: dedupeId },
  };
  // M7: an identical message already covering this event (replay, retry, or
  // a concurrent winner) converges instead of duplicating. Content must
  // match: a re-mark with different content is new information and delivers.
  const covered = await prisma.chatMessage.findFirst({ where, select: { id: true } });
  if (covered) {
    await prisma.attendanceNotification.update({
      where: { id: row.id },
      data: { sent: true, sentAt: new Date(), roomId: room.id, chatMessageId: covered.id },
    });
    return false;
  }
  // M7: lock-free convergence — the unique index (roomId, dedupeId,
  // content-hash) makes concurrent identical inserts collide at the
  // database; the loser adopts the winner. (Holding pooled transactions
  // while serialized on advisory locks starved the pool under bursts.)
  try {
    const message = await createSystemRoomMessage({
      roomId: room.id,
      title: 'Attendance update',
      content: row.message,
      metadata: {
        templateKey: `attendance.${row.status}`,
        category: 'attendance',
        audience: 'student',
        dedupeId,
        attendanceNotificationId: row.id,
      },
    });
    await prisma.attendanceNotification.update({
      where: { id: row.id },
      data: { sent: true, sentAt: new Date(), roomId: room.id, chatMessageId: message.id },
    });
    return true;
  } catch (err: any) {
    if (err?.code !== 'P2002') throw err;
    const winner = await prisma.chatMessage.findFirst({ where, select: { id: true }, orderBy: { createdAt: 'asc' } });
    await prisma.attendanceNotification.update({
      where: { id: row.id },
      data: { sent: true, sentAt: new Date(), roomId: room.id, chatMessageId: winner?.id ?? null },
    });
    return false;
  }
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
      if (await deliverPaymentRow(row.id)) delivered++;
    } catch (err) {
      console.error('Failed to deliver payment notification', row.id, err);
    }
  }

  return { delivered, pending: pending.length };
}

/** Deliver ONE payment outbox row. Lock-free P2002-converge (see deliverAttendanceRow). */
export async function deliverPaymentRow(rowId: string): Promise<boolean> {
  const row = await prisma.paymentNotification.findUnique({ where: { id: rowId } });
  if (!row || row.sent) return false;
  // M7: heavy bootstrap runs outside any lock (see deliverAttendanceRow).
  const { room } = await ensureStudentSystemRoom(row.studentId, 'system_payment');
  const kind = (row as { kind?: string }).kind ?? 'recorded';
  const dedupeId = paymentDedupeId(kind, row.paymentId, row.id);
  const where = {
    roomId: room.id,
    title: row.title,
    content: row.message,
    metadata: { path: ['dedupeId'], equals: dedupeId },
  };
  // M7: identical replay converges (same namespace + same content);
  // differing content still delivers.
  const covered = await prisma.chatMessage.findFirst({ where, select: { id: true } });
  if (covered) {
    await prisma.paymentNotification.update({
      where: { id: row.id },
      data: { sent: true, sentAt: new Date(), roomId: room.id, chatMessageId: covered.id },
    });
    return false;
  }
  try {
    const message = await createSystemRoomMessage({
      roomId: room.id,
      title: row.title,
      content: row.message,
      metadata: {
        category: 'payment',
        audience: 'student',
        dedupeId,
        paymentNotificationId: row.id,
      },
    });
    await prisma.paymentNotification.update({
      where: { id: row.id },
      data: { sent: true, sentAt: new Date(), roomId: room.id, chatMessageId: message.id },
    });
    return true;
  } catch (err: any) {
    if (err?.code !== 'P2002') throw err;
    const winner = await prisma.chatMessage.findFirst({ where, select: { id: true }, orderBy: { createdAt: 'asc' } });
    await prisma.paymentNotification.update({
      where: { id: row.id },
      data: { sent: true, sentAt: new Date(), roomId: room.id, chatMessageId: winner?.id ?? null },
    });
    return false;
  }
}
