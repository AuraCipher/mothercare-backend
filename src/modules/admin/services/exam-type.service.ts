import { prisma } from '../../../lib/prisma';
import { logAudit, diffFields } from '../../../services/audit.service';

// ─── Types ────────────────────────────────────────────────────────────

export interface CreateExamTypeInput {
  name: string;
  defaultWeight?: number;
}

export interface UpdateExamTypeInput {
  name?: string;
  defaultWeight?: number | null;
}

// ─── Service ──────────────────────────────────────────────────────────

class ExamTypeService {
  async findAll() {
    return prisma.examType.findMany({
      orderBy: { name: 'asc' },
    });
  }

  async findById(id: string) {
    const examType = await prisma.examType.findUnique({ where: { id } });
    if (!examType) throw { status: 404, message: 'Exam type not found' };
    return examType;
  }

  async create(data: CreateExamTypeInput, createdById?: string) {
    const { name, defaultWeight } = data;

    const examType = await prisma.examType.create({
      data: {
        name: name.trim(),
        defaultWeight: defaultWeight ?? undefined,
        createdById,
        updatedById: createdById,
      },
    });

    // Audit
    await logAudit({
      action: 'CREATE',
      module: 'exams',
      entityType: 'ExamType',
      entityId: examType.id,
      newValue: { name: examType.name, defaultWeight: examType.defaultWeight },
    });

    return examType;
  }

  async update(id: string, data: UpdateExamTypeInput) {
    const existing = await prisma.examType.findUnique({ where: { id } });
    if (!existing) throw { status: 404, message: 'Exam type not found' };

    const updated = await prisma.examType.update({
      where: { id },
      data: {
        ...(data.name !== undefined && { name: data.name.trim() }),
        ...(data.defaultWeight !== undefined && { defaultWeight: data.defaultWeight }),
      },
    });

    // Audit — only log changed fields
    const { oldChanged, newChanged } = diffFields(
      { name: existing.name, defaultWeight: existing.defaultWeight },
      { name: updated.name, defaultWeight: updated.defaultWeight },
    );
    await logAudit({
      action: 'UPDATE',
      module: 'exams',
      entityType: 'ExamType',
      entityId: id,
      oldValue: oldChanged,
      newValue: newChanged,
    });

    return updated;
  }

  async delete(id: string) {
    // Pre-query with _count to check if any exams reference this type (matching
    // existing subject.service.ts + section.service.ts pattern).
    const existing = await prisma.examType.findUnique({
      where: { id },
      include: { _count: { select: { exams: true } } },
    });
    if (!existing) throw { status: 404, message: 'Exam type not found' };
    if (existing._count.exams > 0) {
      throw {
        status: 409,
        message: `Cannot delete "${existing.name}": linked to ${existing._count.exams} exam(s). Remove all exams using this type first.`,
      };
    }

    await prisma.examType.delete({ where: { id } });

    // Audit
    await logAudit({
      action: 'DELETE',
      module: 'exams',
      entityType: 'ExamType',
      entityId: id,
      oldValue: { name: existing.name, defaultWeight: existing.defaultWeight },
    });

    return { message: `Exam type "${existing.name}" deleted` };
  }
}

export const examTypeService = new ExamTypeService();
