import { prisma } from '../../../lib/prisma';
import type { TeacherContext } from './teacher-context.service';

export interface MarksTableFilters {
  sessionId?: string;
  examTypeId?: string;
  subjectId?: string;
  studentId?: string;
}

function formatGroupLabel(group: { name: string; section: string | null }) {
  return group.section ? `${group.name} — ${group.section}` : group.name;
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

export async function listTeacherMarksTable(ctx: TeacherContext, filters: MarksTableFilters = {}) {
  if (ctx.assignments.length === 0) {
    return { filters: { sessions: [], examTypes: [], subjects: [], students: [] }, rows: [] };
  }

  const entries = await prisma.marksEntry.findMany({
    where: {
      examClassSubject: {
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
    },
    select: {
      id: true,
      marksObtained: true,
      isAbsent: true,
      student: {
        select: { id: true, name: true, rollNumber: true },
      },
      examClassSubject: {
        select: {
          id: true,
          totalMarks: true,
          passingMarks: true,
          subject: { select: { id: true, name: true, code: true } },
          examClass: {
            select: {
              class: { select: { id: true, name: true, section: true } },
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
      { student: { rollNumber: 'asc' } },
      { student: { name: 'asc' } },
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
      studentId: e.student.id,
      studentName: e.student.name,
      rollNumber: e.student.rollNumber,
      sessionId: exam.examSession.id,
      sessionName: exam.examSession.name,
      examTypeId: exam.examType.id,
      examTypeName: exam.examType.name,
      examId: exam.id,
      examName: exam.name,
      subjectId: ecs.subject.id,
      subjectName: ecs.subject.name,
      subjectCode: ecs.subject.code,
      groupId: ecs.examClass.class.id,
      groupLabel: formatGroupLabel(ecs.examClass.class),
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
  const studentsMap = new Map<string, { name: string; rollNumber: string | null }>();

  for (const row of allRows) {
    sessionsMap.set(row.sessionId, row.sessionName);
    if (!filters.sessionId || filters.sessionId === 'all' || row.sessionId === filters.sessionId) {
      examTypesMap.set(row.examTypeId, row.examTypeName);
    }
    subjectsMap.set(row.subjectId, row.subjectName);
    studentsMap.set(row.studentId, { name: row.studentName, rollNumber: row.rollNumber });
  }

  const sessionFilter = filters.sessionId && filters.sessionId !== 'all' ? filters.sessionId : null;
  const examTypeFilter = filters.examTypeId && filters.examTypeId !== 'all' ? filters.examTypeId : null;
  const subjectFilter = filters.subjectId && filters.subjectId !== 'all' ? filters.subjectId : null;
  const studentFilter = filters.studentId && filters.studentId !== 'all' ? filters.studentId : null;

  const rows = allRows.filter((row) => {
    if (sessionFilter && row.sessionId !== sessionFilter) return false;
    if (examTypeFilter && row.examTypeId !== examTypeFilter) return false;
    if (subjectFilter && row.subjectId !== subjectFilter) return false;
    if (studentFilter && row.studentId !== studentFilter) return false;
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
      students: [...studentsMap.entries()]
        .map(([id, meta]) => ({
          id,
          name: meta.name,
          rollNumber: meta.rollNumber,
        }))
        .sort((a, b) => {
          const ar = a.rollNumber || '';
          const br = b.rollNumber || '';
          if (ar && br && ar !== br) return ar.localeCompare(br, undefined, { numeric: true });
          return a.name.localeCompare(b.name);
        }),
    },
    rows,
    total: rows.length,
  };
}
