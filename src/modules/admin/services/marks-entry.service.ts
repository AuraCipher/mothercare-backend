import { prisma } from '../../../lib/prisma';
import { basePrisma } from '../../../lib/prisma';
import { logAudit } from '../../../services/audit.service';
import { notifyMarksAbsent, notifyMarksEntered } from '../../chat/services/system-notification.service';

type MarksEntryInput = {
  studentId: string;
  marksObtained?: number | null;
  isAbsent?: boolean;
};

type SaveMarksData = {
  totalMarks?: number;
  passingMarks?: number;
  entries: MarksEntryInput[];
};

class MarksEntryService {
  async getMarksGrid(examClassSubjectId: string) {
    const ecs = await prisma.examClassSubject.findUnique({
      where: { id: examClassSubjectId },
      include: {
        subject: { select: { id: true, name: true, code: true } },
        examClass: {
          include: {
            class: { select: { id: true, name: true, section: true } },
            exam: { select: { id: true, name: true, status: true } },
          },
        },
      },
    });
    if (!ecs) throw { status: 404, message: 'Exam class subject not found' };

    const classId = ecs.examClass.class.id;
    const examStatus = ecs.examClass.exam.status;

    // Fetch all students in this class, with existing marks entries
    const students = await prisma.student.findMany({
      where: { groupId: classId, isActive: true },
      select: {
        id: true,
        name: true,
        rollNumber: true,
        admissionNumber: true,
        examMarks: {
          where: { examClassSubjectId },
          select: {
            id: true,
            marksObtained: true,
            isAbsent: true,
          },
        },
      },
      orderBy: [{ rollNumber: 'asc' as const }, { name: 'asc' as const }],
    });

    return {
      totalMarks: ecs.totalMarks,
      passingMarks: ecs.passingMarks,
      subject: ecs.subject,
      className: ecs.examClass.class.name,
      classSection: ecs.examClass.class.section,
      examName: ecs.examClass.exam.name,
      examStatus,
      students: students.map((s) => ({
        id: s.id,
        name: s.name,
        rollNumber: s.rollNumber,
        admissionNumber: s.admissionNumber,
        marksObtained: s.examMarks[0]?.marksObtained ?? null,
        isAbsent: s.examMarks[0]?.isAbsent ?? false,
        entryId: s.examMarks[0]?.id ?? null,
      })),
    };
  }

  async saveMarks(
    examClassSubjectId: string,
    data: SaveMarksData,
    enteredById: string,
    options?: { allowStatuses?: string[] },
  ) {
    const ecs = await prisma.examClassSubject.findUnique({
      where: { id: examClassSubjectId },
      include: {
        subject: { select: { name: true } },
        examClass: {
          include: { exam: { select: { id: true, name: true, status: true } } },
        },
      },
    });
    if (!ecs) throw { status: 404, message: 'Exam class subject not found' };
    if (!ecs.isActive) throw { status: 400, message: 'This subject is disabled. Enable it first.' };

    const exam = ecs.examClass.exam;
    const allowedStatuses = options?.allowStatuses ?? ['DRAFT'];
    if (!allowedStatuses.includes(exam.status)) {
      throw {
        status: 400,
        message: `Cannot edit marks: exam "${exam.name}" is ${exam.status}.`,
      };
    }

    const { totalMarks, passingMarks, entries } = data;

    // Determine effective ceiling
    let effectiveTotal = ecs.totalMarks;
    let effectivePassing = ecs.passingMarks;

    if (totalMarks !== undefined) {
      if (typeof totalMarks !== 'number' || totalMarks <= 0 || !Number.isInteger(totalMarks)) {
        throw { status: 400, message: 'Total marks must be a positive integer' };
      }
      effectiveTotal = totalMarks;

      if (passingMarks !== undefined) {
        if (typeof passingMarks !== 'number' || passingMarks < 0 || !Number.isInteger(passingMarks)) {
          throw { status: 400, message: 'Passing marks must be a non-negative integer' };
        }
        if (passingMarks > totalMarks) {
          throw { status: 400, message: 'Passing marks cannot exceed total marks' };
        }
        effectivePassing = passingMarks;
      }
    } else if (effectiveTotal === null) {
      throw { status: 400, message: 'Total marks not set. Provide totalMarks to configure the ceiling first.' };
    }

    if (!entries || !Array.isArray(entries) || entries.length === 0) {
      throw { status: 400, message: 'At least one student entry is required' };
    }

    // Validate each entry
    const errors: { studentId: string; field: string; message: string }[] = [];
    for (const entry of entries) {
      if (!entry.studentId) {
        errors.push({ studentId: '(missing)', field: 'studentId', message: 'Student ID is required' });
        continue;
      }

      if (entry.isAbsent && entry.marksObtained !== null && entry.marksObtained !== undefined) {
        errors.push({ studentId: entry.studentId, field: 'marksObtained', message: 'Cannot set marks for an absent student' });
      }

      if (!entry.isAbsent && entry.marksObtained !== null && entry.marksObtained !== undefined) {
        if (typeof entry.marksObtained !== 'number' || entry.marksObtained < 0) {
          errors.push({ studentId: entry.studentId, field: 'marksObtained', message: 'Marks cannot be negative' });
        } else if (entry.marksObtained > effectiveTotal!) {
          errors.push({ studentId: entry.studentId, field: 'marksObtained', message: `Marks (${entry.marksObtained}) exceed total marks (${effectiveTotal})` });
        }
      }
    }

    if (errors.length > 0) {
      throw { status: 400, message: 'Validation failed', errors };
    }

    // Persist ceiling + entries in a transaction
    await basePrisma.$transaction(async (tx) => {
      // Update ceiling if provided
      if (totalMarks !== undefined) {
        await tx.examClassSubject.update({
          where: { id: examClassSubjectId },
          data: { totalMarks: effectiveTotal, passingMarks: effectivePassing ?? null },
        });
      }

      // Upsert each MarksEntry
      for (const entry of entries) {
        const marksObtained = entry.isAbsent ? null : (entry.marksObtained ?? null);

        await tx.marksEntry.upsert({
          where: {
            examClassSubjectId_studentId: {
              examClassSubjectId,
              studentId: entry.studentId,
            },
          },
          create: {
            examClassSubjectId,
            studentId: entry.studentId,
            marksObtained,
            isAbsent: entry.isAbsent ?? false,
            enteredBy: enteredById,
            createdById: enteredById,
            updatedById: enteredById,
          },
          update: {
            marksObtained,
            isAbsent: entry.isAbsent ?? false,
            enteredBy: enteredById,
            updatedById: enteredById,
          },
        });
      }
    });

    await logAudit({
      action: 'CREATE',
      module: 'exams',
      entityType: 'MarksEntry',
      entityId: examClassSubjectId,
      metadata: {
        studentCount: entries.length,
        examClassSubjectId,
        examId: exam.id,
        examName: exam.name,
      },
    });

    const examName = exam.name;
    const subjectName = ecs.subject.name;
    const totalForNotify = effectiveTotal!;

    for (const entry of entries) {
      const savedEntry = await prisma.marksEntry.findUnique({
        where: {
          examClassSubjectId_studentId: {
            examClassSubjectId,
            studentId: entry.studentId,
          },
        },
        select: { id: true },
      });
      if (!savedEntry) continue;

      if (entry.isAbsent) {
        void notifyMarksAbsent({
          studentId: entry.studentId,
          examClassSubjectId,
          marksEntryId: savedEntry.id,
          examName,
          subjectName,
        }).catch(() => undefined);
      } else if (entry.marksObtained != null) {
        void notifyMarksEntered({
          studentId: entry.studentId,
          examClassSubjectId,
          marksEntryId: savedEntry.id,
          examName,
          subjectName,
          marksObtained: entry.marksObtained,
          totalMarks: totalForNotify,
        }).catch(() => undefined);
      }
    }

    // Return updated grid
    return this.getMarksGrid(examClassSubjectId);
  }

  async getEntryForScopeCheck(id: string) {
    return prisma.marksEntry.findUnique({
      where: { id },
      select: { examClassSubjectId: true },
    });
  }

  async deleteMarksEntry(id: string) {
    const entry = await prisma.marksEntry.findUnique({
      where: { id },
      include: {
        examClassSubject: {
          select: {
            isActive: true,
            examClass: {
              select: { exam: { select: { id: true, name: true, status: true } } },
            },
          },
        },
      },
    });
    if (!entry) throw { status: 404, message: 'Marks entry not found' };

    const exam = entry.examClassSubject.examClass.exam;
    if (exam.status !== 'DRAFT') {
      throw { status: 400, message: `Cannot delete marks: exam "${exam.name}" is ${exam.status}. Only DRAFT exams can be edited.` };
    }

    await prisma.marksEntry.delete({ where: { id } });

    await logAudit({
      action: 'DELETE',
      module: 'exams',
      entityType: 'MarksEntry',
      entityId: id,
      oldValue: { studentId: entry.studentId, marksObtained: entry.marksObtained, examClassSubjectId: entry.examClassSubjectId },
    });

    return { message: 'Marks entry deleted' };
  }
}

export const marksEntryService = new MarksEntryService();
