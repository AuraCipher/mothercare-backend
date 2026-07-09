import { prisma } from '../../../lib/prisma';
import type { StudentContext } from './student-context.service';

export interface StudentTimetableSlot {
  lectureNumber: number;
  startTime: string;
  endTime: string;
  dayOfWeek: number | null;
  subject: { id: string; name: string; code: string | null } | null;
  teacher: { id: string; name: string } | null;
  note: string | null;
}

export async function getStudentTimetable(ctx: StudentContext) {
  if (!ctx.groupId) {
    return { timetableName: 'Class Timetable', slots: [] as StudentTimetableSlot[] };
  }

  const timetable = await prisma.timetable.findFirst({
    where: { academicYearId: ctx.academicYearId, type: 'timetable', isActive: true },
    select: { id: true, name: true },
  });

  if (!timetable) {
    return { timetableName: 'Class Timetable', slots: [] as StudentTimetableSlot[] };
  }

  const entries = await prisma.timetableEntry.findMany({
    where: {
      groupId: ctx.groupId,
      slot: { timetableId: timetable.id, isActive: true },
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

  const slots: StudentTimetableSlot[] = entries
    .filter((e) => e.note !== 'break')
    .map((entry) => ({
      lectureNumber: entry.slot.lectureNumber,
      startTime: entry.slot.startTime,
      endTime: entry.slot.endTime,
      dayOfWeek: entry.slot.dayOfWeek,
      subject: entry.subject,
      teacher: entry.teacher,
      note: entry.note,
    }));

  return { timetableName: timetable.name, groupLabel: ctx.groupLabel, slots };
}

/** Periods for the current weekday (0=Sun … 6=Sat). */
export function filterTimetableForToday(
  slots: StudentTimetableSlot[],
  now = new Date(),
): StudentTimetableSlot[] {
  const day = now.getDay();
  return slots.filter((slot) => slot.dayOfWeek == null || slot.dayOfWeek === day);
}
