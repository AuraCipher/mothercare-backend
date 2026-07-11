import { prisma } from '../../../lib/prisma';
import {
  formatDisplayDate,
  formatMoneyPaise,
  methodSuffix,
  monthLabel,
  noteSuffix,
  renderSystemNotificationTemplate,
  shouldNotifyStudentAttendance,
  studentAttendanceTemplateKey,
  teacherAttendanceTemplateKey,
} from '../templates/system-notification-templates';
import {
  deliverPendingAttendanceNotifications,
  deliverPendingPaymentNotifications,
  deliverStudentSystemNotification,
  deliverTeacherAttendanceNotification,
  deliverTeacherPayrollNotification,
  type StudentSystemRoomKind,
} from './system-room-message.service';

const TEACHER_ATTENDANCE_NOTIFY_STATUSES = new Set(['absent', 'late', 'leave']);

export function salaryMonthLabel(salaryMonth: string): string {
  const [yearStr, monthStr] = salaryMonth.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr);
  if (!year || !month) return salaryMonth;
  return monthLabel(month, year);
}

export async function queueAttendanceStatusNotification(input: {
  studentId: string;
  date: Date | string;
  status: string;
  note?: string | null;
}) {
  if (!shouldNotifyStudentAttendance(input.status)) return null;

  const templateKey = studentAttendanceTemplateKey(input.status);
  if (!templateKey) return null;

  const dateObj = typeof input.date === 'string' ? new Date(input.date) : input.date;
  const { body } = renderSystemNotificationTemplate(templateKey, {
    date: formatDisplayDate(dateObj),
    status: input.status,
    noteSuffix: noteSuffix(input.note),
  });

  const exists = await prisma.attendanceNotification.findFirst({
    where: { studentId: input.studentId, date: dateObj, status: input.status },
  });
  if (exists) {
    if (!exists.sent) {
      await deliverPendingAttendanceNotifications(1);
    }
    return exists;
  }

  const row = await prisma.attendanceNotification.create({
    data: {
      studentId: input.studentId,
      date: dateObj,
      status: input.status,
      message: body,
    },
  });

  await deliverPendingAttendanceNotifications(1);
  return row;
}

export async function notifyTeacherAttendanceStatus(input: {
  teacherUserId: string;
  academicYearId: string;
  branchId: string;
  date: Date | string;
  status: string;
  note?: string | null;
}) {
  if (!TEACHER_ATTENDANCE_NOTIFY_STATUSES.has(input.status)) return;

  const dateObj = typeof input.date === 'string' ? new Date(input.date) : input.date;
  const templateKey = teacherAttendanceTemplateKey(input.status);
  const { title, body } = renderSystemNotificationTemplate(templateKey, {
    date: formatDisplayDate(dateObj),
    noteSuffix: noteSuffix(input.note),
  });

  await deliverTeacherAttendanceNotification({
    teacherUserId: input.teacherUserId,
    academicYearId: input.academicYearId,
    branchId: input.branchId,
    templateKey,
    title,
    body,
    dedupeId: `teacher_attendance:${input.teacherUserId}:${dateObj.toISOString().slice(0, 10)}:${input.status}`,
    metadata: { status: input.status, date: dateObj.toISOString().slice(0, 10) },
  });
}

export async function notifyTeacherPayrollPayment(input: {
  teacherUserId: string;
  academicYearId: string;
  branchId: string;
  outgoingPaymentId: string;
  amountPaise: number;
  salaryMonth: string;
  paymentMethod?: string | null;
  isPartial?: boolean;
  isBulkRun?: boolean;
}) {
  const templateKey = input.isBulkRun
    ? 'teacher.payroll.bulk_run'
    : input.isPartial
      ? 'teacher.payroll.partial'
      : 'teacher.payroll.received';

  const { title, body } = renderSystemNotificationTemplate(templateKey, {
    amount: formatMoneyPaise(input.amountPaise),
    salaryMonth: salaryMonthLabel(input.salaryMonth),
    methodSuffix: methodSuffix(input.paymentMethod),
  });

  await deliverTeacherPayrollNotification({
    teacherUserId: input.teacherUserId,
    academicYearId: input.academicYearId,
    branchId: input.branchId,
    templateKey,
    title,
    body,
    dedupeId: `teacher_payroll:${input.outgoingPaymentId}`,
    metadata: {
      outgoingPaymentId: input.outgoingPaymentId,
      salaryMonth: input.salaryMonth,
      amountPaise: input.amountPaise,
    },
  });
}

export async function notifyPaymentRecorded(input: {
  studentId: string;
  paymentId: string;
  amountPaise: number;
  receiptNumber: string;
  paymentMethod?: string | null;
  month: number;
  year: number;
  balanceDuePaise: number;
  feeStatus: string;
}) {
  const templateKey =
    input.feeStatus === 'OVERPAID'
      ? 'payment.overpaid'
      : input.feeStatus === 'PARTIAL'
        ? 'payment.partial'
        : 'payment.received';

  const { title, body } = renderSystemNotificationTemplate(templateKey, {
    amount: formatMoneyPaise(input.amountPaise),
    monthLabel: monthLabel(input.month, input.year),
    receiptNumber: input.receiptNumber,
    balanceDue: formatMoneyPaise(input.balanceDuePaise),
    methodSuffix: methodSuffix(input.paymentMethod),
  });

  const row = await prisma.paymentNotification.create({
    data: {
      studentId: input.studentId,
      paymentId: input.paymentId,
      title,
      message: body,
      amountPaise: input.amountPaise,
      receiptNumber: input.receiptNumber,
    },
  });

  await deliverPendingPaymentNotifications(1);
  return row;
}

export async function notifyFamilyPaymentReceived(input: {
  studentId: string;
  paymentId: string;
  amountPaise: number;
  receiptNumber: string;
  paymentMethod?: string | null;
  familyName: string;
}) {
  const { title, body } = renderSystemNotificationTemplate('payment.family_received', {
    familyName: input.familyName,
    amount: formatMoneyPaise(input.amountPaise),
    receiptNumber: input.receiptNumber,
    methodSuffix: methodSuffix(input.paymentMethod),
  });

  await deliverStudentSystemNotification({
    studentId: input.studentId,
    templateKey: 'payment.family_received',
    title,
    body,
    roomKind: 'system_payment',
    category: 'payment',
    dedupeId: `family_payment:${input.paymentId}`,
    metadata: { paymentId: input.paymentId, familyName: input.familyName },
  });
}

export async function notifyPaymentReverted(input: {
  studentId: string;
  paymentId: string;
  amountPaise: number;
  receiptNumber: string;
  balanceDuePaise: number;
}) {
  const { title, body } = renderSystemNotificationTemplate('payment.reverted', {
    amount: formatMoneyPaise(input.amountPaise),
    receiptNumber: input.receiptNumber,
    balanceDue: formatMoneyPaise(input.balanceDuePaise),
  });

  await prisma.paymentNotification.create({
    data: {
      studentId: input.studentId,
      paymentId: input.paymentId,
      title,
      message: body,
      amountPaise: input.amountPaise,
      receiptNumber: input.receiptNumber,
    },
  });

  await deliverPendingPaymentNotifications(1);
}

export async function notifyFeeGenerated(input: {
  studentId: string;
  studentFeeId: string;
  month: number;
  year: number;
  amountPaise: number;
  balanceDuePaise: number;
}) {
  const { title, body } = renderSystemNotificationTemplate('fee.generated', {
    monthLabel: monthLabel(input.month, input.year),
    amount: formatMoneyPaise(input.amountPaise),
    balanceDue: formatMoneyPaise(input.balanceDuePaise),
  });

  await deliverStudentSystemNotification({
    studentId: input.studentId,
    templateKey: 'fee.generated',
    title,
    body,
    roomKind: 'system_payment',
    category: 'payment',
    dedupeId: `fee_generated:${input.studentFeeId}`,
    metadata: { studentFeeId: input.studentFeeId },
  });
}

export async function notifyMarksEntered(input: {
  studentId: string;
  examClassSubjectId: string;
  marksEntryId: string;
  examName: string;
  subjectName: string;
  marksObtained: number;
  totalMarks: number;
}) {
  const { title, body } = renderSystemNotificationTemplate('results.marks_entered', {
    examName: input.examName,
    subjectName: input.subjectName,
    marksObtained: input.marksObtained,
    totalMarks: input.totalMarks,
  });

  await deliverStudentSystemNotification({
    studentId: input.studentId,
    templateKey: 'results.marks_entered',
    title,
    body,
    roomKind: 'system_result',
    category: 'results',
    dedupeId: `marks:${input.marksEntryId}`,
    metadata: {
      examClassSubjectId: input.examClassSubjectId,
      marksEntryId: input.marksEntryId,
    },
  });
}

export async function notifyMarksAbsent(input: {
  studentId: string;
  examClassSubjectId: string;
  marksEntryId: string;
  examName: string;
  subjectName: string;
}) {
  const { title, body } = renderSystemNotificationTemplate('results.marks_absent', {
    examName: input.examName,
    subjectName: input.subjectName,
  });

  await deliverStudentSystemNotification({
    studentId: input.studentId,
    templateKey: 'results.marks_absent',
    title,
    body,
    roomKind: 'system_result',
    category: 'results',
    dedupeId: `marks_absent:${input.marksEntryId}`,
    metadata: {
      examClassSubjectId: input.examClassSubjectId,
      marksEntryId: input.marksEntryId,
    },
  });
}

export async function notifyReportCardPublished(input: {
  studentId: string;
  reportCardId: string;
  examSessionId: string;
  sessionName: string;
  overallGrade?: string | null;
  percentage?: number | null;
}) {
  const { title, body } = renderSystemNotificationTemplate('results.report_card_published', {
    sessionName: input.sessionName,
    overallGrade: input.overallGrade ?? '—',
    percentage: input.percentage != null ? input.percentage.toFixed(1) : '—',
  });

  await deliverStudentSystemNotification({
    studentId: input.studentId,
    templateKey: 'results.report_card_published',
    title,
    body,
    roomKind: 'system_result',
    category: 'results',
    dedupeId: `report_card:${input.reportCardId}`,
    metadata: {
      reportCardId: input.reportCardId,
      examSessionId: input.examSessionId,
    },
  });
}

export async function flushPendingSystemNotifications() {
  const attendance = await deliverPendingAttendanceNotifications();
  const payment = await deliverPendingPaymentNotifications();
  return { attendance, payment };
}

export function roomKindForTemplate(templateKey: string): StudentSystemRoomKind {
  if (templateKey.startsWith('attendance.')) return 'system_attendance';
  if (templateKey.startsWith('payment.') || templateKey.startsWith('fee.')) return 'system_payment';
  return 'system_result';
}
