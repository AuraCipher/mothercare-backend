import {
  attendanceTemplateKeyForStatus,
  formatDisplayDate,
  formatMoneyPaise,
  monthLabel,
  noteSuffix,
  renderSystemNotificationTemplate,
  shouldNotifyStudentAttendance,
  studentAttendanceTemplateKey,
} from '../../../src/modules/chat/templates/system-notification-templates';

describe('system-notification-templates', () => {
  test('renders student absent attendance template', () => {
    const { title, body } = renderSystemNotificationTemplate('attendance.absent', {
      date: 'Mon, 9 Jul 2026',
      noteSuffix: '',
    });
    expect(title).toBe('Attendance update');
    expect(body).toBe('You were marked absent on Mon, 9 Jul 2026.');
  });

  test('renders payment received template', () => {
    const { body } = renderSystemNotificationTemplate('payment.received', {
      amount: formatMoneyPaise(500000),
      monthLabel: monthLabel(7, 2026),
      receiptNumber: 'RCP-1001',
      methodSuffix: ' Method: cash.',
    });
    expect(body).toContain('Rs 5,000');
    expect(body).toContain('July 2026');
    expect(body).toContain('RCP-1001');
  });

  test('renders marks entered template', () => {
    const { body } = renderSystemNotificationTemplate('results.marks_entered', {
      marksObtained: 25,
      totalMarks: 30,
      examName: 'Weekly Quiz',
      subjectName: 'Mathematics',
    });
    expect(body).toBe('You obtained 25 out of 30 in Weekly Quiz (Mathematics).');
  });

  test('maps attendance status to template key', () => {
    expect(studentAttendanceTemplateKey('late')).toBe('attendance.late');
    expect(studentAttendanceTemplateKey('present')).toBeNull();
    expect(shouldNotifyStudentAttendance('present')).toBe(false);
    expect(shouldNotifyStudentAttendance('function')).toBe(true);
    expect(attendanceTemplateKeyForStatus('unknown')).toBe('attendance.absent');
  });

  test('formats display date and note suffix', () => {
    expect(noteSuffix('Medical')).toBe(' Note: Medical');
    expect(formatDisplayDate('2026-07-09')).toContain('2026');
  });
});
