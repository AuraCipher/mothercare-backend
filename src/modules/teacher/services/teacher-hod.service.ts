import { prisma } from '../../../lib/prisma';
import type { TeacherContext } from './teacher-context.service';

export async function getHodDepartmentOverview(ctx: TeacherContext) {
  if (!ctx.isHod) {
    return { subjects: [], totalExamSubjects: 0 };
  }

  const subjects = await prisma.subject.findMany({
    where: { id: { in: ctx.hodSubjectIds }, academicYearId: ctx.academicYearId },
    select: {
      id: true,
      name: true,
      code: true,
      _count: {
        select: {
          teacherAssignments: true,
          examClassSubjects: { where: { isActive: true } },
        },
      },
    },
    orderBy: { name: 'asc' },
  });

  return {
    subjects: subjects.map((s) => ({
      id: s.id,
      name: s.name,
      code: s.code,
      teacherCount: s._count.teacherAssignments,
      examSubjectCount: s._count.examClassSubjects,
    })),
    totalExamSubjects: subjects.reduce((n, s) => n + s._count.examClassSubjects, 0),
  };
}

export async function listHodExamSubjects(ctx: TeacherContext) {
  if (!ctx.isHod || ctx.hodSubjectIds.length === 0) return [];

  const rows = await prisma.examClassSubject.findMany({
    where: {
      isActive: true,
      subjectId: { in: ctx.hodSubjectIds },
      examClass: {
        exam: {
          examSession: { academicYearId: ctx.academicYearId },
        },
      },
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
      { examClass: { class: { displayOrder: 'asc' } } },
    ],
  });

  return rows.map((ecs) => ({
    id: ecs.id,
    subject: ecs.subject,
    group: ecs.examClass.class,
    exam: {
      id: ecs.examClass.exam.id,
      name: ecs.examClass.exam.name,
      status: ecs.examClass.exam.status,
      teacherMarksEntry: ecs.examClass.exam.teacherMarksEntry,
      startDate: ecs.examClass.exam.startDate,
      endDate: ecs.examClass.exam.endDate,
      sessionName: ecs.examClass.exam.examSession.name,
      examTypeName: ecs.examClass.exam.examType?.name ?? null,
    },
    marksEntryCount: ecs._count.marksEntries,
    isHodView: true,
    isDirectAssignment: ctx.assignments.some(
      (a) => a.groupId === ecs.examClass.class.id && a.subjectId === ecs.subjectId,
    ),
  }));
}
