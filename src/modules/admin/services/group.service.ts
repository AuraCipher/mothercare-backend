import { prisma } from '../../../lib/prisma';

export interface CreateGroupInput {
  academicYearId: string;
  name: string;
  section?: string;
  displayOrder?: number;
  capacity?: number;
}

export interface UpdateGroupInput {
  name?: string;
  section?: string;
  displayOrder?: number;
  capacity?: number;
}

class GroupService {
  async create(data: CreateGroupInput) {
    // Verify academic year exists
    const ay = await prisma.academicYear.findUnique({
      where: { id: data.academicYearId },
      select: { id: true, branchId: true },
    });
    if (!ay) throw { status: 404, message: 'Academic year not found' };

    // Check for duplicate [academicYearId, name, section]
    const existing = await prisma.group.findUnique({
      where: { academicYearId_name_section: { academicYearId: data.academicYearId, name: data.name, section: data.section || '' } },
    });
    if (existing) throw { status: 409, message: `Group "${data.name}"${data.section ? ` / ${data.section}` : ''} already exists in this academic year` };

    return prisma.group.create({
      data: {
        academicYearId: data.academicYearId,
        name: data.name,
        section: data.section || null,
        displayOrder: data.displayOrder || 1,
        capacity: data.capacity || 30,
      },
      include: {
        _count: { select: { members: true, students: true } },
      },
    });
  }

  async findByAcademicYear(academicYearId: string) {
    const groups = await prisma.group.findMany({
      where: { academicYearId, isActive: true },
      orderBy: { displayOrder: 'asc' },
      include: {
        _count: { select: { members: true, students: true } },
      },
    });
    return groups;
  }

  async findById(id: string) {
    const group = await prisma.group.findUnique({
      where: { id },
      include: {
        _count: { select: { members: true, students: true } },
        academicYear: { select: { id: true, branchId: true } },
      },
    });
    if (!group) throw { status: 404, message: 'Group not found' };
    return group;
  }

  async update(id: string, data: UpdateGroupInput) {
    const existing = await prisma.group.findUnique({ where: { id } });
    if (!existing) throw { status: 404, message: 'Group not found' };

    return prisma.group.update({
      where: { id },
      data: {
        name: data.name,
        section: data.section,
        displayOrder: data.displayOrder,
        capacity: data.capacity,
      },
    });
  }

  async delete(id: string) {
    const group = await prisma.group.findUnique({
      where: { id },
      include: { _count: { select: { students: true } } },
    });
    if (!group) throw { status: 404, message: 'Group not found' };
    if (group._count.students > 0) {
      throw { status: 409, message: `Cannot delete: ${group._count.students} student(s) are enrolled in this group` };
    }

    await prisma.group.update({
      where: { id },
      data: { isActive: false },
    });
    return { message: 'Group deactivated' };
  }
}

export const groupService = new GroupService();
