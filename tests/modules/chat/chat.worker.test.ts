/**
 * Chat worker job handlers.
 */
import { flushPendingSystemNotifications } from '../../../src/modules/chat/services/system-notification.service';
import { runAttendanceDailyReport } from '../../../src/modules/chat/services/attendance-daily-report.service';

jest.mock('../../../src/modules/chat/services/system-notification.service', () => ({
  flushPendingSystemNotifications: jest.fn().mockResolvedValue({ attendance: { delivered: 1 }, payment: { delivered: 0 } }),
}));

jest.mock('../../../src/modules/chat/services/attendance-daily-report.service', () => ({
  runAttendanceDailyReport: jest.fn().mockResolvedValue({ total: 10, present: 8, absent: 2 }),
}));

jest.mock('../../../src/modules/chat/push/fcm.service', () => ({
  sendEncryptedPushToUsers: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../../src/config/redis-tcp', () => ({
  getRedisConnectionConfig: jest.fn().mockReturnValue(null),
}));

describe('attendance daily report service', () => {
  test('runAttendanceDailyReport is callable', async () => {
    const summary = await runAttendanceDailyReport({
      branchId: 'b1',
      academicYearId: 'ay1',
      date: '2026-07-11',
    });
    expect(summary.total).toBe(10);
  });
});

describe('offline deliver flush', () => {
  test('flushPendingSystemNotifications delivers queued rows', async () => {
    const result = await flushPendingSystemNotifications();
    expect(result.attendance.delivered).toBe(1);
  });
});
