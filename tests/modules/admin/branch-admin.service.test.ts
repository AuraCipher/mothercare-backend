import { prismaMock } from '../../mocks/prisma';
import { branchAdminService } from '../../../src/modules/admin/services/branch-admin.service';
import { createMockUser, createMockBranch, createMockBranchMember } from '../../helpers/factories';

describe('BranchAdminService', () => {
  const mockBranch = createMockBranch();
  const mockUser = createMockUser({ role: 'teacher' });
  const mockSuccessor = createMockUser({ role: 'teacher' });

  beforeEach(() => { jest.clearAllMocks(); });

  describe('promoteToAdmin', () => {
    test('promotes a teacher to branch_admin with keepTeacherRole=true', async () => {
      const membership = createMockBranchMember({ branchId: mockBranch.id, userId: mockUser.id, role: 'teacher' });
      prismaMock.branchMember.findUnique.mockResolvedValue(membership as any);
      prismaMock.branchMember.findFirst.mockResolvedValue(null);
      prismaMock.branchMember.update.mockResolvedValue({ ...membership, role: 'branch_admin' } as any);

      const result = await branchAdminService.promoteToAdmin(mockBranch.id, mockUser.id, true);
      expect(result).toBeDefined();
    });

    test('throws 409 when promoting and admin already exists', async () => {
      const membership = createMockBranchMember({ branchId: mockBranch.id, userId: mockUser.id, role: 'teacher' });
      prismaMock.branchMember.findUnique.mockResolvedValue(membership as any);
      prismaMock.branchMember.findFirst.mockResolvedValue(createMockBranchMember({ role: 'branch_admin' }) as any);

      await expect(branchAdminService.promoteToAdmin(mockBranch.id, mockUser.id, true))
        .rejects.toMatchObject({ status: 409 });
    });

    test('adds user as admin if they are not a member yet', async () => {
      prismaMock.branchMember.findUnique.mockResolvedValue(null);
      prismaMock.branch.findUnique.mockResolvedValue(mockBranch as any);
      prismaMock.user.findUnique.mockResolvedValue(mockUser as any);
      prismaMock.branchMember.findFirst.mockResolvedValue(null);
      prismaMock.branchMember.create.mockResolvedValue(createMockBranchMember({
        branchId: mockBranch.id,
        userId: mockUser.id,
        role: 'branch_admin',
      }) as any);

      const result = await branchAdminService.promoteToAdmin(mockBranch.id, mockUser.id, true);
      expect(result).toBeDefined();
    });
  });

  describe('resign', () => {
    test('transfers admin role to successor and demotes caller', async () => {
      const successorMembership = createMockBranchMember({
        branchId: mockBranch.id,
        userId: mockSuccessor.id,
        role: 'teacher',
        isActive: true,
      });
      prismaMock.branchMember.findUnique.mockResolvedValue(successorMembership as any);
      prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));

      const result = await branchAdminService.resign(mockBranch.id, mockUser.id, mockSuccessor.id, 'teacher');
      expect(result).toBeDefined();
      expect(result.successorUserId).toBe(mockSuccessor.id);
    });

    test('throws 400 if successor is not a member', async () => {
      prismaMock.branchMember.findUnique.mockResolvedValue(null);

      await expect(branchAdminService.resign(mockBranch.id, mockUser.id, mockSuccessor.id, 'teacher'))
        .rejects.toMatchObject({ status: 400 });
    });

    test('throws 409 if successor is already branch_admin', async () => {
      const successorMembership = createMockBranchMember({
        branchId: mockBranch.id,
        userId: mockSuccessor.id,
        role: 'branch_admin',
      });
      prismaMock.branchMember.findUnique.mockResolvedValue(successorMembership as any);

      await expect(branchAdminService.resign(mockBranch.id, mockUser.id, mockSuccessor.id, 'teacher'))
        .rejects.toMatchObject({ status: 409 });
    });

    test('throws 400 if successor is inactive', async () => {
      const successorMembership = createMockBranchMember({
        branchId: mockBranch.id,
        userId: mockSuccessor.id,
        role: 'teacher',
        isActive: false,
      });
      prismaMock.branchMember.findUnique.mockResolvedValue(successorMembership as any);

      await expect(branchAdminService.resign(mockBranch.id, mockUser.id, mockSuccessor.id, 'teacher'))
        .rejects.toMatchObject({ status: 400 });
    });

    test('throws 400 on invalid demoteToRole', async () => {
      const successorMembership = createMockBranchMember({
        branchId: mockBranch.id,
        userId: mockSuccessor.id,
        role: 'teacher',
        isActive: true,
      });
      prismaMock.branchMember.findUnique.mockResolvedValue(successorMembership as any);

      await expect(branchAdminService.resign(mockBranch.id, mockUser.id, mockSuccessor.id, 'invalid_role'))
        .rejects.toMatchObject({ status: 400 });
    });
  });
});
