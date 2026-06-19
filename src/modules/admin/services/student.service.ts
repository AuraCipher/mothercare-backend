import { prisma } from '../../../lib/prisma';
import { storage } from '../../upload/storage.service';
import { generateUsername, generatePassword } from '../../../utils/username';

export interface CreateStudentInput {
  name: string;
  gender?: 'male' | 'female' | 'other';
  dateOfBirth?: string;
  religion?: string;
  nationality?: string;
  address?: string;
  city?: string;
  postalCode?: string;
  country?: string;
  phone?: string;
  bloodGroup?: string;
  bformCnic?: string;
  motherTongue?: string;
  studentEmail?: string;
  studentWhatsapp?: string;
  previousSchool?: string;
  previousClass?: string;
  tcNumber?: string;
  referredBy?: string;
  groupId?: string;
  academicYearId?: string;
  admissionNumber?: string;
  profilePhotoId?: string;
  // Guardian fields — if provided, creates a parent profile and links it
  guardianName?: string;
  guardianRelation?: string;
}

export interface UpdateStudentInput {
  name?: string;
  gender?: 'male' | 'female' | 'other';
  dateOfBirth?: string;
  religion?: string;
  nationality?: string;
  address?: string;
  city?: string;
  postalCode?: string;
  country?: string;
  phone?: string;
  bloodGroup?: string;
  bformCnic?: string;
  motherTongue?: string;
  studentEmail?: string;
  studentWhatsapp?: string;
  previousSchool?: string;
  previousClass?: string;
  tcNumber?: string;
  referredBy?: string;
  groupId?: string;
  admissionNumber?: string;
  profilePhotoId?: string;
}

class StudentService {
  async findAll(params: {
    search?: string;
    groupId?: string;
    academicYearId?: string;
    rollNumber?: string;
    page?: number;
    limit?: number;
  }) {
    const { search, groupId, academicYearId, rollNumber, page = 1, limit = 20 } = params;
    const skip = (page - 1) * limit;
    const where: any = {};
    if (groupId) where.groupId = groupId;
    if (academicYearId) where.academicYearId = academicYearId;
    if (rollNumber) where.rollNumber = { contains: rollNumber, mode: 'insensitive' };
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { admissionNumber: { contains: search, mode: 'insensitive' } },
      ];
    }
    const [data, total] = await Promise.all([
      prisma.student.findMany({
        where, skip, take: limit, orderBy: { createdAt: 'desc' },
        include: { group: { select: { id: true, name: true, section: true } } },
      }),
      prisma.student.count({ where }),
    ]);
    return { data, meta: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }

  async findById(id: string) {
    const student = await prisma.student.findUnique({
      where: { id },
      include: {
        group: { select: { id: true, name: true, section: true } },
        parents: {
          include: {
            parent: {
              include: { user: { select: { id: true, name: true, phone: true } } },
            },
          },
        },
        enrollments: {
          include: { academicYear: { select: { id: true } }, group: { select: { id: true, name: true, section: true } } },
          orderBy: { joinedAt: 'desc' },
        },
        emergencyContacts: { orderBy: { priority: 'asc' } },
        healthRecord: true,
        user: { select: { id: true, name: true, username: true } },
      },
    });
    if (!student) throw { status: 404, message: 'Student not found' };
    return student;
  }

  async create(data: CreateStudentInput) {
    if (!data.name) throw { status: 400, message: 'Student name is required' };
    let academicYearId = data.academicYearId;
    if (!academicYearId) {
      const activeAy = await prisma.academicYear.findFirst({ where: { status: 'ACTIVE' }, select: { id: true } });
      if (!activeAy) throw { status: 400, message: 'No active academic year found' };
      academicYearId = activeAy.id;
    }
    let admissionNumber = data.admissionNumber;
    if (!admissionNumber) {
      const year = new Date().getFullYear();
      const count = await prisma.student.count();
      admissionNumber = `MCS-${year}-${String(count + 1).padStart(4, '0')}`;
    }
    const student = await prisma.student.create({
      data: {
        name: data.name, gender: data.gender as any,
        dateOfBirth: data.dateOfBirth ? new Date(data.dateOfBirth) : undefined,
        religion: data.religion, nationality: data.nationality || 'Pakistani',
        address: data.address, city: data.city, postalCode: data.postalCode,
        country: data.country,
        phone: data.phone, bloodGroup: data.bloodGroup,
        bformCnic: data.bformCnic, motherTongue: data.motherTongue,
        studentEmail: data.studentEmail, studentWhatsapp: data.studentWhatsapp,
        previousSchool: data.previousSchool, previousClass: data.previousClass,
        tcNumber: data.tcNumber, referredBy: data.referredBy,
        groupId: data.groupId, academicYearId, admissionNumber,
        profilePhotoId: data.profilePhotoId,
        createdById: (data as any).createdById,
      },
      include: { group: { select: { id: true, name: true, section: true } } },
    });

    // If guardian name provided, create parent profile and link
    if (data.guardianName) {
      const baseUsername = `parent_${student.admissionNumber?.toLowerCase() || student.id.slice(0, 8)}`;
      let parentUser;
      try {
        parentUser = await prisma.user.create({
          data: {
            name: data.guardianName,
            username: baseUsername,
            passwordHash: '$2a$12$placeholder',
            role: 'parent',
            phone: data.phone || null,
            email: data.studentEmail || null,
            status: 'active',
          },
        });
      } catch (e: any) {
        // Username collision — append random suffix
        parentUser = await prisma.user.create({
          data: {
            name: data.guardianName,
            username: `${baseUsername}_${Math.random().toString(36).slice(2, 6)}`,
            passwordHash: '$2a$12$placeholder',
            role: 'parent',
            phone: data.phone || null,
            email: null,
            status: 'active',
          },
        });
      }
      try {
        const parentProfile = await prisma.parentProfile.create({
          data: {
            userId: parentUser.id,
            relation: data.guardianRelation || 'Guardian',
            phone: data.phone || null,
            whatsapp: data.studentWhatsapp || null,
            email: data.studentEmail || null,
          },
        });
        await prisma.studentParent.create({
          data: { studentId: student.id, parentId: parentProfile.id, relation: data.guardianRelation || 'Guardian', isPrimary: true },
        });
      } catch (err) {
        console.warn('[Student] Failed to create parent profile:', err);
      }
    }

    return student;
  }

  async update(id: string, data: UpdateStudentInput) {
    const existing = await prisma.student.findUnique({ where: { id } });
    if (!existing) throw { status: 404, message: 'Student not found' };
    if (data.profilePhotoId !== undefined && existing.profilePhotoId && data.profilePhotoId !== existing.profilePhotoId) {
      try {
        const oldRecord = await prisma.fileRecord.findUnique({ where: { id: existing.profilePhotoId } });
        if (oldRecord) { await storage.delete(oldRecord.storagePath); await prisma.fileRecord.delete({ where: { id: oldRecord.id } }); }
      } catch (err) { console.warn('[Student] Failed to delete old photo:', err); }
    }
    const student = await prisma.student.update({
      where: { id },
      data: {
        name: data.name, gender: data.gender as any,
        dateOfBirth: data.dateOfBirth ? new Date(data.dateOfBirth) : undefined,
        religion: data.religion, nationality: data.nationality,
        address: data.address, city: data.city, postalCode: data.postalCode,
        country: data.country,
        phone: data.phone, bloodGroup: data.bloodGroup,
        bformCnic: data.bformCnic, motherTongue: data.motherTongue,
        studentEmail: data.studentEmail, studentWhatsapp: data.studentWhatsapp,
        previousSchool: data.previousSchool, previousClass: data.previousClass,
        tcNumber: data.tcNumber, referredBy: data.referredBy,
        groupId: data.groupId, admissionNumber: data.admissionNumber,
        profilePhotoId: data.profilePhotoId,
        updatedById: (data as any).updatedById,
      },
      include: { group: { select: { id: true, name: true, section: true } } },
    });
    return student;
  }

  async deactivate(id: string) {
    const existing = await prisma.student.findUnique({ where: { id } });
    if (!existing) throw { status: 404, message: 'Student not found' };
    return prisma.student.update({ where: { id }, data: { isActive: false, status: 'WITHDRAWN' as any } });
  }

  // Emergency contacts
  async addEmergencyContact(studentId: string, data: { name: string; relationship: string; phone: string; whatsapp?: string; priority?: number }) {
    return prisma.emergencyContact.create({ data: { ...data, studentId } });
  }

  async deleteEmergencyContact(id: string) {
    return prisma.emergencyContact.delete({ where: { id } });
  }

  // Health record
  async upsertHealthRecord(studentId: string, data: {
    bloodGroup?: string; hasChronicDisease?: boolean; diseaseDetails?: string;
    allergies?: string; disability?: string; medicalNotes?: string;
    doctorName?: string; doctorPhone?: string;
  }) {
    return prisma.healthRecord.upsert({
      where: { studentId },
      create: { studentId, ...data },
      update: data,
    });
  }

  // Parent linking
  async linkParent(studentId: string, parentUserId: string, relation: string, isPrimary?: boolean) {
    return prisma.studentParent.create({
      data: { studentId, parentId: parentUserId, relation, isPrimary: isPrimary || false },
    });
  }

  async unlinkParent(studentId: string, parentUserId: string) {
    return prisma.studentParent.delete({
      where: { studentId_parentId: { studentId, parentId: parentUserId } },
    });
  }

  // ─── Credential management ────────────────────────────────────

  /**
   * Generate login credentials for a student. Creates a User(role='student')
   * linked to the Student record, generates a username and random password.
   * Returns the plaintext password once (must be shown to admin immediately).
   */
  async generateCredentials(studentId: string) {
    const student = await prisma.student.findUnique({
      where: { id: studentId },
      select: { id: true, name: true, rollNumber: true, userId: true },
    });
    if (!student) throw { status: 404, message: 'Student not found' };
    if (student.userId) throw { status: 409, message: 'Student already has login credentials' };

    // Get total student count for username scattering
    const totalCount = await prisma.student.count();
    const year = new Date().getFullYear();

    // Generate username using the encoder utility
    // Pattern: <firstName><scatteredCount><rollLetters><yearLastDigit>
    const username = generateUsername(
      student.name,
      totalCount + 1, // count INCLUDING this new student
      student.rollNumber || '0',
      year,
    );

    // Ensure username is unique (fallback: append random suffix)
    const finalUsername = await this.ensureUniqueUsername(username);

    const bc = await import('bcryptjs');
    const password = generatePassword();
    const hash = await bc.hash(password, 12);

    // Create user and link to student
    const user = await prisma.user.create({
      data: {
        name: student.name,
        username: finalUsername,
        passwordHash: hash,
        role: 'student',
        status: 'active',
        student: { connect: { id: student.id } },
      },
    });

    // Also store username directly on Student for quick access
    await prisma.student.update({
      where: { id: student.id },
      data: { username: finalUsername },
    });

    return { username: user.username, password };
  }

  /**
   * Ensure a username is unique in the DB.
   * If the generated username is taken, appends a random suffix.
   */
  private async ensureUniqueUsername(baseUsername: string): Promise<string> {
    let username = baseUsername;
    let attempts = 0;
    while (attempts < 10) {
      const existing = await prisma.user.findUnique({ where: { username } });
      if (!existing) return username;
      // Append random 3 digits to make unique
      username = `${baseUsername}${Math.floor(Math.random() * 900 + 100)}`;
      attempts++;
    }
    // Last resort: append timestamp
    return `${baseUsername}${Date.now() % 10000}`;
  }

  /**
   * Set a new password for a student's linked User account.
   * Requires admin password verification (same pattern as teacher).
   */
  async setPassword(studentId: string, newPassword: string, adminId: string, adminPassword: string, ipAddress?: string) {
    const bc = await import('bcryptjs');

    const student = await prisma.student.findUnique({
      where: { id: studentId },
      select: { userId: true, name: true },
    });
    if (!student) throw { status: 404, message: 'Student not found' };
    if (!student.userId) throw { status: 400, message: 'Student has no login credentials. Generate credentials first.' };

    // Verify admin's password
    const admin = await prisma.user.findUnique({ where: { id: adminId } });
    if (!admin) throw { status: 404, message: 'Admin user not found' };
    const isMatch = await bc.compare(adminPassword, admin.passwordHash);
    if (!isMatch) throw { status: 403, message: 'Admin password is incorrect' };

    // Password history check (last 3)
    const recentChanges = await prisma.auditLog.findMany({
      where: { entity: 'Student', entityId: studentId, action: 'password_reset' },
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

    const newHash = await bc.hash(newPassword, 12);
    await prisma.user.update({
      where: { id: student.userId },
      data: { passwordHash: newHash },
    });

    // Audit trail
    try {
      await prisma.auditLog.create({
        data: {
          userId: adminId,
          action: 'password_reset',
          entity: 'Student',
          entityId: studentId,
          newValue: { username: student.name, passwordHash: newHash },
          ipAddress,
        },
      });
    } catch { /* audit log is best-effort */ }

    return { message: 'Password updated successfully' };
  }
}

export const studentService = new StudentService();
