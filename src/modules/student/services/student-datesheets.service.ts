import { prisma } from '../../../lib/prisma';
import type { StudentContext } from './student-context.service';

export interface StudentDatesheetEntry {
  lectureNumber: number;
  startTime: string;
  endTime: string;
  dayOfWeek: number | null;
  subject: { id: string; name: string; code: string | null } | null;
  teacher: { id: string; name: string } | null;
  note: string | null;
}

export interface StudentDatesheet {
  id: string;
  name: string;
  entries: StudentDatesheetEntry[];
}

/** All active datesheets for the academic year with this class's entries. */
export async function listStudentDatesheets(ctx: StudentContext): Promise<StudentDatesheet[]> {
  const datesheets = await prisma.timetable.findMany({
    where: { academicYearId: ctx.academicYearId, type: 'datesheet', isActive: true },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });

  if (!ctx.groupId || datesheets.length === 0) {
    return datesheets.map((ds) => ({ id: ds.id, name: ds.name, entries: [] }));
  }

  const results: StudentDatesheet[] = [];

  for (const ds of datesheets) {
    const entries = await prisma.timetableEntry.findMany({
      where: {
        groupId: ctx.groupId,
        slot: { timetableId: ds.id, isActive: true },
      },
      include: {
        slot: {
          select: { lectureNumber: true, startTime: true, endTime: true, dayOfWeek: true },
        },
        subject: { select: { id: true, name: true, code: true } },
        teacher: { select: { id: true, name: true } },
      },
      orderBy: [
        { slot: { dayOfWeek: 'asc' } },
        { slot: { lectureNumber: 'asc' } },
      ],
    });

    results.push({
      id: ds.id,
      name: ds.name,
      entries: entries
        .filter((e) => e.note !== 'break')
        .map((entry) => ({
          lectureNumber: entry.slot.lectureNumber,
          startTime: entry.slot.startTime,
          endTime: entry.slot.endTime,
          dayOfWeek: entry.slot.dayOfWeek,
          subject: entry.subject,
          teacher: entry.teacher,
          note: entry.note,
        })),
    });
  }

  return results;
}
