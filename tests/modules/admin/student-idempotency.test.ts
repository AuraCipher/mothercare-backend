/**
 * Student create idempotency tests.
 *
 * POST /admin/students allocates a fresh admission number on every call,
 * so the DB alone cannot tell a retry from a new child. The idempotency
 * key (m18) + the soft-duplicate guard turn resubmits into replays:
 * - same key -> the first committed student (fast path or, in a race,
 *   convergence on the unique index winner)
 * - no key but same child in the same class within minutes -> the first
 *   admission instead of a stacked copy
 */

import { prismaMock } from '../../mocks/prisma';
import { studentService } from '../../../src/modules/admin/services/student.service';

const KEY = '8f0c2fca-8b1e-4f4e-9d0d-000000000001';
const EXISTING = {
  id: 'student-1',
  name: 'Zubair',
  studentNumber: 9400,
  admissionNumber: 'MCS-2026-9400',
  group: { id: 'g1', name: 'Class 2', section: null },
};

function mockScopePath(groupAY = 'ay1', branchId = 'b1') {
  (prismaMock.group.findUnique as jest.Mock).mockResolvedValue({ academicYearId: groupAY });
  (prismaMock.academicYear.findUnique as jest.Mock).mockResolvedValue({ branchId });
}

function mockAllocation(nextSequence = 9910) {
  (prismaMock.$queryRawUnsafe as jest.Mock).mockResolvedValue([{ n: String(nextSequence) }]);
  (prismaMock.studentPerson.findFirst as jest.Mock).mockResolvedValue(null);
  (prismaMock.studentPerson.create as jest.Mock).mockResolvedValue({ id: 'person-1' });
  (prismaMock.student.findFirst as jest.Mock).mockResolvedValue(null);
  (prismaMock.student.findMany as jest.Mock).mockResolvedValue([]);
  (prismaMock.student.create as jest.Mock).mockResolvedValue({
    id: 'student-new', name: 'Zubair', studentNumber: nextSequence,
    admissionNumber: `MCS-2026-${nextSequence}`,
    group: { id: 'g1', name: 'Class 2', section: null },
  });
}

const input = (extra: Record<string, unknown> = {}) => ({
  name: 'Zubair',
  academicYearId: 'ay1',
  groupId: 'g1',
  branchId: 'b1',
  createdById: 'admin-1',
  ...extra,
});

describe('studentService.create — idempotency key', () => {
  beforeEach(jest.clearAllMocks);

  test('rejects a malformed key with 400', async () => {
    await expect(studentService.create(input({ idempotencyKey: '   ' })))
      .rejects.toMatchObject({ status: 400 });
    await expect(studentService.create(input({ idempotencyKey: 'x'.repeat(129) })))
      .rejects.toMatchObject({ status: 400 });
    expect(prismaMock.student.create).not.toHaveBeenCalled();
  });

  test('replays the first committed student for the same key', async () => {
    mockScopePath();
    (prismaMock.student.findFirst as jest.Mock).mockResolvedValue({ ...EXISTING });

    const res = await studentService.create(input({ idempotencyKey: KEY }));

    expect((res as any).replayed).toBe(true);
    expect((res as any).id).toBe('student-1');
    expect(prismaMock.student.create).not.toHaveBeenCalled();
    expect(prismaMock.studentPerson.create).not.toHaveBeenCalled();
  });

  test('creates once and stores the key when nothing matches', async () => {
    mockScopePath();
    mockAllocation(9910);

    const res = (await studentService.create(input({ idempotencyKey: KEY }))) as any;

    expect(res.replayed).toBeUndefined();
    expect(res.deduplicated).toBeUndefined();
    expect(prismaMock.student.create).toHaveBeenCalledTimes(1);
    const payload = (prismaMock.student.create as jest.Mock).mock.calls[0][0];
    expect(payload.data.idempotencyKey).toBe(KEY);
  });

  test('a lost race on the key converges on the winner instead of 409', async () => {
    mockScopePath();
    mockAllocation(9911);
    // The create loses the unique-index arbitration, the lookup finds the
    // request that won. The walk's number check consumes the first two
    // lookups — replay fast path, then the walk itself — before the
    // catch's convergence query runs third.
    (prismaMock.student.create as jest.Mock).mockRejectedValueOnce({
      code: 'P2002',
      meta: { target: 'students_idempotencyKey_key' },
    });
    (prismaMock.student.findFirst as jest.Mock)
      .mockResolvedValueOnce(null)             // replay fast path
      .mockResolvedValueOnce(null)             // admission walk: number free
      .mockResolvedValueOnce({ ...EXISTING }); // post-race lookup

    const res = (await studentService.create(input({ idempotencyKey: KEY }))) as any;

    expect(res.replayed).toBe(true);
    expect(res.id).toBe('student-1');
  });

  test('a different unique violation still throws', async () => {
    mockScopePath();
    mockAllocation(9912);
    (prismaMock.student.create as jest.Mock).mockRejectedValueOnce({
      code: 'P2002',
      meta: { target: 'student_persons_admissionNumber_key' },
    });

    await expect(studentService.create(input({ idempotencyKey: KEY })))
      .rejects.toMatchObject({ code: 'P2002' });
  });
});

describe('studentService.create — soft-duplicate guard', () => {
  beforeEach(jest.clearAllMocks);

  const recentTwin = {
    id: 'student-1',
    name: 'Zubair',
    studentNumber: 9400,
    parents: [{ parent: { user: { name: 'Ahmad Ali' } } }],
  };

  test('re-fills of the same child return the first admission', async () => {
    mockScopePath();
    (prismaMock.student.findFirst as jest.Mock)
      .mockResolvedValueOnce(null)             // replay fast path: no prior key
      .mockResolvedValueOnce({ ...EXISTING }); // guard's twin fetch
    (prismaMock.student.findMany as jest.Mock).mockResolvedValue([recentTwin]);

    // New key on every mount of the form is exactly the case the guard
    // exists for: same child, different retry identity.
    const res = await studentService.create(input({
      idempotencyKey: 'a-fresh-uuid-per-refill',
      guardianName: 'Ahmad Ali',
    }));

    expect((res as any).deduplicated).toBe(true);
    expect((res as any).id).toBe('student-1');
    // The guard runs BEFORE allocation: no sequence, no person, no student.
    expect(prismaMock.$queryRawUnsafe).not.toHaveBeenCalled();
    expect(prismaMock.studentPerson.create).not.toHaveBeenCalled();
    expect(prismaMock.student.create).not.toHaveBeenCalled();
  });

  test('two genuinely different kids with one name are not collapsed', async () => {
    mockScopePath();
    mockAllocation(9913);
    (prismaMock.student.findMany as jest.Mock).mockResolvedValue([
      { id: 'student-1', name: 'Zubair', studentNumber: 9400, parents: [{ parent: { user: { name: 'Ahmad Ali' } } }] },
    ]);

    const res = (await studentService.create(input({
      idempotencyKey: KEY,
      guardianName: 'Hina Khan',
    }))) as any;

    expect(res.deduplicated).toBeUndefined();
    expect(prismaMock.student.create).toHaveBeenCalledTimes(1);
  });

  test('the guard is scoped to the class and the recent window', async () => {
    mockScopePath();
    mockAllocation(9914);
    (prismaMock.student.findMany as jest.Mock).mockResolvedValue([]);

    (await studentService.create(input({ guardianName: 'Ahmad Ali' }))) as any;

    const guardQuery = (prismaMock.student.findMany as jest.Mock).mock.calls[0][0];
    expect(guardQuery.where.groupId).toBe('g1');
    expect(guardQuery.where.academicYearId).toBe('ay1');
    expect(guardQuery.where.isActive).toBe(true);
    expect(new Date(guardQuery.where.createdAt.gte).getTime())
      .toBeLessThanOrEqual(Date.now() - 110_000);
  });
});
