/**
 * Staff Service Tests — list status filtering + permanent delete guard.
 *
 * deleteStaff mirrors the teacher/student pattern: only staff with ZERO
 * attendance and payroll history may be removed for real; everything else
 * stays deactivated. The guard is also a correctness requirement —
 * payrollPaymentDetails.payee and payments.recordedBy are onDelete: Restrict,
 * so an unguarded prisma.user.delete() would throw P2014.
 *
 * listBranchStaff defaults to ACTIVE only (same contract as teachers) so a
 * deactivated member never shows up on the active Staff list.
 */

jest.mock('bcryptjs', () => ({
  hash: jest.fn().mockResolvedValue('$2a$12$mocked_hash_for_testing'),
  compare: jest.fn().mockResolvedValue(true),
}));

import { prismaMock } from '../../mocks/prisma';
import { staffService } from '../../../src/modules/admin/services/staff.service';

function mockNoHistory() {
  (prismaMock.staffAttendance.count as jest.Mock).mockResolvedValue(0);
  (prismaMock.payrollPaymentDetail.count as jest.Mock).mockResolvedValue(0);
  (prismaMock.payrollMonthBalance.count as jest.Mock).mockResolvedValue(0);
  (prismaMock.payment.count as jest.Mock).mockResolvedValue(0);
}

function mockMember(name = 'Ali Raza') {
  (prismaMock.branchMember.findUnique as jest.Mock).mockResolvedValue({
    id: 'm1',
    userId: 'u1',
    user: { id: 'u1', name },
  });
}

describe('StaffService.listBranchStaff — status filtering', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (prismaMock.branchMember.findMany as jest.Mock).mockResolvedValue([
      { id: 'm1', role: 'management', user: { id: 'u1', name: 'Active One', username: 'a1', email: null, phone: null, status: 'active', profilePhotoId: null, staffProfile: null }, modulePermissions: [] },
      { id: 'm2', role: 'management', user: { id: 'u2', name: 'Inactive One', username: 'i1', email: null, phone: null, status: 'inactive', profilePhotoId: null, staffProfile: null }, modulePermissions: [] },
    ]);
  });

  test('defaults to active staff only', async () => {
    const rows = await staffService.listBranchStaff('b1');
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('Active One');
  });

  test('defaults to active staff only when a non-status filter is passed', async () => {
    const rows = await staffService.listBranchStaff('b1', { search: 'one' });
    expect(rows.map((r) => r.name)).toEqual(['Active One']);
  });

  test('status=inactive returns only deactivated staff', async () => {
    const rows = await staffService.listBranchStaff('b1', { status: 'inactive' });
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('Inactive One');
  });

  test('status=all returns every member', async () => {
    const rows = await staffService.listBranchStaff('b1', { status: 'all' });
    expect(rows).toHaveLength(2);
  });
});

describe('StaffService.deleteStaff', () => {
  beforeEach(() => jest.clearAllMocks());

  test('deletes a staff member with no attendance or payroll history', async () => {
    mockMember();
    mockNoHistory();
    (prismaMock.user.delete as jest.Mock).mockResolvedValue({ id: 'u1' });

    const result = await staffService.deleteStaff('b1', 'u1');

    expect(result).toEqual({ id: 'u1', name: 'Ali Raza' });
    expect(prismaMock.user.delete).toHaveBeenCalledWith({ where: { id: 'u1' } });
  });

  test('blocks deletion when the staff member has attendance history', async () => {
    mockMember();
    (prismaMock.staffAttendance.count as jest.Mock).mockResolvedValue(12);
    (prismaMock.payrollPaymentDetail.count as jest.Mock).mockResolvedValue(0);
    (prismaMock.payrollMonthBalance.count as jest.Mock).mockResolvedValue(0);
    (prismaMock.payment.count as jest.Mock).mockResolvedValue(0);

    await expect(staffService.deleteStaff('b1', 'u1')).rejects.toMatchObject({
      status: 400,
      message: expect.stringMatching(/attendance or payroll history/i),
    });
    expect(prismaMock.user.delete).not.toHaveBeenCalled();
  });

  test('blocks deletion when the staff member has payroll payment details', async () => {
    mockMember();
    (prismaMock.staffAttendance.count as jest.Mock).mockResolvedValue(0);
    (prismaMock.payrollPaymentDetail.count as jest.Mock).mockResolvedValue(3);
    (prismaMock.payrollMonthBalance.count as jest.Mock).mockResolvedValue(0);
    (prismaMock.payment.count as jest.Mock).mockResolvedValue(0);

    await expect(staffService.deleteStaff('b1', 'u1')).rejects.toMatchObject({ status: 400 });
    expect(prismaMock.user.delete).not.toHaveBeenCalled();
  });

  test('blocks deletion when the staff member has a payroll month balance', async () => {
    mockMember();
    (prismaMock.staffAttendance.count as jest.Mock).mockResolvedValue(0);
    (prismaMock.payrollPaymentDetail.count as jest.Mock).mockResolvedValue(0);
    (prismaMock.payrollMonthBalance.count as jest.Mock).mockResolvedValue(1);
    (prismaMock.payment.count as jest.Mock).mockResolvedValue(0);

    await expect(staffService.deleteStaff('b1', 'u1')).rejects.toMatchObject({ status: 400 });
    expect(prismaMock.user.delete).not.toHaveBeenCalled();
  });

  test('blocks deletion when the staff member recorded fee payments', async () => {
    mockMember();
    (prismaMock.staffAttendance.count as jest.Mock).mockResolvedValue(0);
    (prismaMock.payrollPaymentDetail.count as jest.Mock).mockResolvedValue(0);
    (prismaMock.payrollMonthBalance.count as jest.Mock).mockResolvedValue(0);
    (prismaMock.payment.count as jest.Mock).mockResolvedValue(7);

    await expect(staffService.deleteStaff('b1', 'u1')).rejects.toMatchObject({ status: 400 });
    expect(prismaMock.user.delete).not.toHaveBeenCalled();
  });

  test('throws 404 when the staff member is not in the branch', async () => {
    (prismaMock.branchMember.findUnique as jest.Mock).mockResolvedValue(null);

    await expect(staffService.deleteStaff('b1', 'ghost')).rejects.toMatchObject({ status: 404 });
    expect(prismaMock.user.delete).not.toHaveBeenCalled();
  });
});
