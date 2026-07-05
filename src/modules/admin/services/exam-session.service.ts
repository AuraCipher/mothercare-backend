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

  async getSummary(sessionId: string) {
    const session = await prisma.examSession.findUnique({
      where: { id: sessionId },
      select: {
        id: true,
        name: true,
        startDate: true,
        endDate: true,
        academicYearId: true,
        _count: { select: { examTypes: true, exams: true, subjectResults: true, reportCards: true } },
      },
    });
    if (!session) throw { status: 404, message: 'Exam session not found' };

    const exams = await prisma.exam.findMany({
      where: { examSessionId: sessionId },
      select: {
        id: true,
        name: true,
        status: true,
        startDate: true,
        endDate: true,
        examClasses: {
          where: { isActive: true },
          select: {
            id: true,
            classId: true,
            subjects: {
              where: { isActive: true },
              select: {
                id: true,
                _count: { select: { marksEntries: true } },
              },
            },
          },
        },
      },
      orderBy: { startDate: 'desc' },
    });

    let totalSubjectSlots = 0;
    let filledSubjectSlots = 0;

    const examSummaries = exams.map((exam) => {
      let examTotal = 0;
      let examFilled = 0;
      for (const ec of exam.examClasses) {
        for (const sub of ec.subjects) {
          examTotal++;
          if (sub._count.marksEntries > 0) examFilled++;
        }
      }
      totalSubjectSlots += examTotal;
      filledSubjectSlots += examFilled;
      const percent = examTotal > 0 ? Math.round((examFilled / examTotal) * 100) : 0;
      return {
        id: exam.id,
        name: exam.name,
        status: exam.status,
        startDate: exam.startDate,
        endDate: exam.endDate,
        classCount: exam.examClasses.length,
        marksProgress: { total: examTotal, filled: examFilled, percent },
      };
    });

    const marksPercent = totalSubjectSlots > 0
      ? Math.round((filledSubjectSlots / totalSubjectSlots) * 100)
      : 0;

    return {
      session: {
        id: session.id,
        name: session.name,
        startDate: session.startDate,
        endDate: session.endDate,
      },
      typeCount: session._count.examTypes,
      examCount: session._count.exams,
      subjectResultCount: session._count.subjectResults,
      reportCardCount: session._count.reportCards,
      marksProgress: {
        total: totalSubjectSlots,
        filled: filledSubjectSlots,
        percent: marksPercent,
      },
      exams: examSummaries,
    };
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
