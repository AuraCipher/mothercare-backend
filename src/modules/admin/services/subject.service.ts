import { prisma } from '../../../lib/prisma';

export interface CreateSubjectInput {
  name: string;
  code?: string;
  description?: string;
  totalMarks?: number;
  passingMarks?: number;
  isElective?: boolean;
  hodId?: string;
  createdById?: string;
}

export interface UpdateSubjectInput {
  name?: string;
  code?: string;
  description?: string;
  totalMarks?: number;
  passingMarks?: number;
  isElective?: boolean;
  hodId?: string | null;
  updatedById?: string;
}

class SubjectService {
  // Create a subject under an academic year
  async create(academicYearId: string, data: CreateSubjectInput) {
    const ay = await prisma.academicYear.findUnique({ where: { id: academicYearId } });
    if (!ay) throw { status: 404, message: 'Academic year not found' };

    // Check code uniqueness within AY
    if (data.code) {
      const existing = await prisma.subject.findUnique({
        where: { academicYearId_code: { academicYearId, code: data.code } },
      });
      if (existing) throw { status: 409, message: `Subject code "${data.code}" already exists in this academic year` };
    }

    // Verify HOD exists if provided
    if (data.hodId) {
      const hod = await prisma.user.findUnique({ where: { id: data.hodId } });
      if (!hod) throw { status: 404, message: 'HOD user not found' };
    }

    return prisma.subject.create({
      data: {
        academicYearId,
        name: data.name,
        code: data.code,
        description: data.description,
        totalMarks: data.totalMarks ?? 100,
        passingMarks: data.passingMarks ?? 50,
        isElective: data.isElective ?? false,
        hodId: data.hodId,
      },
      include: {
        hod: { select: { id: true, name: true } },
      },
    });
  }

  // List all subjects for an academic year
  async findAll(academicYearId: string) {
    return prisma.subject.findMany({
      where: { academicYearId },
      orderBy: { name: 'asc' },
      include: {
        hod: { select: { id: true, name: true } },
        _count: { select: { groupSubjects: true, teacherAssignments: true } },
      },
    });
  }

  // Find subject by ID
  async findById(id: string) {
    const subject = await prisma.subject.findUnique({
      where: { id },
      include: {
        hod: { select: { id: true, name: true } },
        groupSubjects: {
          include: {
            group: { select: { id: true, name: true, section: true } },
          },
        },
        _count: { select: { teacherAssignments: true } },
      },
    });
    if (!subject) throw { status: 404, message: 'Subject not found' };
    return subject;
  }

  // Update a subject
  async update(id: string, data: UpdateSubjectInput) {
    const existing = await prisma.subject.findUnique({ where: { id } });
    if (!existing) throw { status: 404, message: 'Subject not found' };

    // Check code uniqueness if changed
    if (data.code && data.code !== existing.code) {
      const conflict = await prisma.subject.findUnique({
        where: { academicYearId_code: { academicYearId: existing.academicYearId, code: data.code } },
      });
      if (conflict) throw { status: 409, message: `Subject code "${data.code}" already in use` };
    }

    // Verify HOD exists if being set
    if (data.hodId) {
      const hod = await prisma.user.findUnique({ where: { id: data.hodId } });
      if (!hod) throw { status: 404, message: 'HOD user not found' };
    }

    return prisma.subject.update({
      where: { id },
      data: {
        name: data.name,
        code: data.code,
        description: data.description,
        totalMarks: data.totalMarks,
        passingMarks: data.passingMarks,
        isElective: data.isElective,
        hodId: data.hodId,
      },
      include: {
        hod: { select: { id: true, name: true } },
      },
    });
  }

  // Delete a subject (blocks if linked to any group)
  async delete(id: string) {
    const existing = await prisma.subject.findUnique({
      where: { id },
      include: { _count: { select: { groupSubjects: true, teacherAssignments: true } } },
    });
    if (!existing) throw { status: 404, message: 'Subject not found' };

    if (existing._count.groupSubjects > 0 || existing._count.teacherAssignments > 0) {
      throw {
        status: 409,
        message: `Cannot delete: linked to ${existing._count.groupSubjects} class(es) and ${existing._count.teacherAssignments} teacher assignment(s)`,
      };
    }

    await prisma.subject.delete({ where: { id } });
    return { message: 'Subject deleted' };
  }

  // Link subject to groups (sections)
  async linkGroups(id: string, groupIds: string[]) {
    const subject = await prisma.subject.findUnique({ where: { id } });
    if (!subject) throw { status: 404, message: 'Subject not found' };

    const result = [];
    for (const groupId of groupIds) {
      try {
        const link = await prisma.groupSubject.create({
          data: { groupId, subjectId: id },
          include: { group: { select: { id: true, name: true, section: true } } },
        });
        result.push(link);
      } catch {
        // Skip if already linked
      }
    }
    return result;
  }

  // Unlink subject from a group
  async unlinkGroup(id: string, groupId: string) {
    const existing = await prisma.groupSubject.findUnique({
      where: { groupId_subjectId: { groupId, subjectId: id } },
    });
    if (!existing) throw { status: 404, message: 'Link not found' };

    await prisma.groupSubject.delete({
      where: { groupId_subjectId: { groupId, subjectId: id } },
    });
    return { message: 'Subject unlinked from class' };
  }
}

export const subjectService = new SubjectService();
