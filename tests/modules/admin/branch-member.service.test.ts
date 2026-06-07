import { prismaMock } from '../../mocks/prisma';
import { branchMemberService } from '../../../src/modules/admin/services/branch-member.service';
import { createMockUser, createMockBranch, createMockBranchMember } from '../../helpers/factories';

describe('BranchMemberService', () => {
  const mockBranch = createMockBranch();
  const mockUser = createMockUser({ role: 'teacher' });

  beforeEach(() => { jest.clearAllMocks(); });

  describe('addMember', () => {
    test('creates a member with valid data', async () => {
      prismaMock.branch.findUnique.mockResolvedValue(mockBranch as any);
      prismaMock.user.findUnique.mockResolvedValue(mockUser as any);
      prismaMock.branchMember.findUnique.mockResolvedValue(null);
      prismaMock.branchMember.findFirst.mockResolvedValue(null);
      prismaMock.branchMember.create.mockResolvedValue(createMockBranchMember({
        branchId: mockBranch.id,
        userId: mockUser.id,
        role: 'teacher',
      }) as any);

      const result = await branchMemberService.addMember({
        branchId: mockBranch.id,
        userId: mockUser.id,
        role: 'teacher',
      });
      expect(result).toBeDefined();
    });

    test('throws 409 on duplicate membership', async () => {
      prismaMock.branch.findUnique.mockResolvedValue(mockBranch as any);
      prismaMock.user.findUnique.mockResolvedValue(mockUser as any);
      prismaMock.branchMember.findUnique.mockResolvedValue(createMockBranchMember() as any);

      await expect(branchMemberService.addMember({
        branchId: mockBranch.id,
        userId: mockUser.id,
        role: 'teacher',
      })).rejects.toMatchObject({ status: 409 });
    });

    test('throws 404 when branch not found', async () => {
      prismaMock.branch.findUnique.mockResolvedValue(null);
      await expect(branchMemberService.addMember({
        branchId: 'bad',
        userId: mockUser.id,
        role: 'teacher',
      })).rejects.toMatchObject({ status: 404 });
    });

    test('throws 409 when adding second branch_admin', async () => {
      prismaMock.branch.findUnique.mockResolvedValue(mockBranch as any);
      prismaMock.user.findUnique.mockResolvedValue(mockUser as any);
      prismaMock.branchMember.findUnique.mockResolvedValue(null);
      prismaMock.branchMember.findFirst.mockResolvedValue(createMockBranchMember({ role: 'branch_admin' }) as any);

      await expect(branchMemberService.addMember({
        branchId: mockBranch.id,
        userId: mockUser.id,
        role: 'branch_admin',
      })).rejects.toMatchObject({ status: 409, message: expect.stringContaining('already has a branch_admin') });
    });
  });

  describe('updateRole', () => {
    test('updates member role', async () => {
      const membership = createMockBranchMember({ branchId: mockBranch.id, userId: mockUser.id, role: 'teacher' });
      prismaMock.branchMember.findUnique.mockResolvedValue(membership as any);
      prismaMock.branchMember.update.mockResolvedValue({ ...membership, role: 'sub_admin' } as any);

      const result = await branchMemberService.updateRole(mockBranch.id, mockUser.id, { role: 'sub_admin' });
      expect(result).toBeDefined();
    });

    test('throws 404 when membership not found', async () => {
      prismaMock.branchMember.findUnique.mockResolvedValue(null);
      await expect(branchMemberService.updateRole(mockBranch.id, mockUser.id, { role: 'sub_admin' }))
        .rejects.toMatchObject({ status: 404 });
    });

    test('throws 409 when promoting to admin and one already exists', async () => {
      const membership = createMockBranchMember({ branchId: mockBranch.id, userId: mockUser.id, role: 'teacher' });
      prismaMock.branchMember.findUnique.mockResolvedValue(membership as any);
      prismaMock.branchMember.findFirst.mockResolvedValue(createMockBranchMember({ role: 'branch_admin' }) as any);

      await expect(branchMemberService.updateRole(mockBranch.id, mockUser.id, { role: 'branch_admin' }))
        .rejects.toMatchObject({ status: 409 });
    });
  });

  describe('removeMember', () => {
    test('removes a member', async () => {
      const membership = createMockBranchMember({ branchId: mockBranch.id, userId: mockUser.id, role: 'teacher' });
      prismaMock.branchMember.findUnique.mockResolvedValue(membership as any);
      prismaMock.branchMember.update.mockResolvedValue({ ...membership, isActive: false } as any);

      await expect(branchMemberService.removeMember(mockBranch.id, mockUser.id)).resolves.not.toThrow();
    });

    test('throws 409 when removing last branch_admin', async () => {
      const membership = createMockBranchMember({ branchId: mockBranch.id, userId: mockUser.id, role: 'branch_admin' });
      prismaMock.branchMember.findUnique.mockResolvedValue(membership as any);
      prismaMock.branchMember.count.mockResolvedValue(0);

      await expect(branchMemberService.removeMember(mockBranch.id, mockUser.id))
        .rejects.toMatchObject({ status: 409 });
    });
  });

  describe('listStaff', () => {
    test('returns staff for a branch', async () => {
      prismaMock.branchMember.findMany.mockResolvedValue([
        createMockBranchMember({ branchId: mockBranch.id }),
      ] as any);
      const result = await branchMemberService.listStaff(mockBranch.id);
      expect(result).toHaveLength(1);
    });

    test('filters by role', async () => {
      prismaMock.branchMember.findMany.mockResolvedValue([]);
      await branchMemberService.listStaff(mockBranch.id, 'teacher');
      expect(prismaMock.branchMember.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ role: 'teacher' }),
        }),
      );
    });
  });

  describe('listUserBranches', () => {
    test("returns user's branch memberships", async () => {
      prismaMock.branchMember.findMany.mockResolvedValue([
        createMockBranchMember({ userId: mockUser.id }),
      ] as any);
      const result = await branchMemberService.listUserBranches(mockUser.id);
      expect(result).toHaveLength(1);
    });
  });
});
