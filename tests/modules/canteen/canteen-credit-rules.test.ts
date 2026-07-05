import { prismaMock } from '../../mocks/prisma';
import { searchBranchTeachers } from '../../../src/modules/canteen/canteen-credit-rules';

describe('canteen-credit-rules', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('searchBranchTeachers', () => {
    test('includes teachers assigned in active year without branch membership', async () => {
      prismaMock.academicYear.findFirst.mockResolvedValue({ id: 'ay-1' } as any);
      prismaMock.user.findMany
        .mockResolvedValueOnce([] as any)
        .mockResolvedValueOnce([
          { id: 't-1', name: 'Ali Khan', phone: '0300' },
        ] as any);

      const result = await searchBranchTeachers('branch-1');

      expect(result).toEqual([{ id: 't-1', name: 'Ali Khan', phone: '0300' }]);
      expect(prismaMock.user.findMany).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          where: expect.objectContaining({
            role: 'teacher',
            teacherAssignments: expect.any(Object),
          }),
        }),
      );
    });

    test('merges branch members and assigned teachers without duplicates', async () => {
      prismaMock.academicYear.findFirst.mockResolvedValue({ id: 'ay-1' } as any);
      prismaMock.user.findMany
        .mockResolvedValueOnce([
          { id: 't-1', name: 'Ali Khan', phone: '0300' },
        ] as any)
        .mockResolvedValueOnce([
          { id: 't-1', name: 'Ali Khan', phone: '0300' },
          { id: 't-2', name: 'Sara', phone: null },
        ] as any);

      const result = await searchBranchTeachers('branch-1');

      expect(result).toHaveLength(2);
      expect(result.map((t) => t.id).sort()).toEqual(['t-1', 't-2']);
    });
  });
});
