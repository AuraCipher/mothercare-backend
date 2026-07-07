import { describe, expect, test, jest, afterEach } from '@jest/globals';
import { expensesService } from '../../../src/modules/admin/services/expenses.service';

describe('payroll bulk preview filters', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('previewPayrollBulk applies payee type and unpaid filters', async () => {
    jest.spyOn(expensesService, 'listPayroll').mockResolvedValue([
      { userId: '1', payeeType: 'TEACHER', branchRole: 'teacher', closingBalance: 5000, unmarkedDays: 0, remainingToPay: 5000 } as any,
      { userId: '2', payeeType: 'STAFF', branchRole: 'management', closingBalance: 0, unmarkedDays: 2, remainingToPay: 0 } as any,
      { userId: '3', payeeType: 'STAFF', branchRole: 'worker', closingBalance: 1000, unmarkedDays: 1, remainingToPay: 1000 } as any,
    ]);

    const unpaid = await expensesService.previewPayrollBulk('b1', '2026-07', 'ay1', { unpaidOnly: true });
    expect(unpaid).toHaveLength(2);
    expect(unpaid.map((r) => r.userId)).toEqual(['1', '3']);
    expect(unpaid[0].suggestedAmount).toBe(5000);

    const workers = await expensesService.previewPayrollBulk('b1', '2026-07', 'ay1', { payeeType: 'WORKER' });
    expect(workers).toHaveLength(1);
    expect(workers[0].userId).toBe('3');
  });
});
