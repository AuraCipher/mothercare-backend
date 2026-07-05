import { prismaMock } from '../../mocks/prisma';
import { searchBranchTeachers, syncTeachersForBranch } from '../../../src/modules/canteen/canteen-credit-rules';

describe('canteen-credit-rules', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('syncTeachersForBranch', () => {
    test('links orphans when branch has teacher assignment activity', async () => {
      prismaMock.user.findMany
        .mockResolvedValueOnce([{ id: 't-1' }] as any)
        .mockResolvedValueOnce([{ id: 't-2' }, { id: 't-3' }] as any);
      prismaMock.teacherAssignment.findFirst.mockResolvedValue({ id: 'a-1' } as any);
      prismaMock.branchMember.findUnique.mockResolvedValue(null);
      prismaMock.branchMember.create.mockResolvedValue({} as any);

      const result = await syncTeachersForBranch('branch-1');

      expect(result.linkedFromAssignments).toBe(1);
      expect(result.linkedOrphans).toBe(2);
      expect(prismaMock.branchMember.create).toHaveBeenCalledTimes(3);
    });

    test('skips orphan linking when branch has no teacher activity', async () => {
      prismaMock.user.findMany.mockResolvedValueOnce([] as any);
      prismaMock.teacherAssignment.findFirst.mockResolvedValue(null);

      const result = await syncTeachersForBranch('branch-2');

      expect(result).toEqual({ linkedFromAssignments: 0, linkedOrphans: 0 });
      expect(prismaMock.user.findMany).toHaveBeenCalledTimes(1);
    });
  });

  describe('searchBranchTeachers', () => {
    test('syncs then lists active teachers by branch membership', async () => {
      prismaMock.user.findMany
        .mockResolvedValueOnce([] as any)
        .mockResolvedValueOnce([] as any)
        .mockResolvedValueOnce([
          { id: 't-1', name: 'Ali Khan', phone: '0300' },
        ] as any);
      prismaMock.teacherAssignment.findFirst.mockResolvedValue({ id: 'a-1' } as any);

      const result = await searchBranchTeachers('branch-1', 'ali');

      expect(result).toEqual([{ id: 't-1', name: 'Ali Khan', phone: '0300' }]);
    });
  });
});
