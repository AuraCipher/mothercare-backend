import { prisma } from '../../../lib/prisma';

export interface TeacherTimetableSlot {
  lectureNumber: number;
  startTime: string;
  endTime: string;
  activeDays: number[];
  group: { id: string; name: string; section: string | null };
  subject: { id: string; name: string; code: string | null } | null;
  note: string | null;
}

export async function getTeacherTimetable(
  teacherUserId: string,
  academicYearId: string,
): Promise<{ timetableName: string; slots: TeacherTimetableSlot[] }> {
  const timetable = await prisma.timetable.findFirst({
    where: { academicYearId, type: 'timetable', isActive: true },
    select: {
      id: true,
      name: true,
      dayConfigs: { where: { isActive: true }, select: { dayOfWeek: true } },
    },
  });

  if (!timetable) {
    return { timetableName: 'Regular Timetable', slots: [] };
  }

  const activeDays = timetable.dayConfigs.map((d) => d.dayOfWeek).sort((a, b) => a - b);

  const entries = await prisma.timetableEntry.findMany({
    where: {
      teacherId: teacherUserId,
      group: { academicYearId },
      slot: { timetableId: timetable.id, isActive: true },
    },
    include: {
      slot: {
        select: { lectureNumber: true, startTime: true, endTime: true, dayOfWeek: true },
      },
      subject: { select: { id: true, name: true, code: true } },
      group: { select: { id: true, name: true, section: true } },
    },
    orderBy: [{ slot: { lectureNumber: 'asc' } }],
  });

  const slots: TeacherTimetableSlot[] = entries
    .filter((e) => e.note !== 'break')
    .map((entry) => ({
      lectureNumber: entry.slot.lectureNumber,
      startTime: entry.slot.startTime,
      endTime: entry.slot.endTime,
      activeDays: entry.slot.dayOfWeek != null ? [entry.slot.dayOfWeek] : activeDays,
      group: entry.group,
      subject: entry.subject,
      note: entry.note,
    }));

  return { timetableName: timetable.name, slots };
}

/** Periods scheduled for the current weekday (0=Sun … 6=Sat). */
export function filterTimetableForToday(
  slots: TeacherTimetableSlot[],
  now = new Date(),
): TeacherTimetableSlot[] {
  const day = now.getDay();
  return slots.filter((slot) => slot.activeDays.includes(day));
}
