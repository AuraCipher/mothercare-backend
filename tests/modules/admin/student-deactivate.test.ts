/**
 * Student deactivate / reactivate / permanent-delete + status filter.
 *
 * Mirrors the teachers flow: deactivate moves a student out of the active
 * list (status WITHDRAWN + audit log), reactivate restores ACTIVE, and the
 * permanent delete is guarded by enrollment history (like teacher
 * assignments) — records with history can never be hard-deleted.
 */
import { prismaMock } from '../../mocks/prisma';
import { studentService } from '../../../src/modules/admin/services/student.service';

function activeStudent(overrides: Record<string, any> = {}) {
  return {
    id: 's1',
    name: 'Ali Khan',
    status: 'ACTIVE',
    isActive: true,
    ...overrides,
  };
}

describe('studentService.deactivateStudent', () => {
  beforeEach(() => jest.clearAllMocks());

  test('sets WITHDRAWN + isActive false and writes an audit log', async () => {
    prismaMock.student.findUnique.mockResolvedValue(activeStudent() as any);
    prismaMock.student.update.mockResolvedValue(activeStudent({ status: 'WITHDRAWN', isActive: false }) as any);
    (prismaMock.$transaction as any).mockImplementation(async (cb: any) =>
      Array.isArray(cb) ? Promise.all(cb.map((o: any) => (typeof o === 'function' ? o(prismaMock) : o))) : cb(prismaMock),
    );

    const out = await studentService.deactivateStudent('s1', 'admin-1');

    expect(prismaMock.student.update).toHaveBeenCalledWith({
      where: { id: 's1' },
      data: { status: 'WITHDRAWN', isActive: false },
    });
    expect(prismaMock.studentStatusLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        studentId: 's1',
        previousStatus: 'ACTIVE',
        newStatus: 'WITHDRAWN',
        changedById: 'admin-1',
      }),
    });
    expect(out).toMatchObject({ status: 'WITHDRAWN', isActive: false });
  });

  test('rejects when the student is not ACTIVE', async () => {
    prismaMock.student.findUnique.mockResolvedValue(activeStudent({ status: 'WITHDRAWN' }) as any);

    await expect(studentService.deactivateStudent('s1')).rejects.toMatchObject({ status: 400 });
    expect(prismaMock.student.update).not.toHaveBeenCalled();
  });

  test('404 for a missing student', async () => {
    prismaMock.student.findUnique.mockResolvedValue(null as any);
    await expect(studentService.deactivateStudent('ghost')).rejects.toMatchObject({ status: 404 });
  });
});

describe('studentService.reactivateStudent', () => {
  beforeEach(() => jest.clearAllMocks());

  test('restores ACTIVE + isActive and logs the transition', async () => {
    prismaMock.student.findUnique.mockResolvedValue(activeStudent({ status: 'WITHDRAWN', isActive: false }) as any);
    (prismaMock.$transaction as any).mockImplementation(async (cb: any) =>
      Array.isArray(cb) ? Promise.all(cb.map((o: any) => (typeof o === 'function' ? o(prismaMock) : o))) : cb(prismaMock),
    );

    await studentService.reactivateStudent('s1', 'admin-1');

    expect(prismaMock.student.update).toHaveBeenCalledWith({
      where: { id: 's1' },
      data: { status: 'ACTIVE', isActive: true },
    });
    expect(prismaMock.studentStatusLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ studentId: 's1', previousStatus: 'WITHDRAWN', newStatus: 'ACTIVE' }),
    });
  });

  test('rejects when the student is already ACTIVE', async () => {
    prismaMock.student.findUnique.mockResolvedValue(activeStudent() as any);
    await expect(studentService.reactivateStudent('s1')).rejects.toMatchObject({ status: 400 });
    expect(prismaMock.student.update).not.toHaveBeenCalled();
  });
});

describe('studentService.deleteStudent (permanent, guarded)', () => {
  beforeEach(() => jest.clearAllMocks());

  test('deletes a student with zero enrollment history', async () => {
    prismaMock.student.findUnique.mockResolvedValue(
      activeStudent({ status: 'WITHDRAWN', _count: { enrollments: 0 } }) as any,
    );

    const out = await studentService.deleteStudent('s1');

    expect(prismaMock.student.delete).toHaveBeenCalledWith({ where: { id: 's1' } });
    expect(out).toMatchObject({ id: 's1', name: 'Ali Khan' });
  });

  test('blocks delete when enrollment history exists (same guard as teachers)', async () => {
    prismaMock.student.findUnique.mockResolvedValue(
      activeStudent({ status: 'WITHDRAWN', _count: { enrollments: 3 } }) as any,
    );

    await expect(studentService.deleteStudent('s1')).rejects.toMatchObject({ status: 400 });
    expect(prismaMock.student.delete).not.toHaveBeenCalled();
  });

  test('blocks delete when student-fee history exists (restrictive FK)', async () => {
    prismaMock.student.findUnique.mockResolvedValue(
      activeStudent({ status: 'WITHDRAWN', _count: { enrollments: 0, studentFees: 1 } }) as any,
    );

    await expect(studentService.deleteStudent('s1')).rejects.toMatchObject({ status: 400 });
    expect(prismaMock.student.delete).not.toHaveBeenCalled();
  });

  test('blocks delete when attendance history exists', async () => {
    prismaMock.student.findUnique.mockResolvedValue(
      activeStudent({ status: 'WITHDRAWN', _count: { enrollments: 0, studentFees: 0, attendances: 12 } }) as any,
    );

    await expect(studentService.deleteStudent('s1')).rejects.toMatchObject({ status: 400 });
    expect(prismaMock.student.delete).not.toHaveBeenCalled();
  });

  test('blocks delete when fee payments exist', async () => {
    prismaMock.student.findUnique.mockResolvedValue(
      activeStudent({ status: 'WITHDRAWN', _count: { enrollments: 0, studentFees: 0, attendances: 0, feePayments: 2 } }) as any,
    );

    await expect(studentService.deleteStudent('s1')).rejects.toMatchObject({ status: 400 });
    expect(prismaMock.student.delete).not.toHaveBeenCalled();
  });

  test('error message names the reason so the UI can show it', async () => {
    prismaMock.student.findUnique.mockResolvedValue(
      activeStudent({ status: 'WITHDRAWN', _count: { enrollments: 0, studentFees: 1 } }) as any,
    );

    await expect(studentService.deleteStudent('s1')).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining('fee history'),
    });
  });

  test('404 for a missing student', async () => {
    prismaMock.student.findUnique.mockResolvedValue(null as any);
    await expect(studentService.deleteStudent('ghost')).rejects.toMatchObject({ status: 404 });
  });
});

describe('studentService.findAll status filter', () => {
  beforeEach(() => jest.clearAllMocks());

  test('defaults to active-only (status ACTIVE)', async () => {
    prismaMock.student.findMany.mockResolvedValue([]);
    prismaMock.student.count.mockResolvedValue(0 as any);

    await studentService.findAll({ branchId: 'b1' });

    const where = (prismaMock.student.findMany as jest.Mock).mock.calls[0][0].where;
    expect(where.status).toBe('ACTIVE');
  });

  test("inactive → status not ACTIVE (deactivated page)", async () => {
    prismaMock.student.findMany.mockResolvedValue([]);
    prismaMock.student.count.mockResolvedValue(0 as any);

    await studentService.findAll({ branchId: 'b1', status: 'inactive' });

    const where = (prismaMock.student.findMany as jest.Mock).mock.calls[0][0].where;
    expect(where.status).toEqual({ not: 'ACTIVE' });
  });

  test('all → no status constraint', async () => {
    prismaMock.student.findMany.mockResolvedValue([]);
    prismaMock.student.count.mockResolvedValue(0 as any);

    await studentService.findAll({ branchId: 'b1', status: 'all' });

    const where = (prismaMock.student.findMany as jest.Mock).mock.calls[0][0].where;
    expect(where.status).toBeUndefined();
  });

  test('includes enrollment count for the delete guard', async () => {
    prismaMock.student.findMany.mockResolvedValue([]);
    prismaMock.student.count.mockResolvedValue(0 as any);

    await studentService.findAll({ branchId: 'b1', status: 'inactive' });

    const include = (prismaMock.student.findMany as jest.Mock).mock.calls[0][0].include;
    expect(include._count.select.enrollments).toBe(true);
  });
});
