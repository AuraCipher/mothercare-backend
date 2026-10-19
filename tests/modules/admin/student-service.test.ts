/**
 * Student Service Tests
 *
 * Tests StudentService.findAll and StudentService.create methods.
 */

jest.mock('bcryptjs', () => ({
  hash: jest.fn().mockResolvedValue('$2a$12$mocked_hash_for_testing'),
  compare: jest.fn().mockResolvedValue(true),
}));

import { prismaMock } from '../../mocks/prisma';
import { studentService } from '../../../src/modules/admin/services/student.service';

/**
 * Mock the "highest studentNumber in use" lookup and report every
 * admission-number / student-number collision check as free.
 *
 * The service uses `student.findFirst` for two different things: the MAX
 * lookup (has an `orderBy`) and the "is this number taken?" check (has a
 * `where`). Splitting them here keeps the two independent.
 */
function mockAllocation(maxStudentNumber: number | null, taken: { admissionNumbers?: string[]; studentNumbers?: number[] } = {}) {
  (prismaMock.student.findFirst as jest.Mock).mockImplementation((args: any) => {
    if (args?.orderBy) return Promise.resolve(maxStudentNumber === null ? null : { studentNumber: maxStudentNumber });
    const n = args?.where?.studentNumber;
    if (n !== undefined) {
      return Promise.resolve((taken.studentNumbers || []).includes(n) ? { id: 'taken' } : null);
    }
    return Promise.resolve(null);
  });
  (prismaMock.studentPerson.findFirst as jest.Mock).mockImplementation((args: any) =>
    Promise.resolve((taken.admissionNumbers || []).includes(args?.where?.admissionNumber) ? { id: 'taken' } : null),
  );
}

describe('StudentService.findAll', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns all students when limit: -1 (no pagination)', async () => {
    (prismaMock.student.findMany as jest.Mock).mockResolvedValue([{ id: 's1' }, { id: 's2' }]);
    (prismaMock.student.count as jest.Mock).mockResolvedValue(2);

    const result = await studentService.findAll({ limit: -1 });
    const call = (prismaMock.student.findMany as jest.Mock).mock.calls[0][0];
    expect(call.take).toBeUndefined();
    expect(result.data).toHaveLength(2);
  });

  test('applies default pagination limit of 20', async () => {
    (prismaMock.student.findMany as jest.Mock).mockResolvedValue([]);
    (prismaMock.student.count as jest.Mock).mockResolvedValue(0);

    await studentService.findAll({});
    const call = (prismaMock.student.findMany as jest.Mock).mock.calls[0][0];
    expect(call.take).toBe(20);
    expect(call.skip).toBe(0);
  });

  test('orders by group displayOrder ascending', async () => {
    (prismaMock.student.findMany as jest.Mock).mockResolvedValue([]);
    (prismaMock.student.count as jest.Mock).mockResolvedValue(0);

    await studentService.findAll({ limit: -1 });
    const call = (prismaMock.student.findMany as jest.Mock).mock.calls[0][0];
    expect(call.orderBy).toEqual([{ group: { displayOrder: 'asc' } }, { rollNumber: 'asc' }]);
  });

  test('filters by groupId', async () => {
    (prismaMock.student.findMany as jest.Mock).mockResolvedValue([]);
    (prismaMock.student.count as jest.Mock).mockResolvedValue(0);

    await studentService.findAll({ groupId: 'g1', limit: -1 });
    const call = (prismaMock.student.findMany as jest.Mock).mock.calls[0][0];
    expect(call.where.groupId).toBe('g1');
  });

  test('searches by name', async () => {
    (prismaMock.student.findMany as jest.Mock).mockResolvedValue([]);
    (prismaMock.student.count as jest.Mock).mockResolvedValue(0);

    await studentService.findAll({ search: 'Ali', limit: -1 });
    const call = (prismaMock.student.findMany as jest.Mock).mock.calls[0][0];
    expect(call.where.OR).toBeDefined();
  });

  test('returns total count in meta', async () => {
    (prismaMock.student.findMany as jest.Mock).mockResolvedValue([{ id: 's1' }]);
    (prismaMock.student.count as jest.Mock).mockResolvedValue(1);

    const result = await studentService.findAll({ limit: -1 });
    expect(result.meta.total).toBe(1);
  });

  test('paginates correctly with page and limit', async () => {
    (prismaMock.student.findMany as jest.Mock).mockResolvedValue([]);
    (prismaMock.student.count as jest.Mock).mockResolvedValue(50);

    await studentService.findAll({ page: 2, limit: 10 });
    const call = (prismaMock.student.findMany as jest.Mock).mock.calls[0][0];
    expect(call.skip).toBe(10);
    expect(call.take).toBe(10);
  });
});

describe('StudentService.create — rollNumber auto-assignment', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (prismaMock.academicYear.findFirst as jest.Mock).mockResolvedValue({ id: 'ay1', branchId: 'b1' });
    (prismaMock.academicYear.findUnique as jest.Mock).mockResolvedValue({ id: 'ay1', branchId: 'b1' });
    // The class decides the academic year the student is created under.
    (prismaMock.group.findUnique as jest.Mock).mockResolvedValue({ academicYearId: 'ay1' });
    (prismaMock.studentPerson.create as jest.Mock).mockResolvedValue({ id: 'person-1' });
  });

  test('auto-assigns the next free rollNumber within the group', async () => {
    (prismaMock.student.findMany as jest.Mock).mockResolvedValue([
      { rollNumber: '1' }, { rollNumber: '2' }, { rollNumber: '3' }, { rollNumber: '4' }, { rollNumber: '5' },
    ]);
    mockAllocation(100);
    (prismaMock.$queryRawUnsafe as jest.Mock).mockRejectedValue(new Error('no seq'));
    (prismaMock.student.create as jest.Mock).mockResolvedValue({ id: 's1', name: 'New Student', groupId: 'g1', rollNumber: '6' });

    await studentService.create({ name: 'New Student', groupId: 'g1' } as any);
    const call = (prismaMock.student.create as jest.Mock).mock.calls[0][0];
    expect(call.data.rollNumber).toBe('6');
  });

  test('uses roll 1 for groups with no students', async () => {
    (prismaMock.student.findMany as jest.Mock).mockResolvedValue([]);
    mockAllocation(200);
    (prismaMock.$queryRawUnsafe as jest.Mock).mockRejectedValue(new Error('no seq'));
    (prismaMock.student.create as jest.Mock).mockResolvedValue({ id: 's1', name: 'New', groupId: 'g1', rollNumber: '1' });

    await studentService.create({ name: 'New', groupId: 'g1' } as any);
    const call = (prismaMock.student.create as jest.Mock).mock.calls[0][0];
    expect(call.data.rollNumber).toBe('1');
  });

  test('never reuses a roll number that is already taken', async () => {
    // Gaps + a high max: COUNT+1 would have handed out roll 3 (taken).
    (prismaMock.student.findMany as jest.Mock).mockResolvedValue([
      { rollNumber: '1' }, { rollNumber: '3' }, { rollNumber: '27' }, { rollNumber: '30' },
    ]);
    mockAllocation(100);
    (prismaMock.$queryRawUnsafe as jest.Mock).mockRejectedValue(new Error('no seq'));
    (prismaMock.student.create as jest.Mock).mockResolvedValue({ id: 's1', groupId: 'g1' });

    await studentService.create({ name: 'Next Roll', groupId: 'g1' } as any);
    const call = (prismaMock.student.create as jest.Mock).mock.calls[0][0];
    expect(call.data.rollNumber).toBe('31');
  });

  test('compares roll numbers numerically, not as strings', async () => {
    // Lexicographically "9" > "30" — a string max would pick 9.
    (prismaMock.student.findMany as jest.Mock).mockResolvedValue([
      { rollNumber: '9' }, { rollNumber: '30' },
    ]);
    mockAllocation(100);
    (prismaMock.$queryRawUnsafe as jest.Mock).mockRejectedValue(new Error('no seq'));
    (prismaMock.student.create as jest.Mock).mockResolvedValue({ id: 's1', groupId: 'g1' });

    await studentService.create({ name: 'Numeric Roll', groupId: 'g1' } as any);
    const call = (prismaMock.student.create as jest.Mock).mock.calls[0][0];
    expect(call.data.rollNumber).toBe('31');
  });

  test('respects manual rollNumber override', async () => {
    mockAllocation(300);
    (prismaMock.$queryRawUnsafe as jest.Mock).mockRejectedValue(new Error('no seq'));
    (prismaMock.student.create as jest.Mock).mockResolvedValue({ id: 's1', rollNumber: '99' });

    await studentService.create({ name: 'Existing', groupId: 'g1', rollNumber: '99' } as any);
    const call = (prismaMock.student.create as jest.Mock).mock.calls[0][0];
    expect(call.data.rollNumber).toBe('99');
  });

  test('does not assign rollNumber if no groupId', async () => {
    mockAllocation(400);
    (prismaMock.$queryRawUnsafe as jest.Mock).mockRejectedValue(new Error('no seq'));
    (prismaMock.student.create as jest.Mock).mockResolvedValue({ id: 's1', name: 'No Group' });

    await studentService.create({ name: 'No Group' } as any);
    const call = (prismaMock.student.create as jest.Mock).mock.calls[0][0];
    expect(call.data.rollNumber).toBeUndefined();
  });

  test('generates admissionNumber when not provided', async () => {
    mockAllocation(500);
    (prismaMock.$queryRawUnsafe as jest.Mock).mockRejectedValue(new Error('no seq'));
    (prismaMock.student.create as jest.Mock).mockResolvedValue({ id: 's1' });

    await studentService.create({ name: 'Test' } as any);
    const call = (prismaMock.student.create as jest.Mock).mock.calls[0][0];
    expect(call.data.admissionNumber).toContain('MCS-');
  });

  test('generates username via utility', async () => {
    mockAllocation(600);
    (prismaMock.$queryRawUnsafe as jest.Mock).mockRejectedValue(new Error('no seq'));
    (prismaMock.student.create as jest.Mock).mockResolvedValue({ id: 's1' });

    await studentService.create({ name: 'Ali', groupId: 'g1' } as any);
    const call = (prismaMock.student.create as jest.Mock).mock.calls[0][0];
    expect(call.data.username).toBeDefined();
  });

  test('requires student name', async () => {
    await expect(studentService.create({} as any)).rejects.toBeDefined();
  });
});

describe('StudentService.create — admission number allocation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (prismaMock.academicYear.findFirst as jest.Mock).mockResolvedValue({ id: 'ay1', branchId: 'b1' });
    (prismaMock.academicYear.findUnique as jest.Mock).mockResolvedValue({ id: 'ay1', branchId: 'b1' });
    (prismaMock.studentPerson.create as jest.Mock).mockResolvedValue({ id: 'person-1' });
    (prismaMock.student.create as jest.Mock).mockResolvedValue({ id: 's1' });
    (prismaMock.student.count as jest.Mock).mockResolvedValue(0);
  });

  test('uses the database sequence when it is available', async () => {
    (prismaMock.$queryRawUnsafe as jest.Mock).mockResolvedValue([{ n: '4242' }]);
    mockAllocation(100);

    await studentService.create({ name: 'Seq Student' } as any);

    expect(prismaMock.$queryRawUnsafe).toHaveBeenCalledWith("SELECT nextval('students_number_seq') AS n");
    const call = (prismaMock.student.create as jest.Mock).mock.calls[0][0];
    expect(call.data.studentNumber).toBe(4242);
    expect(call.data.admissionNumber).toBe(`MCS-${new Date().getFullYear()}-4242`);
  });

  test('falls back to the highest student number when the sequence is missing', async () => {
    (prismaMock.$queryRawUnsafe as jest.Mock).mockRejectedValue(new Error('no seq'));
    mockAllocation(9361);

    await studentService.create({ name: 'Fallback Student' } as any);

    const call = (prismaMock.student.create as jest.Mock).mock.calls[0][0];
    expect(call.data.studentNumber).toBe(9362);
  });

  test('orders the fallback lookup with NULLS LAST (Postgres sorts NULLs first for DESC)', async () => {
    (prismaMock.$queryRawUnsafe as jest.Mock).mockRejectedValue(new Error('no seq'));
    mockAllocation(9361);

    await studentService.create({ name: 'Nulls Last' } as any);

    const lookup = (prismaMock.student.findFirst as jest.Mock).mock.calls
      .find((c: any[]) => c[0]?.orderBy);
    expect(lookup?.[0]?.orderBy).toEqual([{ studentNumber: { sort: 'desc', nulls: 'last' } }]);
  });

  test('skips an admission number that is already taken', async () => {
    (prismaMock.$queryRawUnsafe as jest.Mock).mockRejectedValue(new Error('no seq'));
    const year = new Date().getFullYear();
    mockAllocation(5, { admissionNumbers: [`MCS-${year}-0006`] });

    await studentService.create({ name: 'Collision' } as any);

    const call = (prismaMock.student.create as jest.Mock).mock.calls[0][0];
    expect(call.data.studentNumber).toBe(7);
    expect(call.data.admissionNumber).toBe(`MCS-${year}-0007`);
  });

  test('skips a student number that is already taken', async () => {
    (prismaMock.$queryRawUnsafe as jest.Mock).mockRejectedValue(new Error('no seq'));
    mockAllocation(5, { studentNumbers: [6] });

    await studentService.create({ name: 'Number Collision' } as any);

    const call = (prismaMock.student.create as jest.Mock).mock.calls[0][0];
    expect(call.data.studentNumber).toBe(7);
  });

  test('returns 409 instead of a 500 when no number can be allocated', async () => {
    (prismaMock.$queryRawUnsafe as jest.Mock).mockRejectedValue(new Error('no seq'));
    const year = new Date().getFullYear();
    mockAllocation(1, { admissionNumbers: Array.from({ length: 120 }, (_, i) => `MCS-${year}-${String(i + 2).padStart(4, '0')}`) });

    await expect(studentService.create({ name: 'No Number' } as any)).rejects.toMatchObject({ status: 409 });
    expect(prismaMock.student.create).not.toHaveBeenCalled();
  });

  test('keeps a manually supplied admission number', async () => {
    (prismaMock.$queryRawUnsafe as jest.Mock).mockRejectedValue(new Error('no seq'));
    mockAllocation(9361);

    await studentService.create({ name: 'Manual', admissionNumber: 'ADM-CUSTOM-1' } as any);

    const call = (prismaMock.student.create as jest.Mock).mock.calls[0][0];
    expect(call.data.admissionNumber).toBe('ADM-CUSTOM-1');
  });
});

describe('StudentService.create — academic year + branch resolution', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (prismaMock.studentPerson.create as jest.Mock).mockResolvedValue({ id: 'person-1' });
    (prismaMock.student.create as jest.Mock).mockResolvedValue({ id: 's1' });
    (prismaMock.student.count as jest.Mock).mockResolvedValue(0);
    (prismaMock.$queryRawUnsafe as jest.Mock).mockResolvedValue([{ n: '5000' }]);
    mockAllocation(5000);
  });

  test("uses the CLASS's academic year, never another branch's active year", async () => {
    // The class lives in year AY_CLASS, while a different branch has its
    // own ACTIVE year (AY_OTHER). The class must win.
    (prismaMock.group.findUnique as jest.Mock).mockResolvedValue({ academicYearId: 'AY_CLASS' });
    (prismaMock.academicYear.findUnique as jest.Mock).mockResolvedValue({ id: 'AY_CLASS', branchId: 'b1' });

    await studentService.create({ name: 'Scoped', groupId: 'g1' } as any);

    const call = (prismaMock.student.create as jest.Mock).mock.calls[0][0];
    expect(call.data.academicYearId).toBe('AY_CLASS');
    // The person record must be created in the same branch as the year.
    const person = (prismaMock.studentPerson.create as jest.Mock).mock.calls[0][0];
    expect(person.data.branchId).toBe('b1');
  });

  test('rejects an unknown class', async () => {
    (prismaMock.group.findUnique as jest.Mock).mockResolvedValue(null);

    await expect(studentService.create({ name: 'Bad Class', groupId: 'nope' } as any)).rejects.toMatchObject({ status: 400 });
    expect(prismaMock.student.create).not.toHaveBeenCalled();
  });

  test('falls back to the branch-scoped active year when no class is given', async () => {
    (prismaMock.academicYear.findFirst as jest.Mock).mockResolvedValue({ id: 'AY_BRANCH' });
    (prismaMock.academicYear.findUnique as jest.Mock).mockResolvedValue({ id: 'AY_BRANCH', branchId: 'b1' });

    await studentService.create({ name: 'No Class', branchId: 'b1' } as any);

    expect(prismaMock.academicYear.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: 'ACTIVE', branchId: 'b1' } }),
    );
    const call = (prismaMock.student.create as jest.Mock).mock.calls[0][0];
    expect(call.data.academicYearId).toBe('AY_BRANCH');
  });

  test('rejects a class whose year belongs to another branch', async () => {
    (prismaMock.group.findUnique as jest.Mock).mockResolvedValue({ academicYearId: 'AY_CLASS' });
    (prismaMock.academicYear.findUnique as jest.Mock).mockResolvedValue({ id: 'AY_CLASS', branchId: 'b-other' });

    await expect(
      studentService.create({ name: 'Mismatch', groupId: 'g1', branchId: 'b1' } as any),
    ).rejects.toMatchObject({ status: 400 });
    expect(prismaMock.student.create).not.toHaveBeenCalled();
  });
});
