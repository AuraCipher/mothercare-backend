import { prisma } from '../../../lib/prisma';
import { storage } from '../../upload/storage.service';

// ═══════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════

export interface CreateTeacherProfileInput {
  userId?: string;
  name?: string;       // For auto-creating User
  username?: string;   // For auto-creating User
  password?: string;   // For auto-creating User
  email?: string;      // For auto-creating User
  branchId?: string;   // Add teacher as branch member (for stats)
  employeeId?: string;
  qualification?: string;
  specialization?: string;
  joiningDate?: string;
  salary?: number;
  phone?: string;
  emergencyContact?: string;
  address?: string;
  dateOfBirth?: string;
  gender?: 'male' | 'female' | 'other';
  bloodGroup?: string;
  fatherName?: string;
  cardId?: string;
  severeDisease?: string;
  experience?: string;
  bio?: string;
  profilePhotoId?: string;
}

export interface UpdateTeacherProfileInput {
  employeeId?: string;
  qualification?: string;
  specialization?: string;
  joiningDate?: string;
  salary?: number;
  phone?: string;
  emergencyContact?: string;
  address?: string;
  dateOfBirth?: string;
  gender?: 'male' | 'female' | 'other';
  bloodGroup?: string;
  fatherName?: string;
  cardId?: string;
  severeDisease?: string;
  experience?: string;
  bio?: string;
  profilePhotoId?: string;
}

export interface CreateAssignmentInput {
  academicYearId: string;
  teacherId: string;
  groupId: string;
  subjectId: string;
  isClassTeacher?: boolean;
  role?: string; // "primary", "assistant", "hod"
}

export interface UpdateAssignmentInput {
  isClassTeacher?: boolean;
}

// ═══════════════════════════════════════════════════════════════════
// TEACHER PROFILE SERVICE
// ═══════════════════════════════════════════════════════════════════

class TeacherProfileService {
  // TC-001: Create teacher profile
  async create(data: CreateTeacherProfileInput) {
    let userId: string;

    // Option A: Use existing user by userId
    if (data.userId) {
      const user = await prisma.user.findUnique({ where: { id: data.userId } });
      if (!user) throw { status: 404, message: 'User not found' };
      if (user.role !== 'teacher') throw { status: 400, message: 'User must have role=teacher' };
      userId = data.userId;
    }
    // Option B: Auto-create User with role=teacher
    else if (data.name && data.username) {
      const bc = await import('bcryptjs');
      const password = data.password || 'teacher123'; // Default password if not provided
      const passwordHash = await bc.hash(password, 12);

      try {
        const user = await prisma.user.create({
          data: {
            name: data.name,
            username: data.username,
            email: data.email || null,  // normalize empty string to null (unique constraint)
            passwordHash,
            role: 'teacher',
            status: 'active',
          },
        });
        userId = user.id;
      } catch (err: any) {
        // Handle Prisma unique constraint violations (P2002)
        if (err?.code === 'P2002') {
          const field = err.meta?.target?.[0] || 'field';
          throw { status: 409, message: `A user with this ${field} already exists` };
        }
        throw err;
      }
    } else {
      throw { status: 400, message: 'Provide either userId or name+username to create a teacher' };
    }

    // Check for existing profile (one per user)
    const existingProfile = await prisma.teacherProfile.findUnique({ where: { userId } });
    if (existingProfile) throw { status: 409, message: 'Teacher profile already exists for this user' };

    // Check employeeId uniqueness if provided
    if (data.employeeId) {
      const existingEmpId = await prisma.teacherProfile.findUnique({ where: { employeeId: data.employeeId } });
      if (existingEmpId) throw { status: 409, message: `Employee ID "${data.employeeId}" is already in use` };
    }

    const profile = await prisma.teacherProfile.create({
      data: {
        userId,
        employeeId: data.employeeId,
        qualification: data.qualification,
        specialization: data.specialization,
        joiningDate: data.joiningDate ? new Date(data.joiningDate) : null,
        salary: data.salary !== undefined ? data.salary : null,
        phone: data.phone,
        emergencyContact: data.emergencyContact,
        address: data.address,
        dateOfBirth: data.dateOfBirth ? new Date(data.dateOfBirth) : null,
        gender: data.gender as any,
        bloodGroup: data.bloodGroup,
        fatherName: data.fatherName,
        cardId: data.cardId,
        severeDisease: data.severeDisease,
        experience: data.experience,
        bio: data.bio,
      },
      include: {
        user: { select: { id: true, name: true, email: true, phone: true, username: true, role: true, status: true, profilePhotoId: true } },
      },
    });

    // Add teacher as BranchMember so branch-scoped stats work
    if (data.branchId) {
      try {
        const existing = await prisma.branchMember.findUnique({
          where: { branchId_userId: { branchId: data.branchId, userId } },
        });
        if (!existing) {
          await prisma.branchMember.create({
            data: {
              branchId: data.branchId,
              userId,
              role: 'teacher',
              isActive: true,
            },
          });
        }
      } catch (err: any) {
        console.warn('[Teacher] Failed to create BranchMember:', err.message);
      }
    }

    // Set profile photo if provided (and delete old one if exists)
    if (data.profilePhotoId) {
      // Check if user already had a profile photo and delete it
      const existingUser = await prisma.user.findUnique({ where: { id: userId }, select: { profilePhotoId: true } });
      if (existingUser?.profilePhotoId && existingUser.profilePhotoId !== data.profilePhotoId) {
        try {
          const oldRecord = await prisma.fileRecord.findUnique({ where: { id: existingUser.profilePhotoId } });
          if (oldRecord) {
            await storage.delete(oldRecord.storagePath);
            await prisma.fileRecord.delete({ where: { id: oldRecord.id } });
          }
        } catch (err) {
          console.warn('[Teacher] Failed to delete old profile photo:', err);
        }
      }
      await prisma.user.update({
        where: { id: userId },
        data: { profilePhotoId: data.profilePhotoId },
      });
    }

    return profile;
  }

  // TC-002: List all teachers with search + filter
  async findAll(params: { search?: string; qualification?: string; page?: number; limit?: number }) {
    const { search, qualification, page = 1, limit = 20 } = params;
    const skip = (page - 1) * limit;

    const where: any = {
      user: { role: 'teacher' },
    };

    // Search by teacher name or employeeId
    if (search) {
      where.OR = [
        { user: { name: { contains: search, mode: 'insensitive' } } },
        { employeeId: { contains: search, mode: 'insensitive' } },
      ];
    }

    // Filter by qualification
    if (qualification) {
      where.qualification = { contains: qualification, mode: 'insensitive' };
    }

    const [profiles, total] = await Promise.all([
      prisma.teacherProfile.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          user: { select: { id: true, name: true, email: true, phone: true, username: true, role: true, status: true, profilePhotoId: true } },
        },
      }),
      prisma.teacherProfile.count({ where }),
    ]);

    // Enrich with assignment count (TeacherProfile has no direct relation to TeacherAssignment)
    const enriched = await Promise.all(profiles.map(async (profile) => {
      const assignmentCount = await prisma.teacherAssignment.count({
        where: { teacherId: profile.userId },
      });
      return { ...profile, _count: { assignments: assignmentCount } };
    }));

    return {
      data: enriched,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  // TC-003: Find teacher by ID with assignments
  async findById(id: string) {
    const profile = await prisma.teacherProfile.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, name: true, email: true, phone: true, username: true, role: true, status: true, profilePhotoId: true } },
      },
    });

    if (!profile) throw { status: 404, message: 'Teacher profile not found' };

    // Fetch assignments separately (TeacherProfile has no direct relation)
    const assignments = await prisma.teacherAssignment.findMany({
      where: { teacherId: profile.userId },
      include: {
        group: { select: { id: true, name: true, section: true } },
        subject: { select: { id: true, name: true, code: true } },
        academicYear: { select: { id: true } },
      },
    });

    return { ...profile, assignments };
  }

  // TC-004: Update teacher profile
  async update(id: string, data: UpdateTeacherProfileInput) {
    const existing = await prisma.teacherProfile.findUnique({ where: { id } });
    if (!existing) throw { status: 404, message: 'Teacher profile not found' };

    // Check employeeId uniqueness if being changed
    if (data.employeeId && data.employeeId !== existing.employeeId) {
      const conflict = await prisma.teacherProfile.findUnique({ where: { employeeId: data.employeeId } });
      if (conflict) throw { status: 409, message: `Employee ID "${data.employeeId}" is already in use` };
    }

    const profile = await prisma.teacherProfile.update({
      where: { id },
      data: {
        employeeId: data.employeeId,
        qualification: data.qualification,
        specialization: data.specialization,
        joiningDate: data.joiningDate ? new Date(data.joiningDate) : undefined,
        salary: data.salary !== undefined ? data.salary : undefined,
        phone: data.phone,
        emergencyContact: data.emergencyContact,
        address: data.address,
        dateOfBirth: data.dateOfBirth ? new Date(data.dateOfBirth) : undefined,
        gender: data.gender as any,
        bloodGroup: data.bloodGroup,
        fatherName: data.fatherName,
        cardId: data.cardId,
        severeDisease: data.severeDisease,
        experience: data.experience,
        bio: data.bio,
      },
      include: {
        user: { select: { id: true, name: true, email: true, phone: true, username: true, role: true, status: true, profilePhotoId: true } },
      },
    });

    // Update profile photo if provided
    if (data.profilePhotoId !== undefined) {
      // Get old profile photo (before update) to delete the file
      const oldUser = await prisma.user.findUnique({ where: { id: existing.userId }, select: { profilePhotoId: true } });
      const oldPhotoId = oldUser?.profilePhotoId;
      if (oldPhotoId && oldPhotoId !== data.profilePhotoId) {
        try {
          const oldRecord = await prisma.fileRecord.findUnique({ where: { id: oldPhotoId } });
          if (oldRecord) {
            await storage.delete(oldRecord.storagePath);
            await prisma.fileRecord.delete({ where: { id: oldRecord.id } });
          }
        } catch (err) {
          console.warn('[Teacher] Failed to delete old profile photo:', err);
        }
      }
      await prisma.user.update({
        where: { id: existing.userId },
        data: { profilePhotoId: data.profilePhotoId || null },
      });
    }

    return profile;
  }

  // Set password for teacher (admin verifies own password first)
  async setPassword(profileId: string, newPassword: string, adminId: string, adminPassword: string, ipAddress?: string) {
    const bc = await import('bcryptjs');

    // Find the teacher profile with user info
    const profile = await prisma.teacherProfile.findUnique({
      where: { id: profileId },
      select: {
        userId: true,
        user: { select: { username: true, name: true } },
      },
    });
    if (!profile) throw { status: 404, message: 'Teacher profile not found' };

    // Verify admin's password
    const admin = await prisma.user.findUnique({ where: { id: adminId } });
    if (!admin) throw { status: 404, message: 'Admin user not found' };

    const isMatch = await bc.compare(adminPassword, admin.passwordHash);
    if (!isMatch) throw { status: 403, message: 'Admin password is incorrect' };

    // ── Password history check (V6) ─────────────────────────
    // Check last 3 password hashes from AuditLog to prevent reuse
    const recentChanges = await prisma.auditLog.findMany({
      where: { entity: 'TeacherProfile', entityId: profileId, action: 'password_reset' },
      orderBy: { createdAt: 'desc' },
      take: 3,
      select: { newValue: true },
    });
    for (const entry of recentChanges) {
      const prevHash = (entry.newValue as any)?.passwordHash;
      if (prevHash && typeof prevHash === 'string') {
        const isReused = await bc.compare(newPassword, prevHash);
        if (isReused) {
          throw { status: 409, message: 'This password was used recently. Please choose a different one.' };
        }
      }
    }

    // Hash the new password and update the teacher's user record
    const newHash = await bc.hash(newPassword, 12);
    await prisma.user.update({
      where: { id: profile.userId },
      data: { passwordHash: newHash },
    });

    // ── Audit trail (V2) ────────────────────────────────────
    try {
      await prisma.auditLog.create({
        data: {
          userId: adminId,
          action: 'password_reset',
          entity: 'TeacherProfile',
          entityId: profileId,
          newValue: {
            username: profile.user.username || profile.user.name,
            passwordHash: newHash, // stored for history check (V6)
          },
          ipAddress,
        },
      });
    } catch (logErr: any) {
      // Log failure is non-critical — password was already changed
      console.warn('[AuditLog] Failed to record password change:', logErr.message);
    }

    return { message: 'Password updated successfully' };
  }

  // Deactivate teacher: ends assignments, sets inactive, preserves history
  async deactivate(id: string) {
    const profile = await prisma.teacherProfile.findUnique({
      where: { id },
      select: {
        id: true,
        userId: true,
        user: { select: { name: true, status: true } },
      },
    });
    if (!profile) throw { status: 404, message: 'Teacher profile not found' };
    if (profile.user.status === 'inactive') throw { status: 400, message: 'Teacher is already inactive' };

    // Deactivate user + branch member (assignments stay as historical records)
    await prisma.user.update({
      where: { id: profile.userId },
      data: { status: 'inactive' },
    });
    await prisma.branchMember.updateMany({
      where: { userId: profile.userId, isActive: true },
      data: { isActive: false },
    });

    return { message: `"${profile.user.name}" deactivated. History preserved.` };
  }

  // Reactivate teacher: restore login + branch access
  async reactivate(id: string) {
    const profile = await prisma.teacherProfile.findUnique({
      where: { id },
      select: {
        userId: true,
        user: { select: { name: true, status: true } },
      },
    });
    if (!profile) throw { status: 404, message: 'Teacher profile not found' };
    if (profile.user.status === 'active') throw { status: 400, message: 'Teacher is already active' };

    await prisma.user.update({
      where: { id: profile.userId },
      data: { status: 'active' },
    });
    await prisma.branchMember.updateMany({
      where: { userId: profile.userId, isActive: false },
      data: { isActive: true },
    });

    return { message: `"${profile.user.name}" reactivated.` };
  }

  // TC-005: Delete — only if teacher has ZERO assignments ever (safe to remove completely)
  async delete(id: string) {
    const profile = await prisma.teacherProfile.findUnique({
      where: { id },
    });
    if (!profile) throw { status: 404, message: 'Teacher profile not found' };

    // Count ALL assignments ever (not just active)
    const assignmentCount = await prisma.teacherAssignment.count({
      where: { teacherId: profile.userId },
    });

    if (assignmentCount > 0) {
      throw {
        status: 409,
        message: `This teacher has ${assignmentCount} historical assignment(s). Deactivate instead to preserve records.`,
      };
    }

    // Hard delete: no assignments ever — safe to remove completely
    await prisma.teacherProfile.delete({ where: { id } });
    await prisma.user.delete({ where: { id: profile.userId } });

    return { message: 'Teacher deleted permanently.' };
  }
}

// ═══════════════════════════════════════════════════════════════════
// TEACHER ASSIGNMENT SERVICE
// ═══════════════════════════════════════════════════════════════════

class TeacherAssignmentService {
  // TC-006: Create assignment with unique constraint
  async create(data: CreateAssignmentInput) {
    // Verify teacher exists and is active
    const teacher = await prisma.user.findUnique({ where: { id: data.teacherId } });
    if (!teacher || teacher.role !== 'teacher') throw { status: 400, message: 'Valid teacher user not found' };
    if (teacher.status !== 'active') throw { status: 400, message: 'Teacher is not active' };

    // Verify academic year exists
    const ay = await prisma.academicYear.findUnique({ where: { id: data.academicYearId } });
    if (!ay) throw { status: 404, message: 'Academic year not found' };

    // Verify group exists
    const group = await prisma.group.findUnique({ where: { id: data.groupId } });
    if (!group) throw { status: 404, message: 'Group not found' };

    // Verify subject exists
    const subject = await prisma.subject.findUnique({ where: { id: data.subjectId } });
    if (!subject) throw { status: 404, message: 'Subject not found' };

    return prisma.teacherAssignment.create({
      data: {
        academicYearId: data.academicYearId,
        teacherId: data.teacherId,
        groupId: data.groupId,
        subjectId: data.subjectId,
        isClassTeacher: data.isClassTeacher ?? false,
        role: data.role || 'primary',
      },
      include: {
        teacher: { select: { id: true, name: true } },
        group: { select: { id: true, name: true, section: true } },
        subject: { select: { id: true, name: true, code: true } },
        academicYear: { select: { id: true } },
      },
    });
  }

  // TC-007: Get all assignments for a teacher
  async findByTeacher(teacherId: string) {
    const assignments = await prisma.teacherAssignment.findMany({
      where: { teacherId },
      include: {
        group: { select: { id: true, name: true, section: true, displayOrder: true } },
        subject: { select: { id: true, name: true, code: true } },
        academicYear: { select: { id: true } },
      },
    });

    return assignments;
  }

  // TC-008: Get all assignments for a group
  async findByGroup(groupId: string) {
    const assignments = await prisma.teacherAssignment.findMany({
      where: { groupId },
      include: {
        teacher: { select: { id: true, name: true } },
        subject: { select: { id: true, name: true, code: true } },
        academicYear: { select: { id: true } },
      },
    });

    return assignments;
  }

  // TC-009: Update assignment (isClassTeacher toggle)
  async update(id: string, data: UpdateAssignmentInput) {
    const existing = await prisma.teacherAssignment.findUnique({ where: { id } });
    if (!existing) throw { status: 404, message: 'Assignment not found' };

    // If setting isClassTeacher=true, unset any existing class teacher for this group
    if (data.isClassTeacher === true) {
      await prisma.teacherAssignment.updateMany({
        where: { groupId: existing.groupId, isClassTeacher: true, id: { not: id } },
        data: { isClassTeacher: false },
      });
    }

    return prisma.teacherAssignment.update({
      where: { id },
      data: { isClassTeacher: data.isClassTeacher },
      include: {
        teacher: { select: { id: true, name: true } },
        group: { select: { id: true, name: true, section: true } },
        subject: { select: { id: true, name: true, code: true } },
      },
    });
  }

  // TC-010: Delete assignment
  async delete(id: string) {
    const existing = await prisma.teacherAssignment.findUnique({ where: { id } });
    if (!existing) throw { status: 404, message: 'Assignment not found' };

    await prisma.teacherAssignment.delete({ where: { id } });
    return { message: 'Assignment removed' };
  }
}

export const teacherProfileService = new TeacherProfileService();
export const teacherAssignmentService = new TeacherAssignmentService();
