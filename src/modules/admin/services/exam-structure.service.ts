import { prisma } from '../../../lib/prisma';
import { basePrisma } from '../../../lib/prisma';
import { logAudit } from '../../../services/audit.service';

class ExamStructureService {
  async generateStructure(examId: string, createdById?: string) {
    // ── Verify exam exists ───────────────────────────────────────
    const exam = await prisma.exam.findUnique({
      where: { id: examId },
      include: { examSession: { select: { academicYearId: true } } },
    });
    if (!exam) throw { status: 404, message: 'Exam not found' };

    const academicYearId = exam.examSession.academicYearId;

    // ── Fetch all active groups + their subjects for this AY ──
    const groups = await prisma.group.findMany({
      where: { academicYearId, isActive: true },
      include: {
        groupSubjects: {
          include: { subject: { select: { id: true, name: true, code: true } } },
        },
      },
      orderBy: { displayOrder: 'asc' },
    });

    if (groups.length === 0) {
      throw { status: 400, message: 'No classes found for this academic year. Create classes first.' };
    }

    // ── Bulk-create structure in a transaction ─────────────────
    await basePrisma.$transaction(async (tx) => {
      for (const group of groups) {
        // Skip if ExamClass already exists for this exam+class combo
        const existing = await tx.examClass.findUnique({
          where: { examId_classId: { examId, classId: group.id } },
        });
        if (existing) continue;

        const examClass = await tx.examClass.create({
          data: {
            examId,
            classId: group.id,
            isActive: true,
            createdById,
            updatedById: createdById,
          },
        });

        for (const gs of group.groupSubjects) {
          await tx.examClassSubject.create({
            data: {
              examClassId: examClass.id,
              subjectId: gs.subject.id,
              isActive: true,
              createdById,
              updatedById: createdById,
            },
          });
        }
      }
    });

    // Count what was just created for the audit log
    const createdClasses = await prisma.examClass.count({ where: { examId } });
    const createdSubjects = await prisma.examClassSubject.count({
      where: { examClass: { examId } },
    });

    await logAudit({
      action: 'CREATE',
      module: 'exams',
      entityType: 'ExamClass',
      entityId: examId,
      metadata: { action: 'generate_structure', classCount: createdClasses, subjectCount: createdSubjects },
      newValue: { examId, classCount: createdClasses, subjectCount: createdSubjects },
    });

    return this.getStructure(examId);
  }

  async toggleClass(examClassId: string, isActive: boolean) {
    const examClass = await prisma.examClass.findUnique({
      where: { id: examClassId },
      include: {
        subjects: {
          select: {
            id: true,
            _count: { select: { marksEntries: true } },
          },
        },
      },
    });
    if (!examClass) throw { status: 404, message: 'Exam class not found' };

    // If toggling OFF, check no marks entries exist under any subject
    if (!isActive) {
      const hasMarks = examClass.subjects.some((s) => s._count.marksEntries > 0);
      if (hasMarks) {
        throw {
          status: 409,
          message: 'Cannot disable this class: marks have already been entered for one or more of its subjects. Remove the marks entries first.',
        };
      }
    }

    // Update the class
    const updated = await prisma.examClass.update({
      where: { id: examClassId },
      data: { isActive, updatedById: undefined },
    });

    // Cascade to all subjects
    await prisma.examClassSubject.updateMany({
      where: { examClassId },
      data: { isActive },
    });

    await logAudit({
      action: 'UPDATE',
      module: 'exams',
      entityType: 'ExamClass',
      entityId: examClassId,
      newValue: { isActive, cascadeSubjects: true, examId: examClass.examId },
    });

    return updated;
  }

  async toggleSubject(examClassSubjectId: string, isActive: boolean) {
    const ecs = await prisma.examClassSubject.findUnique({
      where: { id: examClassSubjectId },
      include: { _count: { select: { marksEntries: true } } },
    });
    if (!ecs) throw { status: 404, message: 'Exam class subject not found' };

    // If toggling OFF, check no marks entries exist
    if (!isActive && ecs._count.marksEntries > 0) {
      throw {
        status: 409,
        message: 'Cannot disable this subject: marks have already been entered. Remove the marks entries first.',
      };
    }

    const updated = await prisma.examClassSubject.update({
      where: { id: examClassSubjectId },
      data: { isActive },
    });

    await logAudit({
      action: 'UPDATE',
      module: 'exams',
      entityType: 'ExamClassSubject',
      entityId: examClassSubjectId,
      newValue: { isActive },
    });

    return updated;
  }

  async getStructure(examId: string) {
    const examClasses = await prisma.examClass.findMany({
      where: { examId },
      include: {
        class: { select: { id: true, name: true, section: true } },
        subjects: {
          include: {
            subject: { select: { id: true, name: true, code: true } },
            _count: { select: { marksEntries: true } },
          },
          orderBy: { subject: { name: 'asc' } },
        },
      },
      orderBy: { class: { displayOrder: 'asc' } },
    });

    // Map to add hasMarks booleans
    return examClasses.map((ec) => ({
      id: ec.id,
      examId: ec.examId,
      classId: ec.classId,
      isActive: ec.isActive,
      class: ec.class,
      hasMarks: ec.subjects.some((s) => s._count.marksEntries > 0),
      subjects: ec.subjects.map((s) => ({
        id: s.id,
        isActive: s.isActive,
        totalMarks: s.totalMarks,
        passingMarks: s.passingMarks,
        subject: s.subject,
        hasMarks: s._count.marksEntries > 0,
      })),
    }));
  }
}

export const examStructureService = new ExamStructureService();
