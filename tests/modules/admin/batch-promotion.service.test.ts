import { prismaMock } from '../../mocks/prisma';
import { batchPromotionService } from '../../../src/modules/admin/services/batch-promotion.service';

describe('BatchPromotionService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const sourceAy = {
    id: 'ay-source',
    branchId: 'branch-1',
    status: 'ACTIVE',
    calendar: { id: 'cal-1', label: '2025-2026' },
  };

  test('reuses existing BUILD_STAGE year when unique constraint is hit', async () => {
    prismaMock.academicYear.findFirst
      .mockResolvedValueOnce(sourceAy as any) // getPreconditions source
      .mockResolvedValueOnce({ id: 'ay-build', status: 'BUILD_STAGE' } as any); // fallback existing year after create conflict

    prismaMock.academicYear.findMany.mockResolvedValueOnce([]);
    prismaMock.batchPromotionRun.findFirst.mockResolvedValueOnce(null as any); // inProgress
    prismaMock.academicYear.create.mockRejectedValueOnce({ code: 'P2002' });
    prismaMock.batchPromotionRun.findFirst.mockResolvedValueOnce(null as any); // existing run check
    prismaMock.batchPromotionRun.create.mockResolvedValueOnce({
      id: 'run-1',
      targetAcademicYearId: 'ay-build',
    } as any);

    const result = await batchPromotionService.startRun({
      branchId: 'branch-1',
      sourceAcademicYearId: 'ay-source',
      calendarId: 'cal-2',
      promotedById: 'admin-1',
    });

    expect(result.id).toBe('run-1');
    expect(prismaMock.batchPromotionRun.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ targetAcademicYearId: 'ay-build' }),
      }),
    );
  });

  test('rejects when unique conflict points to non-BUILD year', async () => {
    prismaMock.academicYear.findFirst
      .mockResolvedValueOnce(sourceAy as any)
      .mockResolvedValueOnce({ id: 'ay-active', status: 'ACTIVE' } as any);

    prismaMock.academicYear.findMany.mockResolvedValueOnce([]);
    prismaMock.batchPromotionRun.findFirst.mockResolvedValueOnce(null as any);
    prismaMock.academicYear.create.mockRejectedValueOnce({ code: 'P2002' });

    await expect(
      batchPromotionService.startRun({
        branchId: 'branch-1',
        sourceAcademicYearId: 'ay-source',
        calendarId: 'cal-2',
        promotedById: 'admin-1',
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  test('validates applyCarry dependencies', async () => {
    prismaMock.batchPromotionRun.findFirst.mockResolvedValueOnce({
      id: 'run-1',
      branchId: 'branch-1',
      phase: 'SNAPSHOT_DONE',
      sourceAcademicYearId: 'ay-source',
      targetAcademicYearId: 'ay-target',
      carryOptions: { classes: false, students: true },
      sourceAy: { calendar: { label: '2025-26' } },
      targetAy: { calendar: { label: '2026-27' } },
    } as any);

    await expect(
      batchPromotionService.applyCarry('run-1', 'branch-1'),
    ).rejects.toMatchObject({ status: 400, message: expect.stringContaining('students') });
  });
});

