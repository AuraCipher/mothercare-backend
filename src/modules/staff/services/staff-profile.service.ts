import { prisma } from '../../../lib/prisma';

export async function getStaffSelfProfile(userId: string, branchId: string) {
  const membership = await prisma.branchMember.findFirst({
    where: { userId, branchId, isActive: true },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          username: true,
          phone: true,
          profilePhotoId: true,
          createdAt: true,
        },
      },
      branch: { select: { id: true, name: true, code: true } },
    },
  });
  if (!membership) {
    throw { status: 404, message: 'Branch membership not found' };
  }

  const staffProfile = await prisma.staffProfile.findUnique({
    where: { userId },
    select: {
      employeeId: true,
      workRole: true,
      qualification: true,
      specialization: true,
      joiningDate: true,
      phone: true,
      emergencyContact: true,
      address: true,
      dateOfBirth: true,
      gender: true,
      bloodGroup: true,
      bio: true,
    },
  });

  return {
    userId: membership.user.id,
    name: membership.user.name,
    email: membership.user.email,
    username: membership.user.username,
    phone: membership.user.phone ?? staffProfile?.phone ?? null,
    role: membership.role,
    branch: membership.branch,
    memberSince: membership.createdAt,
    profile: staffProfile,
  };
}
