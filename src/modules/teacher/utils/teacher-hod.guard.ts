import { prisma } from '../../../lib/prisma';
import type { TeacherContext } from '../services/teacher-context.service';
import { TeacherAccessError } from './teacher-assignment.guard';

/** Subject IDs where this teacher is HOD (subject.hodId or assignment role=hod). */
export async function resolveHodSubjectIds(
  userId: string,
  academicYearId: string,
  assignments: TeacherContext['assignments'],
): Promise<string[]> {
  const fromSubject = await prisma.subject.findMany({
    where: { academicYearId, hodId: userId },
    select: { id: true },
  });
  const fromAssignment = assignments
    .filter((a) => a.role === 'hod')
    .map((a) => a.subjectId);
  return [...new Set([...fromSubject.map((s) => s.id), ...fromAssignment])];
}

export function assertTeacherHodOrAssignedToSubject(
  ctx: TeacherContext,
  groupId: string,
  subjectId: string,
): void {
  const assigned = ctx.assignments.some(
    (a) => a.groupId === groupId && a.subjectId === subjectId,
  );
  if (assigned) return;
  if (ctx.hodSubjectIds.includes(subjectId)) return;
  throw new TeacherAccessError(403, 'Access denied: you are not assigned to this subject');
}
