import { prisma } from '../../../lib/prisma';
import { marksEntryService } from '../../admin/services/marks-entry.service';
import type { TeacherContext } from './teacher-context.service';
import {
  assertTeacherAssignedToSubject,
  TeacherAccessError,
} from '../utils/teacher-assignment.guard';

async function getExamClassSubjectForTeacher(ctx: TeacherContext, examClassSubjectId: string) {
  const ecs = await prisma.examClassSubject.findFirst({
    where: {
      id: examClassSubjectId,
      examClass: {
        exam: {
          examSession: {
            academicYearId: ctx.academicYearId,
            academicYear: { branchId: ctx.branchId },
          },
        },
      },
    },
    include: {
      examClass: {
        include: {
          class: { select: { id: true, name: true, section: true } },
          exam: {
            select: {
              id: true,
              name: true,
              status: true,
              teacherMarksEntry: true,
              examSessionId: true,
              examSession: { select: { id: true, name: true } },
              examType: { select: { name: true } },
            },
          },
        },
      },
      subject: { select: { id: true, name: true, code: true } },
      _count: { select: { marksEntries: true } },
    },
  });

  if (!ecs) {
    throw { status: 404, message: 'Exam subject not found' };
  }

  try {
    assertTeacherAssignedToSubject(ctx, ecs.examClass.class.id, ecs.subject.id);
  } catch (err) {
    if (err instanceof TeacherAccessError) throw err;
    throw err;
  }

  return ecs;
}

async function isMarksLockedByPublishedReportCards(examSessionId: string, groupId: string) {
  const count = await prisma.reportCard.count({
    where: {
      examSessionId,
      status: 'PUBLISHED',
      student: { groupId, isActive: true },
    },
  });
  return count > 0;
}

function resolveTeacherMarksAccess(
  ctx: TeacherContext,
  exam: { status: string; teacherMarksEntry: boolean },
  lockedByReportCards: boolean,
) {
  if (ctx.isReadOnly) {
    return { canWrite: false, restrictReason: 'READ_ONLY_YEAR' as const };
  }
  if (lockedByReportCards) {
    return { canWrite: false, restrictReason: 'REPORT_CARDS_PUBLISHED' as const };
  }
  if (exam.status === 'ACTIVE') {
    return { canWrite: false, restrictReason: 'EXAM_ACTIVE' as const };
  }
  if (exam.status !== 'DRAFT') {
    return { canWrite: false, restrictReason: 'EXAM_NOT_DRAFT' as const };
  }
  if (!exam.teacherMarksEntry) {
    return { canWrite: false, restrictReason: 'ADMIN_RESTRICTED' as const };
  }
  return { canWrite: true, restrictReason: null };
}

export async function listTeacherExamSubjects(ctx: TeacherContext) {
  if (ctx.assignments.length === 0) return [];

  const rows = await prisma.examClassSubject.findMany({
    where: {
      isActive: true,
      OR: ctx.assignments.map((a) => ({
        subjectId: a.subjectId,
        examClass: {
          classId: a.groupId,
          exam: {
            examSession: { academicYearId: ctx.academicYearId },
          },
        },
      })),
    },
    include: {
      subject: { select: { id: true, name: true, code: true } },
      examClass: {
        include: {
          class: { select: { id: true, name: true, section: true } },
          exam: {
            select: {
              id: true,
              name: true,
              status: true,
              teacherMarksEntry: true,
              startDate: true,
              endDate: true,
              examSession: { select: { id: true, name: true } },
              examType: { select: { name: true } },
            },
          },
        },
      },
      _count: { select: { marksEntries: true } },
    },
    orderBy: [
      { examClass: { exam: { startDate: 'desc' } } },
      { subject: { name: 'asc' } },
    ],
  });

  const enriched = await Promise.all(
    rows.map(async (row) => {
      const locked = await isMarksLockedByPublishedReportCards(
        row.examClass.exam.examSession.id,
        row.examClass.class.id,
      );
      const access = resolveTeacherMarksAccess(ctx, row.examClass.exam, locked);

      return {
        examClassSubjectId: row.id,
        totalMarks: row.totalMarks,
        passingMarks: row.passingMarks,
        marksEntryCount: row._count.marksEntries,
        subject: row.subject,
        group: row.examClass.class,
        exam: {
          id: row.examClass.exam.id,
          name: row.examClass.exam.name,
          status: row.examClass.exam.status,
          teacherMarksEntry: row.examClass.exam.teacherMarksEntry,
          startDate: row.examClass.exam.startDate,
          endDate: row.examClass.exam.endDate,
          examType: row.examClass.exam.examType.name,
        },
        session: row.examClass.exam.examSession,
        locked: locked || !access.canWrite,
        canWrite: access.canWrite,
        restrictReason: access.restrictReason,
      };
    }),
  );

  return enriched;
}

export async function getTeacherMarksGrid(ctx: TeacherContext, examClassSubjectId: string) {
  await getExamClassSubjectForTeacher(ctx, examClassSubjectId);
  const grid = await marksEntryService.getMarksGrid(examClassSubjectId);
  const ecs = await prisma.examClassSubject.findUnique({
    where: { id: examClassSubjectId },
    select: {
      examClass: {
        select: {
          classId: true,
          exam: { select: { examSessionId: true, status: true, teacherMarksEntry: true } },
        },
      },
    },
  });
  const locked = ecs
    ? await isMarksLockedByPublishedReportCards(
        ecs.examClass.exam.examSessionId,
        ecs.examClass.classId,
      )
    : false;
  const access = ecs
    ? resolveTeacherMarksAccess(ctx, ecs.examClass.exam, locked)
    : { canWrite: false, restrictReason: 'EXAM_NOT_DRAFT' as const };

  return {
    ...grid,
    locked: locked || !access.canWrite,
    canWrite: access.canWrite,
    restrictReason: access.restrictReason,
  };
}

export async function saveTeacherMarks(
  ctx: TeacherContext,
  examClassSubjectId: string,
  data: {
    totalMarks?: number;
    passingMarks?: number;
    entries: Array<{ studentId: string; marksObtained?: number | null; isAbsent?: boolean }>;
  },
  enteredById: string,
) {
  const ecs = await getExamClassSubjectForTeacher(ctx, examClassSubjectId);

  const locked = await isMarksLockedByPublishedReportCards(
    ecs.examClass.exam.examSessionId,
    ecs.examClass.class.id,
  );
  const access = resolveTeacherMarksAccess(ctx, ecs.examClass.exam, locked);
  if (!access.canWrite) {
    if (access.restrictReason === 'REPORT_CARDS_PUBLISHED') {
      throw { status: 403, message: 'Marks are locked after report cards are published.' };
    }
    if (access.restrictReason === 'EXAM_ACTIVE') {
      throw { status: 403, message: 'Marks are locked while the exam is Active. Admin must set the exam to Draft (build stage) for teacher entry.' };
    }
    if (access.restrictReason === 'ADMIN_RESTRICTED') {
      throw { status: 403, message: 'Teacher marks entry is disabled for this exam by administration.' };
    }
    throw { status: 403, message: 'Marks cannot be edited for this exam.' };
  }

  return marksEntryService.saveMarks(examClassSubjectId, data, enteredById, {
    allowStatuses: ['DRAFT'],
  });
}
