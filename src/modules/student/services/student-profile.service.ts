import { prisma } from '../../../lib/prisma';
import type { StudentContext } from './student-context.service';

export async function getStudentProfile(ctx: StudentContext) {
  const student = await prisma.student.findUnique({
    where: { id: ctx.studentId },
    select: {
      id: true,
      name: true,
      rollNumber: true,
      admissionDate: true,
      group: { select: { id: true, name: true, section: true } },
      academicYear: {
        select: {
          id: true,
          status: true,
          calendar: { select: { label: true } },
        },
      },
      user: { select: { email: true, username: true, profilePhotoId: true } },
    },
  });
  if (!student) {
    throw { status: 404, message: 'Student not found' };
  }
  return {
    id: student.id,
    name: student.name,
    rollNumber: student.rollNumber,
    admissionDate: student.admissionDate,
    group: student.group
      ? {
          id: student.group.id,
          label: student.group.section
            ? `${student.group.name} — ${student.group.section}`
            : student.group.name,
        }
      : null,
    academicYear: {
      id: student.academicYear.id,
      label: student.academicYear.calendar?.label || student.academicYear.id,
      status: student.academicYear.status,
    },
    email: student.user?.email ?? null,
    username: student.user?.username ?? null,
    profilePhotoId: student.user?.profilePhotoId ?? null,
  };
}
