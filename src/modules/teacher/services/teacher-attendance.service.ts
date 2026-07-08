import { prisma } from '../../../lib/prisma';
import {
  assertStudentsInScope,
  validateAttendanceDate,
} from '../../admin/utils/attendance-scope';
import type { TeacherContext } from './teacher-context.service';
import { assertTeacherAssignedToGroup } from '../utils/teacher-assignment.guard';
import {
  teacherCanMarkAttendanceToday,
  validateTeacherAttendanceDate,
} from '../utils/teacher-attendance.guard';

function parseAttendanceDate(date: string): Date {
  const dateObj = new Date(`${date}T00:00:00`);
  if (Number.isNaN(dateObj.getTime())) {
    throw { status: 400, message: 'Invalid date' };
  }
  return dateObj;
}

export async function getGroupAttendance(
  ctx: TeacherContext,
  groupId: string,
  date: string,
) {
  assertTeacherAssignedToGroup(ctx, groupId);
  const dateObj = parseAttendanceDate(date);

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
      attendances: {
        where: {
          academicYearId: ctx.academicYearId,
          date: dateObj,
        },
        select: { status: true, note: true },
        take: 1,
      },
    },
    orderBy: [{ rollNumber: 'asc' }, { name: 'asc' }],
  });

  return {
    date,
    groupId,
    isClassTeacher: ctx.classTeacherGroupIds.includes(groupId),
    canMarkToday: teacherCanMarkAttendanceToday(),
    records: students.map((s) => ({
      studentId: s.id,
      name: s.name,
      rollNumber: s.rollNumber,
      admissionNumber: s.admissionNumber,
      status: s.attendances[0]?.status ?? null,
      note: s.attendances[0]?.note ?? null,
    })),
    total: students.length,
  };
}

export async function saveGroupAttendanceBatch(
  ctx: TeacherContext,
  groupId: string,
  date: string,
  records: Array<{ studentId: string; status: string; note?: string | null }>,
  markedById: string,
) {
  assertTeacherAssignedToGroup(ctx, groupId);

  if (!ctx.branch.teachersCanMarkAttendance) {
    throw { status: 403, message: 'Attendance marking is disabled for teachers at this branch' };
  }

  if (!records?.length) {
    throw { status: 400, message: 'records[] is required' };
  }

  const dateObj = parseAttendanceDate(date);
  const teacherDateErr = validateTeacherAttendanceDate(date);
  if (teacherDateErr) {
    throw { status: 400, message: teacherDateErr };
  }
  const dateErr = await validateAttendanceDate(ctx.academicYearId, dateObj);
  if (dateErr) {
    throw { status: 400, message: dateErr };
  }

  const studentIds = records.map((r) => r.studentId).filter(Boolean);
  const scopeErr = await assertStudentsInScope(studentIds, groupId, {
    academicYearId: ctx.academicYearId,
    branchId: ctx.branchId,
    academicYearStatus: ctx.academicYearStatus,
    isArchived: ctx.academicYearStatus === 'ARCHIVED',
  });
  if (scopeErr) {
    throw { status: 400, message: scopeErr };
  }

  let saved = 0;
  for (const record of records) {
    if (!record.studentId || !record.status) continue;
    await prisma.attendance.upsert({
      where: { studentId_date: { studentId: record.studentId, date: dateObj } },
      update: {
        status: record.status,
        markedById,
        note: record.note ?? null,
      },
      create: {
        studentId: record.studentId,
        academicYearId: ctx.academicYearId,
        date: dateObj,
        status: record.status,
        note: record.note ?? null,
        markedById,
      },
    });
    saved++;
  }

  return { saved, total: records.length };
}
