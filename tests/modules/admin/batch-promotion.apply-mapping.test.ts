/**
 * Apply-mapping regression: group/subject ID maps must be exact 1:1.
 *
 * displayOrder is a grade level shared across sections (NOT unique) and
 * subject code is nullable (NULLs all match each other), so rebuilding the
 * maps by re-querying + fuzzy-matching collapses distinct rows onto one ID.
 * The duplicated (groupId, subjectId) pairs then fail group_subjects with
 * P2002 — the production 500 on POST .../promotion/runs/:id/apply.
 */
import { prismaMock } from '../../mocks/prisma';
import { batchPromotionService } from '../../../src/modules/admin/services/batch-promotion.service';

const CARRY = {
  classes: true,
  subjects: true,
  students: false,
  teacherAssignments: false,
  timetableGrid: false,
  feeStructures: false,
  datesheets: false,
};

function mockRun() {
  return {
    id: 'run-1',
    branchId: 'branch-1',
    phase: 'SNAPSHOT_DONE',
    sourceAcademicYearId: 'ay-source',
    targetAcademicYearId: 'ay-target',
    carryOptions: CARRY,
    sourceAy: { calendar: { label: '2025-26' } },
    targetAy: { calendar: { label: '2026-27' } },
    snapshotId: 'snap-1',
  };
}

describe('updateCarryOptions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  function draftRun(carry: Record<string, boolean> = {}) {
    return {
      id: 'run-1',
      branchId: 'branch-1',
      phase: 'DRAFT',
      sourceAcademicYearId: 'ay-source',
      targetAcademicYearId: 'ay-target',
      carryOptions: {
        classes: true, subjects: true, students: true,
        teacherAssignments: true, timetableGrid: true, feeStructures: true,
        ...carry,
      },
    };
  }

  test('saves merged options on a DRAFT run and returns the refreshed run', async () => {
    prismaMock.batchPromotionRun.findFirst.mockResolvedValue(draftRun() as any);
    prismaMock.batchPromotionRun.update.mockResolvedValue({} as any);

    const out = await batchPromotionService.updateCarryOptions('run-1', 'branch-1', {
      students: false,
    });

    expect(prismaMock.batchPromotionRun.update).toHaveBeenCalledWith({
      where: { id: 'run-1' },
      data: { carryOptions: expect.objectContaining({ students: false, classes: true }) },
    });
    expect(out).toMatchObject({ id: 'run-1' });
  });

  test('rejects when the run is past DRAFT', async () => {
    prismaMock.batchPromotionRun.findFirst.mockResolvedValue(
      draftRun({}) as any,
    );
    (prismaMock.batchPromotionRun.findFirst as any).mockResolvedValueOnce({
      ...draftRun(),
      phase: 'SNAPSHOT_DONE',
    } as any);

    await expect(
      batchPromotionService.updateCarryOptions('run-1', 'branch-1', { students: false }),
    ).rejects.toMatchObject({ status: 400 });
    expect(prismaMock.batchPromotionRun.update).not.toHaveBeenCalled();
  });

  test('rejects dependency-invalid combos (students without classes)', async () => {
    prismaMock.batchPromotionRun.findFirst.mockResolvedValue(draftRun() as any);

    await expect(
      batchPromotionService.updateCarryOptions('run-1', 'branch-1', {
        classes: false,
        students: true,
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(prismaMock.batchPromotionRun.update).not.toHaveBeenCalled();
  });
});
describe('applyCarry ID mapping', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('sections sharing displayOrder and null-code subjects map 1:1 (no P2002 pairs)', async () => {
    prismaMock.batchPromotionRun.findFirst.mockResolvedValue(mockRun() as any);
    (prismaMock as any).$queryRaw.mockResolvedValue([mockRun()]);

    // Two sections of the same grade share displayOrder 5.
    prismaMock.group.findMany.mockResolvedValue([
      { id: 'g1', name: 'Class 5', section: 'A', displayOrder: 5, capacity: 30, onlyAdminCanSend: false, isActive: true },
      { id: 'g2', name: 'Class 5', section: 'B', displayOrder: 5, capacity: 30, onlyAdminCanSend: false, isActive: true },
    ] as any);
    prismaMock.group.createMany.mockResolvedValue({ count: 2 } as any);

    // Both subjects have NULL codes.
    prismaMock.subject.findMany.mockResolvedValue([
      { id: 's1', name: 'English', code: null, description: null, totalMarks: 100, passingMarks: 40, isElective: false, hodId: null },
      { id: 's2', name: 'Urdu', code: null, description: null, totalMarks: 100, passingMarks: 40, isElective: false, hodId: null },
    ] as any);
    prismaMock.subject.createMany.mockResolvedValue({ count: 2 } as any);

    prismaMock.groupSubject.findMany.mockResolvedValue([
      { groupId: 'g1', subjectId: 's1', group: { id: 'g1' } },
      { groupId: 'g2', subjectId: 's1', group: { id: 'g2' } },
      { groupId: 'g1', subjectId: 's2', group: { id: 'g1' } },
    ] as any);
    prismaMock.groupSubject.createMany.mockResolvedValue({ count: 3 } as any);
    prismaMock.batchPromotionRun.update.mockResolvedValue({} as any);
    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));

    await batchPromotionService.applyCarry('run-1', 'branch-1');

    // Bulk shape preserved (DB-03D batching invariant).
    expect(prismaMock.group.createMany).toHaveBeenCalledTimes(1);
    expect(prismaMock.subject.createMany).toHaveBeenCalledTimes(1);

    expect(prismaMock.groupSubject.createMany).toHaveBeenCalledTimes(1);
    const rows = prismaMock.groupSubject.createMany.mock.calls[0]![0]!.data as Array<{
      groupId: string;
      subjectId: string;
    }>;
    expect(rows).toHaveLength(3);
    // g1's two links share one new group id; g2 maps to a different one
    // (no displayOrder collapse) …
    expect(rows[0]!.groupId).toBe(rows[2]!.groupId);
    expect(rows[1]!.groupId).not.toBe(rows[0]!.groupId);
    // … and s1/s2 map to different subjects (no NULL-code collapse).
    expect(rows[0]!.subjectId).toBe(rows[1]!.subjectId);
    expect(rows[2]!.subjectId).not.toBe(rows[0]!.subjectId);
    // The P2002 regression guard: every pair unique.
    const pairs = rows.map((r) => `${r.groupId}|${r.subjectId}`);
    expect(new Set(pairs).size).toBe(pairs.length);
  });
});
