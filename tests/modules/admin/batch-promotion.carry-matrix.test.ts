import { prismaMock } from '../../mocks/prisma';
import { batchPromotionService } from '../../../src/modules/admin/services/batch-promotion.service';

type Carry = Record<string, boolean>;
const keys = ['classes', 'students', 'subjects', 'teacherAssignments', 'timetableGrid'];

function invalid(c: Carry) {
  return (!!c.students && !c.classes)
    || (!!c.teacherAssignments && (!c.classes || !c.subjects))
    || (!!c.timetableGrid && (!c.classes || !c.subjects));
}

describe('BatchPromotion carry dependency matrix', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  for (let mask = 0; mask < 2 ** keys.length; mask += 1) {
    const carry: Carry = {};
    keys.forEach((k, i) => { carry[k] = !!(mask & (1 << i)); });

    test(`dependency permutation ${mask + 1}/32`, async () => {
      prismaMock.batchPromotionRun.findFirst.mockResolvedValue({
        id: 'run-1',
        branchId: 'branch-1',
        phase: 'SNAPSHOT_DONE',
        sourceAcademicYearId: 'ay-source',
        targetAcademicYearId: 'ay-target',
        carryOptions: carry,
        sourceAy: { calendar: { label: '2025-26' } },
        targetAy: { calendar: { label: '2026-27' } },
      } as any);

      if (invalid(carry)) {
        await expect(batchPromotionService.applyCarry('run-1', 'branch-1')).rejects.toMatchObject({ status: 400 });
        return;
      }

      prismaMock.$transaction.mockImplementationOnce(async () => {
        throw { status: 599, message: 'after-dependency-check' };
      });
      await expect(batchPromotionService.applyCarry('run-1', 'branch-1')).rejects.toMatchObject({ status: 599 });
    });
  }
});
