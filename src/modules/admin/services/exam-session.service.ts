import { prisma } from '../../../lib/prisma';
import { logAudit, diffFields } from '../../../services/audit.service';

// ─── Types ────────────────────────────────────────────────────────────

export interface CreateExamSessionInput {
  name: string;
  startDate: Date;
  endDate: Date;
}

export interface UpdateExamSessionInput {
  name?: string;
  startDate?: Date;
  endDate?: Date;
}

// ─── Service ──────────────────────────────────────────────────────────

class ExamSessionService {
  async findAll(academicYearId: string) {
    return prisma.examSession.findMany({
      where: { academicYearId },
      orderBy: { startDate: 'desc' },
      include: { _count: { select: { examTypes: true, exams: true } } },
    });
  }

  async findById(id: string) {
    const session = await prisma.examSession.findUnique({
      where: { id },
      include: {
        examTypes: { orderBy: { name: 'asc' } },
        _count: { select: { exams: true, subjectResults: true, reportCards: true } },
      },
    });
    if (!session) throw { status: 404, message: 'Exam session not found' };
    return session;
  }

  async create(academicYearId: string, data: CreateExamSessionInput, createdById?: string) {
    const session = await prisma.examSession.create({
      data: {
        academicYearId,
        name: data.name.trim(),
        startDate: data.startDate,
        endDate: data.endDate,
        createdById,
        updatedById: createdById,
      },
    });

    await logAudit({
      action: 'CREATE',
      module: 'exams',
      entityType: 'ExamSession',
      entityId: session.id,
      newValue: { name: session.name, startDate: session.startDate, endDate: session.endDate },
    });

    return session;
  }

  async update(id: string, data: UpdateExamSessionInput) {
    const existing = await prisma.examSession.findUnique({ where: { id } });
    if (!existing) throw { status: 404, message: 'Exam session not found' };

    const updated = await prisma.examSession.update({
      where: { id },
      data: {
        ...(data.name !== undefined && { name: data.name.trim() }),
        ...(data.startDate !== undefined && { startDate: data.startDate }),
        ...(data.endDate !== undefined && { endDate: data.endDate }),
      },
    });

    const { oldChanged, newChanged } = diffFields(
      { name: existing.name, startDate: existing.startDate, endDate: existing.endDate },
      { name: updated.name, startDate: updated.startDate, endDate: updated.endDate },
    );
    await logAudit({
      action: 'UPDATE',
      module: 'exams',
      entityType: 'ExamSession',
      entityId: id,
      oldValue: oldChanged,
      newValue: newChanged,
    });

    return updated;
  }

  async delete(id: string) {
    const existing = await prisma.examSession.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            examTypes: true,
            exams: true,
            subjectResults: true,
            reportCards: true,
          },
        },
      },
    });
    if (!existing) throw { status: 404, message: 'Exam session not found' };

    // Warn if session has data (but allow deletion — cascade handles cleanup)
    if (existing._count.exams > 0 || existing._count.subjectResults > 0) {
      throw {
        status: 409,
        message: `Cannot delete "${existing.name}": ${existing._count.exams} exam(s) and ${existing._count.subjectResults} result(s) depend on it. Remove or reassign them first.`,
      };
    }

    await prisma.examSession.delete({ where: { id } });

    await logAudit({
      action: 'DELETE',
      module: 'exams',
      entityType: 'ExamSession',
      entityId: id,
      oldValue: { name: existing.name, startDate: existing.startDate, endDate: existing.endDate },
    });

    return { message: `Exam session "${existing.name}" deleted` };
  }
}

export const examSessionService = new ExamSessionService();
