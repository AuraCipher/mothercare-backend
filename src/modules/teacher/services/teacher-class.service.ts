import { prisma } from '../../../lib/prisma';
import type { TeacherContext } from './teacher-context.service';
import { assertTeacherAssignedToGroup } from '../utils/teacher-assignment.guard';

export async function getClassStudents(ctx: TeacherContext, groupId: string) {
  assertTeacherAssignedToGroup(ctx, groupId);

  const group = await prisma.group.findFirst({
    where: { id: groupId, academicYearId: ctx.academicYearId },
    select: { id: true, name: true, section: true },
  });
  if (!group) {
    throw { status: 404, message: 'Class not found' };
  }

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
    },
    orderBy: [{ rollNumber: 'asc' }, { name: 'asc' }],
  });

  const isClassTeacher = ctx.classTeacherGroupIds.includes(groupId);

  return { group, isClassTeacher, students, total: students.length };
}
