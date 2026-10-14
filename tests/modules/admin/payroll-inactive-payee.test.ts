import { describe, expect, test, jest, afterEach, beforeEach } from '@jest/globals';
import { expensesService } from '../../../src/modules/admin/services/expenses.service';
import { findBranchPayeeIncludingInactive } from '../../../src/modules/admin/services/payroll-calculation.service';
import * as calc from '../../../src/modules/admin/services/payroll-calculation.service';
import { prisma } from '../../../src/lib/prisma';

const p = prisma as any;

// listPayrollPayees is the ACTIVE-only list; the profile (read) path must
// fall back to the direct lookup for deactivated payees, while the
// record-payment (write) path must keep rejecting them.
jest.mock('../../../src/modules/admin/services/payroll-calculation.service', () => {
  const actual = jest.requireActual(
    '../../../src/modules/admin/services/payroll-calculation.service',
  ) as any;
  return {
    ...actual,
    listPayrollPayees: jest.fn(),
    computePayrollMonth: jest.fn(),
  };
});

const mockedList = calc.listPayrollPayees as unknown as any;
const mockedCompute = (calc as any).computePayrollMonth as any;

const deactivatedTeacher = {
  id: 'u-t1',
  name: 'Ms. Deactivated',
  role: 'teacher',
  teacherProfile: { salary: 50000, employeeId: 'TCH-01' },
  staffProfile: null,
  branchMembers: [{ role: 'teacher' }], // membership row kept, isActive=false
};

function setupProfileMocks() {
  mockedCompute.mockResolvedValue({
    balance: {
      profileSalary: 50000,
      attendanceEarned: 0,
      openingBalance: 0,
      totalPaid: 0,
      closingBalance: 0,
      unmarkedDays: 0,
      workingDays: 0,
    },
  });
  jest.spyOn(p.payrollMonthBalance, 'findMany').mockResolvedValue([]);
  jest.spyOn(p.payrollPaymentDetail, 'findMany').mockResolvedValue([]);
}

describe('payroll profile for deactivated payees (read path)', () => {
  beforeEach(() => {
    mockedList.mockResolvedValue([]); // not in the active payee list
    jest.spyOn(p.user, 'findUnique').mockResolvedValue(deactivatedTeacher as any);
    setupProfileMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    mockedList.mockReset();
    mockedCompute.mockReset();
  });

  test('returns history view instead of 404 for a deactivated teacher', async () => {
    const profile = await expensesService.getPayeePayrollProfile('b1', 'u-t1', 'ay1', 12);
    expect(profile.payee.userId).toBe('u-t1');
    expect(profile.payee.payeeType).toBe('TEACHER');
    expect(profile.payments).toEqual([]);
    expect(profile.months).toHaveLength(1); // computed current month, zeroed
    expect(profile.months[0].closingBalance).toBe(0);
  });

  test('still 404s for a user never in the branch', async () => {
    (p.user.findUnique as any).mockResolvedValue(null);
    await expect(
      expensesService.getPayeePayrollProfile('b1', 'u-ghost', 'ay1', 12),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe('record payment stays guarded (write path)', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    mockedList.mockReset();
  });

  test('rejects payment for a payee outside the active list', async () => {
    mockedList.mockResolvedValue([]);
    await expect(
      expensesService.recordPayrollPayment('b1', 'admin-1', {
        payeeUserId: 'u-t1',
        salaryMonth: '2026-10',
        amount: 1000,
        paymentMethod: 'CASH',
        academicYearId: 'ay1',
      }),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe('findBranchPayeeIncludingInactive', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('maps a deactivated teacher to a TEACHER row', async () => {
    jest.spyOn(p.user, 'findUnique').mockResolvedValue(deactivatedTeacher as any);
    const row = await findBranchPayeeIncludingInactive('b1', 'u-t1');
    expect(row).toMatchObject({
      userId: 'u-t1',
      payeeType: 'TEACHER',
      profileSalary: 50000,
      employeeId: 'TCH-01',
    });
  });

  test('maps deactivated staff with a payroll role to a STAFF row', async () => {
    jest.spyOn(p.user, 'findUnique').mockResolvedValue({
      id: 'u-s1',
      name: 'Mr. Staff',
      role: 'staff',
      teacherProfile: null,
      staffProfile: { salary: 30000, employeeId: 'STF-01', workRole: 'accountant' },
      branchMembers: [{ role: 'management' }],
    } as any);
    const row = await findBranchPayeeIncludingInactive('b1', 'u-s1');
    expect(row).toMatchObject({ userId: 'u-s1', payeeType: 'STAFF', profileSalary: 30000 });
  });

  test('returns null when the user has no membership in the branch', async () => {
    jest.spyOn(p.user, 'findUnique').mockResolvedValue({
      ...deactivatedTeacher,
      branchMembers: [],
    } as any);
    await expect(findBranchPayeeIncludingInactive('b1', 'u-t1')).resolves.toBeNull();
  });

  test('returns null for a non-payroll branch role', async () => {
    jest.spyOn(p.user, 'findUnique').mockResolvedValue({
      id: 'u-x',
      name: 'Someone',
      role: 'staff',
      teacherProfile: null,
      staffProfile: null,
      branchMembers: [{ role: 'viewer' }],
    } as any);
    await expect(findBranchPayeeIncludingInactive('b1', 'u-x')).resolves.toBeNull();
  });
});
