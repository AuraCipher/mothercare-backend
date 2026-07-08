/** Local calendar date as YYYY-MM-DD (server timezone). */
export function localTodayDateString(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function isSundayDateString(date: string): boolean {
  const dateObj = new Date(`${date}T12:00:00`);
  if (Number.isNaN(dateObj.getTime())) return false;
  return dateObj.getDay() === 0;
}

/** Teachers may only save attendance for today, and never on Sundays. */
export function validateTeacherAttendanceDate(date: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return 'Invalid date';
  }
  if (date !== localTodayDateString()) {
    return 'Teachers can only mark attendance for today';
  }
  if (isSundayDateString(date)) {
    return 'Attendance cannot be marked on Sundays';
  }
  return null;
}

export function teacherCanMarkAttendanceToday(): boolean {
  const today = localTodayDateString();
  return !isSundayDateString(today);
}
