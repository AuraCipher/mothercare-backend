import { validateEmployeeAttendanceDate, attendancePayWeight, monthBounds, prevSalaryMonth } from '../../../src/modules/admin/utils/employee-attendance';

describe('employee-attendance utils', () => {
  test('attendancePayWeight', () => {
    expect(attendancePayWeight('present')).toBe(1);
    expect(attendancePayWeight('holiday')).toBe(1);
    expect(attendancePayWeight('late')).toBe(0.75);
    expect(attendancePayWeight('absent')).toBe(0);
    expect(attendancePayWeight('leave')).toBe(0);
  });

  test('monthBounds', () => {
    const { daysInMonth, from } = monthBounds('2026-07');
    expect(daysInMonth).toBe(31);
    expect(from.getMonth()).toBe(6);
  });

  test('prevSalaryMonth', () => {
    expect(prevSalaryMonth('2026-07')).toBe('2026-06');
    expect(prevSalaryMonth('2026-01')).toBe('2025-12');
  });
});

describe('validateEmployeeAttendanceDate', () => {
  test('rejects future dates via academic year validation', async () => {
    const future = new Date();
    future.setFullYear(future.getFullYear() + 2);
    const err = await validateEmployeeAttendanceDate('branch-1', 'user-1', 'ay-1', future);
    expect(err).toBeTruthy();
  });
});
