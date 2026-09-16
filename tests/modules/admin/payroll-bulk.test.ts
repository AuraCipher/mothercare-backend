import { describe, expect, test, jest, afterEach } from '@jest/globals';
import { expensesService } from '../../../src/modules/admin/services/expenses.service';
import {
  buildPayrollContext,
  computePayrollMonth,
  listPayrollPayees,
  type PayrollComputeContext,
} from '../../../src/modules/admin/services/payroll-calculation.service';
import { prisma } from '../../../src/lib/prisma';

const p = prisma as any;

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

// ═══════════════════════════════════════════════════════════════════
// N+1 REGRESSION TEST — proves batch context eliminates per-day queries
// ═══════════════════════════════════════════════════════════════════

describe('Payroll N+1 elimination — batch context', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  const mockPayees = [
    { userId: 'u1', name: 'Ali', payeeType: 'TEACHER' as const, branchRole: 'teacher', profileSalary: 50000, employeeId: 'E1', workRole: null },
    { userId: 'u2', name: 'Sara', payeeType: 'STAFF' as const, branchRole: 'management', profileSalary: 40000, employeeId: 'E2', workRole: 'admin' },
  ];

  function setupMocks() {
    // AcademicYear calendar
    jest.spyOn(p.academicYear, 'findUnique').mockResolvedValue({
      id: 'ay1',
      calendar: { startDate: new Date('2026-04-01'), endDate: new Date('2027-03-31') },
    } as any);

    // BranchMembers with tenures
    jest.spyOn(p.branchMember, 'findMany').mockResolvedValue([
      {
        userId: 'u1', branchId: 'b1', isActive: true, resignedAt: null,
        tenures: [{ joinedAt: new Date('2025-01-01'), leftAt: null, sequence: 1 }],
      },
      {
        userId: 'u2', branchId: 'b1', isActive: true, resignedAt: null,
        tenures: [{ joinedAt: new Date('2024-06-01'), leftAt: null, sequence: 1 }],
      },
    ] as any);

    // User joining dates (fallback)
    jest.spyOn(p.user, 'findMany').mockResolvedValue([
      { id: 'u1', teacherProfile: { joiningDate: new Date('2025-01-01') }, staffProfile: null },
      { id: 'u2', teacherProfile: null, staffProfile: { joiningDate: new Date('2024-06-01') } },
    ] as any);

    // Previous balances
    jest.spyOn(p.payrollMonthBalance, 'findMany').mockResolvedValue([
      { payeeUserId: 'u1', closingBalance: 5000 },
      { payeeUserId: 'u2', closingBalance: 0 },
    ] as any);

    // Attendance (empty for simplicity)
    jest.spyOn(p.teacherAttendance, 'findMany').mockResolvedValue([]);
    jest.spyOn(p.staffAttendance, 'findMany').mockResolvedValue([]);

    // BranchMember.findUnique for legacy validateEmployeeAttendanceDate
    jest.spyOn(p.branchMember, 'findUnique').mockResolvedValue({
      userId: 'u1', branchId: 'b1', isActive: true, resignedAt: null,
      tenures: [{ joinedAt: new Date('2025-01-01'), leftAt: null, sequence: 1 }],
    } as any);

    // Payments (empty)
    jest.spyOn(p.payrollPaymentDetail, 'findMany').mockResolvedValue([]);

    // Balance upsert
    jest.spyOn(p.payrollMonthBalance, 'upsert').mockResolvedValue({
      id: 'bal1', branchId: 'b1', payeeUserId: 'u1', salaryMonth: '2026-07',
      closingBalance: 5000, profileSalary: 50000, attendanceEarned: 0,
      openingBalance: 5000, totalPaid: 0, extraDue: 0,
      presentDays: 0, absentDays: 0, lateDays: 0, leaveDays: 0, unmarkedDays: 0, workingDays: 0,
      payeeType: 'TEACHER', computedAt: new Date(), createdAt: new Date(), updatedAt: new Date(),
    } as any);

    // Previous balance (findUnique for legacy getOpeningBalance path)
    jest.spyOn(p.payrollMonthBalance, 'findUnique').mockResolvedValue(null as any);
  }

  test('buildPayrollContext issues only ~7 batch queries regardless of payee count', async () => {
    setupMocks();

    const ctx = await buildPayrollContext('b1', 'ay1', '2026-07', mockPayees);

    // Verify batch queries were called exactly once each
    expect(p.academicYear.findUnique).toHaveBeenCalledTimes(1);
    expect(p.branchMember.findMany).toHaveBeenCalledTimes(1);
    expect(p.user.findMany).toHaveBeenCalledTimes(1);
    expect(p.payrollMonthBalance.findMany).toHaveBeenCalledTimes(1);
    expect(p.teacherAttendance.findMany).toHaveBeenCalledTimes(1);
    expect(p.staffAttendance.findMany).toHaveBeenCalledTimes(1);
    expect(p.payrollPaymentDetail.findMany).toHaveBeenCalledTimes(1);

    // Context should contain pre-fetched data
    expect(ctx.branchMembers.size).toBe(2);
    expect(ctx.joiningDates.size).toBe(2);
    expect(ctx.previousBalances.get('u1')).toBe(5000);
  });

  test('computePayrollMonth with context issues 0 queries for date validation', async () => {
    setupMocks();

    const ctx = await buildPayrollContext('b1', 'ay1', '2026-07', mockPayees);

    // Reset call counts after context build
    jest.clearAllMocks();

    await computePayrollMonth('b1', 'u1', 'TEACHER', '2026-07', 'ay1', 50000, ctx);

    // The ONLY DB call should be the balance upsert
    expect(p.payrollMonthBalance.upsert).toHaveBeenCalledTimes(1);

    // Zero calls for: AcademicYear, BranchMember, User, TeacherAttendance, PayrollPaymentDetail
    expect(p.academicYear.findUnique).not.toHaveBeenCalled();
    expect(p.branchMember.findMany).not.toHaveBeenCalled();
    expect(p.user.findMany).not.toHaveBeenCalled();
    expect(p.teacherAttendance.findMany).not.toHaveBeenCalled();
    expect(p.payrollPaymentDetail.findMany).not.toHaveBeenCalled();
  });

  test('computePayrollMonth without context still works (backward compat)', async () => {
    setupMocks();

    // Legacy mode: no context passed
    // Need to mock the individual queries that validateEmployeeAttendanceDate uses
    jest.spyOn(p.branchMember, 'findUnique').mockResolvedValue({
      userId: 'u1', branchId: 'b1', isActive: true, resignedAt: null,
      tenures: [{ joinedAt: new Date('2025-01-01'), leftAt: null, sequence: 1 }],
    } as any);

    const result = await computePayrollMonth('b1', 'u1', 'TEACHER', '2026-07', 'ay1', 50000);

    expect(result.summary).toBeDefined();
    expect(result.balance).toBeDefined();
    expect(result.missingDates).toBeDefined();
  });

  test('total query count for 2 payees is ~8 (7 batch + 1 upsert each)', async () => {
    setupMocks();

    const ctx = await buildPayrollContext('b1', 'ay1', '2026-07', mockPayees);

    // Count all prisma calls made during context build
    const contextQueryCount = [
      p.academicYear.findUnique,
      p.branchMember.findMany,
      p.user.findMany,
      p.payrollMonthBalance.findMany,
      p.teacherAttendance.findMany,
      p.staffAttendance.findMany,
      p.payrollPaymentDetail.findMany,
    ].reduce((sum, mock) => sum + (mock as jest.Mock).mock.calls.length, 0);

    // Context build: exactly 7 queries
    expect(contextQueryCount).toBe(7);

    // Compute for both payees: 2 upserts (one per payee)
    await computePayrollMonth('b1', 'u1', 'TEACHER', '2026-07', 'ay1', 50000, ctx);
    await computePayrollMonth('b1', 'u2', 'STAFF', '2026-07', 'ay1', 40000, ctx);

    expect(p.payrollMonthBalance.upsert).toHaveBeenCalledTimes(2);

    // Total: 7 batch queries + 2 upserts = 9 DB operations for 2 payees
    // (vs ~400 queries in the legacy N+1 pattern)
  });
});
