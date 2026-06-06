import { prisma } from '../../../lib/prisma';

export interface CreateBranchInput {
  name: string;
  code: string;
  address?: string;
  phone?: string;
  email?: string;
  logoUrl?: string;
}

export interface UpdateBranchInput {
  name?: string;
  address?: string;
  phone?: string;
  email?: string;
  logoUrl?: string;
}

class BranchService {
  async create(data: CreateBranchInput) {
    // Check for duplicate name or code
    const existing = await prisma.branch.findFirst({
      where: { OR: [{ name: data.name }, { code: data.code }] },
    });
    if (existing) {
      if (existing.name === data.name) {
        throw { status: 409, message: `Branch with name "${data.name}" already exists` };
      }
      throw { status: 409, message: `Branch with code "${data.code}" already exists` };
    }

    return prisma.branch.create({ data });
  }

  async findAll() {
    return prisma.branch.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
      include: {
        _count: { select: { academicYears: true, branchMembers: true } },
      },
    });
  }

  async findById(id: string) {
    const branch = await prisma.branch.findUnique({
      where: { id },
      include: {
        _count: { select: { academicYears: true, branchMembers: true } },
        academicYears: {
          where: { status: 'ACTIVE' },
          select: { id: true, status: true },
        },
      },
    });
    if (!branch) {
      throw { status: 404, message: 'Branch not found' };
    }
    return branch;
  }

  async update(id: string, data: UpdateBranchInput) {
    const existing = await prisma.branch.findUnique({ where: { id } });
    if (!existing) {
      throw { status: 404, message: 'Branch not found' };
    }

    // Check for name/code uniqueness if being updated
    if (data.name) {
      const nameConflict = await prisma.branch.findFirst({
        where: { name: data.name, id: { not: id } },
      });
      if (nameConflict) {
        throw { status: 409, message: `Branch with name "${data.name}" already exists` };
      }
    }

    return prisma.branch.update({ where: { id }, data });
  }

  async deactivate(id: string) {
    const branch = await prisma.branch.findUnique({
      where: { id },
      include: { _count: { select: { academicYears: true } } },
    });
    if (!branch) {
      throw { status: 404, message: 'Branch not found' };
    }

    // Check for active academic years
    const activeAy = await prisma.academicYear.findFirst({
      where: { branchId: id, status: 'ACTIVE' },
    });
    if (activeAy) {
      throw { status: 409, message: 'Cannot deactivate branch: it has an active academic year' };
    }

    // Check for BUILD_STAGE years
    const buildStageAy = await prisma.academicYear.findFirst({
      where: { branchId: id, status: 'BUILD_STAGE' },
    });
    if (buildStageAy) {
      throw {
        status: 409,
        message: 'Cannot deactivate branch: it has a BUILD_STAGE academic year. Delete or archive it first.',
      };
    }

    return prisma.branch.update({
      where: { id },
      data: { isActive: false },
    });
  }
}

export const branchService = new BranchService();
