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
      emergencyContact: true,
      address: true,
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
    emergencyContact: profile.emergencyContact,
    address: profile.address,
    joiningDate: profile.joiningDate,
    user: profile.user,
  };
}

export interface UpdateTeacherProfileInput {
  phone?: string | null;
  emergencyContact?: string | null;
  address?: string | null;
}

export async function updateTeacherProfile(userId: string, data: UpdateTeacherProfileInput) {
  const existing = await prisma.teacherProfile.findUnique({ where: { userId } });
  if (!existing) throw { status: 404, message: 'Teacher profile not found' };

  return prisma.teacherProfile.update({
    where: { userId },
    data: {
      ...(data.phone !== undefined && { phone: data.phone || null }),
      ...(data.emergencyContact !== undefined && { emergencyContact: data.emergencyContact || null }),
      ...(data.address !== undefined && { address: data.address || null }),
    },
    select: {
      id: true,
      employeeId: true,
      qualification: true,
      specialization: true,
      phone: true,
      emergencyContact: true,
      address: true,
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
}
