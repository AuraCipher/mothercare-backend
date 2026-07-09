import { prisma } from '../../../lib/prisma';
import type { StudentContext } from './student-context.service';

export interface StudentResultsFilters {
  sessionId?: string;
  examTypeId?: string;
  subjectId?: string;
}

function pct(marksObtained: number | null, isAbsent: boolean, totalMarks: number | null) {
  const total = totalMarks ?? 100;
  if (total <= 0) return null;
  const score = isAbsent ? 0 : (marksObtained ?? 0);
  return Math.round((score / total) * 1000) / 10;
}

function passed(
  marksObtained: number | null,
  isAbsent: boolean,
  totalMarks: number | null,
  passingMarks: number | null,
) {
  const total = totalMarks ?? 100;
  const passAt = passingMarks ?? Math.round(total * 0.4);
  const score = isAbsent ? 0 : (marksObtained ?? 0);
  return score >= passAt;
}

/** Marks table for the logged-in student — published report cards only. */
export async function listStudentResultsTable(
  ctx: StudentContext,
  filters: StudentResultsFilters = {},
) {
  const published = await prisma.reportCard.findMany({
    where: { studentId: ctx.studentId, status: 'PUBLISHED' },
    select: { examSessionId: true },
  });
  const publishedSessionIds = published.map((r) => r.examSessionId);

  if (publishedSessionIds.length === 0) {
    return {
      filters: { sessions: [], examTypes: [], subjects: [] },
      rows: [],
      total: 0,
    };
  }

  const entries = await prisma.marksEntry.findMany({
    where: {
      studentId: ctx.studentId,
      examClassSubject: {
        isActive: true,
        examClass: {
          classId: ctx.groupId ?? undefined,
          exam: {
            examSessionId: { in: publishedSessionIds },
            examSession: { academicYearId: ctx.academicYearId },
          },
        },
      },
    },
    select: {
      id: true,
      marksObtained: true,
      isAbsent: true,
      examClassSubject: {
        select: {
          id: true,
          totalMarks: true,
          passingMarks: true,
          subject: { select: { id: true, name: true, code: true } },
          examClass: {
            select: {
              exam: {
                select: {
                  id: true,
                  name: true,
                  examType: { select: { id: true, name: true } },
                  examSession: { select: { id: true, name: true } },
                },
              },
            },
          },
        },
      },
    },
    orderBy: [
      { examClassSubject: { examClass: { exam: { examSession: { startDate: 'desc' } } } } },
      { examClassSubject: { subject: { name: 'asc' } } },
    ],
  });

  const allRows = entries.map((e) => {
    const ecs = e.examClassSubject;
    const exam = ecs.examClass.exam;
    const total = ecs.totalMarks;
    const percentage = pct(e.marksObtained, e.isAbsent, total);
    return {
      marksEntryId: e.id,
      examClassSubjectId: ecs.id,
      sessionId: exam.examSession.id,
      sessionName: exam.examSession.name,
      examTypeId: exam.examType.id,
      examTypeName: exam.examType.name,
      examId: exam.id,
      examName: exam.name,
      subjectId: ecs.subject.id,
      subjectName: ecs.subject.name,
      subjectCode: ecs.subject.code,
      marksObtained: e.marksObtained,
      totalMarks: total,
      passingMarks: ecs.passingMarks,
      isAbsent: e.isAbsent,
      percentage,
      passed: passed(e.marksObtained, e.isAbsent, total, ecs.passingMarks),
      hasMarks: e.marksObtained != null || e.isAbsent,
    };
  });

  const sessionsMap = new Map<string, string>();
  const examTypesMap = new Map<string, string>();
  const subjectsMap = new Map<string, string>();

  for (const row of allRows) {
    sessionsMap.set(row.sessionId, row.sessionName);
    if (!filters.sessionId || filters.sessionId === 'all' || row.sessionId === filters.sessionId) {
      examTypesMap.set(row.examTypeId, row.examTypeName);
    }
    subjectsMap.set(row.subjectId, row.subjectName);
  }

  const sessionFilter = filters.sessionId && filters.sessionId !== 'all' ? filters.sessionId : null;
  const examTypeFilter = filters.examTypeId && filters.examTypeId !== 'all' ? filters.examTypeId : null;
  const subjectFilter = filters.subjectId && filters.subjectId !== 'all' ? filters.subjectId : null;

  const rows = allRows.filter((row) => {
    if (sessionFilter && row.sessionId !== sessionFilter) return false;
    if (examTypeFilter && row.examTypeId !== examTypeFilter) return false;
    if (subjectFilter && row.subjectId !== subjectFilter) return false;
    return true;
  });

  const examTypesForSession = sessionFilter
    ? allRows.filter((r) => r.sessionId === sessionFilter)
    : allRows;
  const examTypesMapScoped = new Map<string, string>();
  for (const row of examTypesForSession) {
    examTypesMapScoped.set(row.examTypeId, row.examTypeName);
  }

  return {
    filters: {
      sessions: [...sessionsMap.entries()]
        .map(([id, name]) => ({ id, name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      examTypes: [...examTypesMapScoped.entries()]
        .map(([id, name]) => ({ id, name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      subjects: [...subjectsMap.entries()]
        .map(([id, name]) => ({ id, name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    },
    rows,
    total: rows.length,
  };
}
