import { prisma } from '../../../lib/prisma';

export async function getTeacherProfile(userId: string) {
  const profile = await prisma.teacherProfile.findUnique({
    where: { userId },
    select: {
      id: true,
      employeeId: true,
      qualification: true,
      specialization: true,
      phone: true,
      joiningDate: true,
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          username: true,
          profilePhotoId: true,
        },
      },
    },
  });

  if (!profile) {
    throw { status: 404, message: 'Teacher profile not found' };
  }

  return {
    id: profile.id,
    employeeId: profile.employeeId,
    qualification: profile.qualification,
    specialization: profile.specialization,
    phone: profile.phone,
    joiningDate: profile.joiningDate,
    user: profile.user,
  };
}
