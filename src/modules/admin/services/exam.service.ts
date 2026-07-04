import { prisma } from '../../../lib/prisma';
import { logAudit, diffFields } from '../../../services/audit.service';

// ─── Types ────────────────────────────────────────────────────────────

export interface CreateExamInput {
  name: string;
  examTypeId: string;
  weightOverride?: number;
  startDate: Date;
  endDate?: Date;
}

export interface UpdateExamInput {
  name?: string;
  examTypeId?: string;
  weightOverride?: number | null;
  startDate?: Date;
  endDate?: Date | null;
  status?: 'DRAFT' | 'ACTIVE';
}

// ─── Service ──────────────────────────────────────────────────────────

class ExamService {
  async findAllBySession(examSessionId: string) {
    return prisma.exam.findMany({
      where: { examSessionId },
      orderBy: { startDate: 'desc' },
      include: {
        examType: { select: { id: true, name: true, defaultWeight: true } },
        _count: { select: { examClasses: true } },
      },
    });
  }

  async findAllByAcademicYear(academicYearId: string) {
    // Flatten: find all sessions in this AY, then all exams across those sessions
    return prisma.exam.findMany({
      where: { examSession: { academicYearId } },
      orderBy: [{ examSession: { startDate: 'desc' } }, { startDate: 'desc' }],
      include: {
        examSession: { select: { id: true, name: true } },
        examType: { select: { id: true, name: true, defaultWeight: true } },
        _count: { select: { examClasses: true } },
      },
    });
  }

  async findById(id: string) {
    const exam = await prisma.exam.findUnique({
      where: { id },
      include: {
        examSession: { select: { id: true, name: true } },
        examType: { select: { id: true, name: true, defaultWeight: true } },
        _count: { select: { examClasses: true } },
      },
    });
    if (!exam) throw { status: 404, message: 'Exam not found' };
    return exam;
  }

  async create(examSessionId: string, data: CreateExamInput, createdById?: string) {
    // ── Validate examTypeId belongs to this session ──────────────
    const examType = await prisma.examType.findUnique({ where: { id: data.examTypeId } });
    if (!examType) throw { status: 404, message: 'Exam type not found' };
    if (examType.examSessionId !== examSessionId) {
      throw {
        status: 400,
        message: 'Exam type does not belong to this session',
      };
    }

    const exam = await prisma.exam.create({
      data: {
        examSessionId,
        examTypeId: data.examTypeId,
        name: data.name.trim(),
        weightOverride: data.weightOverride ?? undefined,
        startDate: data.startDate,
        endDate: data.endDate ?? undefined,
        createdById,
        updatedById: createdById,
      },
    });

    await logAudit({
      action: 'CREATE',
      module: 'exams',
      entityType: 'Exam',
      entityId: exam.id,
      newValue: {
        name: exam.name,
        examSessionId,
        examTypeId: data.examTypeId,
        weightOverride: exam.weightOverride,
        startDate: exam.startDate,
        endDate: exam.endDate,
        status: exam.status,
      },
    });

    return exam;
  }

  async update(id: string, data: UpdateExamInput) {
    const existing = await prisma.exam.findUnique({ where: { id } });
    if (!existing) throw { status: 404, message: 'Exam not found' };

    // ── Status validation: DRAFT→ACTIVE requires examClasses ────
    if (data.status === 'ACTIVE' && existing.status === 'DRAFT') {
      const classCount = await prisma.examClass.count({ where: { examId: id, isActive: true } });
      if (classCount === 0) {
        throw {
          status: 400,
          message: 'Cannot publish: exam has no classes assigned. Add at least one class first.',
        };
      }
    }

    const updated = await prisma.exam.update({
      where: { id },
      data: {
        ...(data.name !== undefined && { name: data.name.trim() }),
        ...(data.examTypeId !== undefined && { examTypeId: data.examTypeId }),
        ...(data.weightOverride !== undefined && { weightOverride: data.weightOverride }),
        ...(data.startDate !== undefined && { startDate: data.startDate }),
        ...(data.endDate !== undefined && { endDate: data.endDate }),
        ...(data.status !== undefined && { status: data.status }),
      },
    });

    const { oldChanged, newChanged } = diffFields(
      {
        name: existing.name,
        weightOverride: existing.weightOverride,
        startDate: existing.startDate,
        endDate: existing.endDate,
        status: existing.status,
      },
      {
        name: updated.name,
        weightOverride: updated.weightOverride,
        startDate: updated.startDate,
        endDate: updated.endDate,
        status: updated.status,
      },
    );
    await logAudit({
      action: 'UPDATE',
      module: 'exams',
      entityType: 'Exam',
      entityId: id,
      oldValue: { ...oldChanged, examSessionId: existing.examSessionId },
      newValue: { ...newChanged, examSessionId: updated.examSessionId },
    });

    return updated;
  }

  async delete(id: string) {
    const existing = await prisma.exam.findUnique({
      where: { id },
      include: { _count: { select: { examClasses: true } } },
    });
    if (!existing) throw { status: 404, message: 'Exam not found' };
    if (existing._count.examClasses > 0) {
      throw {
        status: 409,
        message: `Cannot delete "${existing.name}": linked to ${existing._count.examClasses} class(es). Remove all classes first.`,
      };
    }

    await prisma.exam.delete({ where: { id } });

    await logAudit({
      action: 'DELETE',
      module: 'exams',
      entityType: 'Exam',
      entityId: id,
      oldValue: {
        name: existing.name,
        examSessionId: existing.examSessionId,
        examTypeId: existing.examTypeId,
      },
    });

    return { message: `Exam "${existing.name}" deleted` };
  }
}

export const examService = new ExamService();
