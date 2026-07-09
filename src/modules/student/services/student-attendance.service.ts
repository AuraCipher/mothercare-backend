import { prisma } from '../../../lib/prisma';
import type { StudentContext } from './student-context.service';

export interface StudentAttendanceQuery {
  from?: string;
  to?: string;
}

export async function getStudentAttendance(ctx: StudentContext, query: StudentAttendanceQuery = {}) {
  const where: { studentId: string; academicYearId: string; date?: { gte?: Date; lte?: Date } } = {
    studentId: ctx.studentId,
    academicYearId: ctx.academicYearId,
  };
  if (query.from) where.date = { ...where.date, gte: new Date(query.from) };
  if (query.to) where.date = { ...where.date, lte: new Date(query.to) };

  const records = await prisma.attendance.findMany({
    where,
    orderBy: { date: 'desc' },
    select: { date: true, status: true, note: true },
  });

  const present = records.filter((r) => r.status === 'present').length;
  const absent = records.filter((r) => r.status === 'absent').length;
  const late = records.filter((r) => r.status === 'late').length;
  const total = records.length;

  return {
    records,
    summary: {
      present,
      absent,
      late,
      total,
      percentage: total ? Math.round((present / total) * 100) : 0,
    },
  };
}
