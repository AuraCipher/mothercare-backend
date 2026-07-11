/**
 * System notification templates for fixed contacts (student + teacher).
 *
 * Student contacts: system_attendance | system_payment | system_result
 * Teacher contacts: system_teacher_attendance | system_teacher_payroll
 */

export type SystemNotificationAudience = 'student' | 'teacher';
export type SystemNotificationCategory = 'attendance' | 'payment' | 'results' | 'payroll';

export type StudentSystemRoomKind = 'system_attendance' | 'system_payment' | 'system_result';
export type TeacherSystemRoomKind = 'system_teacher_attendance' | 'system_teacher_payroll';
export type SystemRoomKind = StudentSystemRoomKind | TeacherSystemRoomKind;

export interface SystemNotificationTemplate {
  key: string;
  audience: SystemNotificationAudience;
  category: SystemNotificationCategory;
  roomKind: SystemRoomKind;
  title: string;
  body: string;
  example: string;
  trigger: string;
}

export const SYSTEM_NOTIFICATION_TEMPLATES: Record<string, SystemNotificationTemplate> = {
  'attendance.absent': {
    key: 'attendance.absent',
    audience: 'student',
    category: 'attendance',
    roomKind: 'system_attendance',
    title: 'Attendance update',
    body: 'You were marked absent on {date}.{noteSuffix}',
    example: 'You were marked absent on Mon, 9 Jul 2026.',
    trigger: 'Class attendance saved (bulk or single) — status absent. Present students are NOT notified.',
  },
  'attendance.late': {
    key: 'attendance.late',
    audience: 'student',
    category: 'attendance',
    roomKind: 'system_attendance',
    title: 'Attendance update',
    body: 'You arrived late on {date}.{noteSuffix}',
    example: 'You arrived late on Mon, 9 Jul 2026.',
    trigger: 'Class attendance saved with status late.',
  },
  'attendance.leave': {
    key: 'attendance.leave',
    audience: 'student',
    category: 'attendance',
    roomKind: 'system_attendance',
    title: 'Attendance update',
    body: 'You were marked on leave for {date}.{noteSuffix}',
    example: 'You were marked on leave for Mon, 9 Jul 2026.',
    trigger: 'Class attendance saved with status leave.',
  },
  'attendance.function': {
    key: 'attendance.function',
    audience: 'student',
    category: 'attendance',
    roomKind: 'system_attendance',
    title: 'Attendance update',
    body: 'You were marked present (function/event) on {date}.{noteSuffix}',
    example: 'You were marked present (function/event) on Mon, 9 Jul 2026.',
    trigger: 'Class attendance saved with status function.',
  },
  'payment.received': {
    key: 'payment.received',
    audience: 'student',
    category: 'payment',
    roomKind: 'system_payment',
    title: 'Payment received',
    body: 'Payment of {amount} recorded for {monthLabel}. Receipt {receiptNumber}.{methodSuffix}',
    example: 'Payment of Rs 5,000 recorded for July 2026. Receipt RCP-1042. Method: cash.',
    trigger: 'Admin records a full fee payment for the student.',
  },
  'payment.partial': {
    key: 'payment.partial',
    audience: 'student',
    category: 'payment',
    roomKind: 'system_payment',
    title: 'Partial payment',
    body: 'Partial payment of {amount} received for {monthLabel}. Balance due: {balanceDue}. Receipt {receiptNumber}.',
    example: 'Partial payment of Rs 2,000 received for July 2026. Balance due: Rs 3,000. Receipt RCP-1043.',
    trigger: 'Admin records a partial fee payment.',
  },
  'payment.overpaid': {
    key: 'payment.overpaid',
    audience: 'student',
    category: 'payment',
    roomKind: 'system_payment',
    title: 'Payment received',
    body: 'Payment of {amount} received for {monthLabel}. This month is fully paid. Receipt {receiptNumber}.',
    example: 'Payment of Rs 6,000 received for July 2026. This month is fully paid. Receipt RCP-1044.',
    trigger: 'Payment exceeds the fee due for the month.',
  },
  'payment.reverted': {
    key: 'payment.reverted',
    audience: 'student',
    category: 'payment',
    roomKind: 'system_payment',
    title: 'Payment reverted',
    body: 'Receipt {receiptNumber} ({amount}) was reverted. Updated balance due: {balanceDue}.',
    example: 'Receipt RCP-1042 (Rs 5,000) was reverted. Updated balance due: Rs 5,000.',
    trigger: 'Admin reverts a fee payment.',
  },
  'payment.family_received': {
    key: 'payment.family_received',
    audience: 'student',
    category: 'payment',
    roomKind: 'system_payment',
    title: 'Family payment received',
    body: '{familyName} family payment of {amount} recorded. Your share: {amount}. Receipt {receiptNumber}.{methodSuffix}',
    example: 'Khan Family family payment of Rs 12,000 recorded. Your share: Rs 4,000. Receipt FMP-88. Method: bank transfer.',
    trigger: 'Admin records a family/sibling payment — one message per included student.',
  },
  'fee.generated': {
    key: 'fee.generated',
    audience: 'student',
    category: 'payment',
    roomKind: 'system_payment',
    title: 'Fee generated',
    body: '{monthLabel} fee of {amount} has been generated. Amount due: {balanceDue}.',
    example: 'July 2026 fee of Rs 5,000 has been generated. Amount due: Rs 5,000.',
    trigger: 'Admin generates monthly fees for the student.',
  },
  'results.marks_entered': {
    key: 'results.marks_entered',
    audience: 'student',
    category: 'results',
    roomKind: 'system_result',
    title: 'Marks recorded',
    body: 'You obtained {marksObtained} out of {totalMarks} in {examName} ({subjectName}).',
    example: 'You obtained 25 out of 30 in Weekly Quiz (Mathematics).',
    trigger: 'Teacher/admin saves marks for a student (per subject exam).',
  },
  'results.marks_absent': {
    key: 'results.marks_absent',
    audience: 'student',
    category: 'results',
    roomKind: 'system_result',
    title: 'Exam attendance',
    body: 'You were marked absent for {examName} ({subjectName}).',
    example: 'You were marked absent for Mid Term (Science).',
    trigger: 'Marks saved with isAbsent = true.',
  },
  'results.report_card_published': {
    key: 'results.report_card_published',
    audience: 'student',
    category: 'results',
    roomKind: 'system_result',
    title: 'Report card published',
    body: 'Your {sessionName} report card is available. Overall: {overallGrade} ({percentage}%).',
    example: 'Your Term 1 report card is available. Overall: A (84.5%).',
    trigger: 'Admin publishes the student report card for a session.',
  },
  'teacher.attendance.absent': {
    key: 'teacher.attendance.absent',
    audience: 'teacher',
    category: 'attendance',
    roomKind: 'system_teacher_attendance',
    title: 'Your attendance',
    body: 'You were marked absent on {date}.{noteSuffix}',
    example: 'You were marked absent on Mon, 9 Jul 2026.',
    trigger: 'Admin saves teacher attendance with status absent.',
  },
  'teacher.attendance.late': {
    key: 'teacher.attendance.late',
    audience: 'teacher',
    category: 'attendance',
    roomKind: 'system_teacher_attendance',
    title: 'Your attendance',
    body: 'You arrived late on {date}.{noteSuffix}',
    example: 'You arrived late on Mon, 9 Jul 2026.',
    trigger: 'Admin saves teacher attendance with status late.',
  },
  'teacher.attendance.leave': {
    key: 'teacher.attendance.leave',
    audience: 'teacher',
    category: 'attendance',
    roomKind: 'system_teacher_attendance',
    title: 'Your attendance',
    body: 'You were marked on leave for {date}.{noteSuffix}',
    example: 'You were marked on leave for Mon, 9 Jul 2026.',
    trigger: 'Admin saves teacher attendance with status leave.',
  },
  'teacher.attendance.present': {
    key: 'teacher.attendance.present',
    audience: 'teacher',
    category: 'attendance',
    roomKind: 'system_teacher_attendance',
    title: 'Your attendance',
    body: 'You were marked present on {date}.{noteSuffix}',
    example: 'You were marked present on Mon, 9 Jul 2026.',
    trigger: 'Admin saves teacher attendance with status present.',
  },
  'teacher.payroll.received': {
    key: 'teacher.payroll.received',
    audience: 'teacher',
    category: 'payroll',
    roomKind: 'system_teacher_payroll',
    title: 'Salary paid',
    body: 'Salary of {amount} for {salaryMonth} has been credited.{methodSuffix}',
    example: 'Salary of Rs 85,000 for July 2026 has been credited. Method: bank transfer.',
    trigger: 'Admin records payroll payment for the teacher.',
  },
  'teacher.payroll.partial': {
    key: 'teacher.payroll.partial',
    audience: 'teacher',
    category: 'payroll',
    roomKind: 'system_teacher_payroll',
    title: 'Salary payment',
    body: 'Partial salary payment of {amount} for {salaryMonth}.{methodSuffix}',
    example: 'Partial salary payment of Rs 40,000 for July 2026. Method: cash.',
    trigger: 'Partial payroll payment recorded.',
  },
  'teacher.payroll.bulk_run': {
    key: 'teacher.payroll.bulk_run',
    audience: 'teacher',
    category: 'payroll',
    roomKind: 'system_teacher_payroll',
    title: 'Salary paid',
    body: 'Your {salaryMonth} salary of {amount} was paid in the monthly payroll run.{methodSuffix}',
    example: 'Your July 2026 salary of Rs 85,000 was paid in the monthly payroll run. Method: bank transfer.',
    trigger: 'Teacher included in admin bulk payroll run.',
  },
};

const STUDENT_ATTENDANCE_NOTIFY_STATUSES = new Set(['absent', 'late', 'leave', 'function']);

const STUDENT_ATTENDANCE_STATUS_TO_TEMPLATE: Record<string, string> = {
  absent: 'attendance.absent',
  late: 'attendance.late',
  leave: 'attendance.leave',
  function: 'attendance.function',
};

const TEACHER_ATTENDANCE_STATUS_TO_TEMPLATE: Record<string, string> = {
  absent: 'teacher.attendance.absent',
  late: 'teacher.attendance.late',
  leave: 'teacher.attendance.leave',
  present: 'teacher.attendance.present',
};

export function shouldNotifyStudentAttendance(status: string): boolean {
  return STUDENT_ATTENDANCE_NOTIFY_STATUSES.has(status);
}

export function studentAttendanceTemplateKey(status: string): string | null {
  return STUDENT_ATTENDANCE_STATUS_TO_TEMPLATE[status] ?? null;
}

export function teacherAttendanceTemplateKey(status: string): string {
  return TEACHER_ATTENDANCE_STATUS_TO_TEMPLATE[status] ?? 'teacher.attendance.present';
}

export function listSystemNotificationTemplates(): SystemNotificationTemplate[] {
  return Object.values(SYSTEM_NOTIFICATION_TEMPLATES);
}

export function getSystemNotificationTemplate(key: string): SystemNotificationTemplate {
  const template = SYSTEM_NOTIFICATION_TEMPLATES[key];
  if (!template) throw new Error(`Unknown system notification template: ${key}`);
  return template;
}

export function renderSystemNotificationTemplate(
  key: string,
  vars: Record<string, string | number | null | undefined>,
): { title: string; body: string; template: SystemNotificationTemplate } {
  const template = getSystemNotificationTemplate(key);
  const replace = (text: string) =>
    text.replace(/\{(\w+)\}/g, (_, name: string) => {
      const value = vars[name];
      if (value === null || value === undefined || value === '') return '';
      return String(value);
    });
  return {
    template,
    title: replace(template.title).trim(),
    body: replace(template.body).trim(),
  };
}

export function formatMoneyPaise(paise: number): string {
  const rupees = paise / 100;
  if (Math.abs(rupees - Math.round(rupees)) < 0.005) {
    return `Rs ${Math.round(rupees).toLocaleString('en-PK')}`;
  }
  return `Rs ${rupees.toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function monthLabel(month: number, year: number): string {
  const names = [
    '', 'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  const label = month >= 1 && month <= 12 ? names[month] : `Month ${month}`;
  return `${label} ${year}`;
}

export function formatDisplayDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('en-PK', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

export function noteSuffix(note?: string | null): string {
  const trimmed = note?.trim();
  return trimmed ? ` Note: ${trimmed}` : '';
}

export function methodSuffix(method?: string | null): string {
  const trimmed = method?.trim();
  return trimmed ? ` Method: ${trimmed.replace(/_/g, ' ')}.` : '';
}

/** @deprecated use studentAttendanceTemplateKey */
export function attendanceTemplateKeyForStatus(status: string): string {
  return studentAttendanceTemplateKey(status) ?? 'attendance.absent';
}
