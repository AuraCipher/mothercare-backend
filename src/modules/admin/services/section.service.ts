import { prisma } from '../../../lib/prisma';

class SectionService {
  // Create a section under an academic year
  async create(academicYearId: string, data: { name: string; section?: string; displayOrder: number; capacity?: number }) {
    // Verify academic year exists
    const ay = await prisma.academicYear.findUnique({ where: { id: academicYearId } });
    if (!ay) throw { status: 404, message: 'Academic year not found' };

    // Check for duplicate [ayId, name, section]
    const existing = await prisma.group.findFirst({
      where: { academicYearId, name: data.name, section: data.section || null },
    });
    if (existing) throw { status: 409, message: `"${data.name}${data.section ? ` - ${data.section}` : ''}" already exists in this academic year` };

    return prisma.group.create({
      data: {
        academicYearId,
        name: data.name,
        section: data.section || null,
        displayOrder: data.displayOrder,
        capacity: data.capacity || 30,
      },
      include: {
        _count: { select: { members: true, students: true } },
      },
    });
  }

  // List sections for an academic year
  async findAll(academicYearId: string) {
    return prisma.group.findMany({
      where: { academicYearId },
      orderBy: { displayOrder: 'asc' },
      include: {
        _count: { select: { members: true, students: true } },
      },
    });
  }

  // Update a section
  async update(id: string, data: { name?: string; section?: string; displayOrder?: number; capacity?: number }) {
    const existing = await prisma.group.findUnique({ where: { id } });
    if (!existing) throw { status: 404, message: 'Section not found' };

    return prisma.group.update({
      where: { id },
      data: {
        name: data.name,
        section: data.section,
        displayOrder: data.displayOrder,
        capacity: data.capacity,
      },
      include: {
        _count: { select: { members: true, students: true } },
      },
    });
  }

  // Soft delete a section (blocks if linked to students, subjects, or teachers)
  async delete(id: string) {
    const existing = await prisma.group.findUnique({
      where: { id },
      include: { _count: { select: { students: true, groupSubjects: true, teacherAssignments: true } } },
    });
    if (!existing) throw { status: 404, message: 'Section not found' };

    const issues: string[] = [];
    if (existing._count.students > 0) issues.push(`${existing._count.students} student(s)`);
    if (existing._count.groupSubjects > 0) issues.push(`${existing._count.groupSubjects} subject link(s)`);
    if (existing._count.teacherAssignments > 0) issues.push(`${existing._count.teacherAssignments} teacher assignment(s)`);

    if (issues.length > 0) {
      throw {
        status: 409,
        message: `Cannot delete: ${issues.join(', ')} depend on this section. Remove dependencies first or deactivate instead.`,
      };
    }

    return prisma.group.update({
      where: { id },
      data: { isActive: false },
    });
  }
}

export const sectionService = new SectionService();
