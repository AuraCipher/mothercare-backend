import { prisma } from '../../../lib/prisma';
import type { TeacherContext } from './teacher-context.service';
import { assertTeacherAssignedToGroup } from '../utils/teacher-assignment.guard';
import {
  canViewParentContactsForGroup,
  loadParentContactsForStudents,
} from '../utils/teacher-parent-contact.guard';

function todayDateString(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function parseDate(date: string): Date {
  return new Date(`${date}T00:00:00`);
}

async function computeAttendanceRate30d(
  academicYearId: string,
  studentIds: string[],
): Promise<number | null> {
  if (studentIds.length === 0) return null;

  const end = new Date();
  end.setHours(0, 0, 0, 0);
  const start = new Date(end);
  start.setDate(start.getDate() - 30);

  const rows = await prisma.attendance.findMany({
    where: {
      academicYearId,
      studentId: { in: studentIds },
      date: { gte: start, lte: end },
      status: { in: ['present', 'absent', 'late', 'leave', 'function'] },
    },
    select: { status: true },
  });

  if (rows.length === 0) return null;
  const presentLike = rows.filter((r) =>
    ['present', 'late', 'function'].includes(r.status),
  ).length;
  return Math.round((presentLike / rows.length) * 100);
}

export async function getClassStudents(ctx: TeacherContext, groupId: string) {
  assertTeacherAssignedToGroup(ctx, groupId);

  const group = await prisma.group.findFirst({
    where: { id: groupId, academicYearId: ctx.academicYearId },
    select: { id: true, name: true, section: true },
  });
  if (!group) {
    throw { status: 404, message: 'Class not found' };
  }

  const todayStr = todayDateString();
  const todayObj = parseDate(todayStr);

  const students = await prisma.student.findMany({
    where: {
      groupId,
      academicYearId: ctx.academicYearId,
      isActive: true,
      status: 'ACTIVE',
    },
    select: {
      id: true,
      name: true,
      rollNumber: true,
      admissionNumber: true,
      gender: true,
      attendances: {
        where: {
          academicYearId: ctx.academicYearId,
          date: todayObj,
        },
        select: { status: true },
        take: 1,
      },
    },
    orderBy: [{ rollNumber: 'asc' }, { name: 'asc' }],
  });

  const isClassTeacher = ctx.classTeacherGroupIds.includes(groupId);
  const showParentContacts = await canViewParentContactsForGroup(ctx, groupId);
  const parentContactsByStudent = showParentContacts
    ? await loadParentContactsForStudents(students.map((s) => s.id))
    : null;

  const studentIds = students.map((s) => s.id);
  const rate30d = await computeAttendanceRate30d(ctx.academicYearId, studentIds);

  let presentToday = 0;
  let absentToday = 0;
  let lateToday = 0;
  let markedToday = 0;

  const mappedStudents = students.map((s) => {
    const todayStatus = s.attendances[0]?.status ?? null;
    if (todayStatus) {
      markedToday += 1;
      if (todayStatus === 'present' || todayStatus === 'function') presentToday += 1;
      else if (todayStatus === 'absent') absentToday += 1;
      else if (todayStatus === 'late') lateToday += 1;
    }
    return {
      id: s.id,
      name: s.name,
      rollNumber: s.rollNumber,
      admissionNumber: s.admissionNumber,
      gender: s.gender,
      todayAttendance: todayStatus,
      parentContacts: showParentContacts
        ? parentContactsByStudent?.get(s.id) ?? []
        : undefined,
    };
  });

  return {
    group,
    isClassTeacher,
    showParentContacts,
    attendanceSummary: {
      date: todayStr,
      studentCount: students.length,
      markedToday,
      presentToday,
      absentToday,
      lateToday,
      attendanceRate30d: rate30d,
    },
    students: mappedStudents,
    total: students.length,
  };
}
