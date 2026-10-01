import { prisma } from '../../../lib/prisma';
import { deleteFileRecordById } from '../../upload/upload.service';
import { generateUsername, generatePassword } from '../../../utils/username';
import env from '../../../config/env';
import { assertPasswordPolicy } from '../../../utils/password-policy';

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
  rollNumber?: string;
  profilePhotoId?: string;
  // Guardian fields — if provided, creates a parent profile and links it
  guardianName?: string;
  guardianRelation?: string;
  createdById?: string;
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
  updatedById?: string;
}

class StudentService {
  async findAll(params: {
    search?: string;
    groupId?: string;
    academicYearId?: string;
    branchId?: string;
    rollNumber?: string;
    page?: number;
    limit?: number;
  }) {
    const { search, groupId, academicYearId, branchId, rollNumber, page = 1, limit: rawLimit } = params;
    const limit = rawLimit || 20;
    const skip = (page - 1) * limit;
    const where: any = {};
    if (groupId) where.groupId = groupId;
    if (academicYearId) where.academicYearId = academicYearId;
    if (branchId) where.academicYear = { branchId };
    if (rollNumber) where.rollNumber = { contains: rollNumber, mode: 'insensitive' };
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { admissionNumber: { contains: search, mode: 'insensitive' } },
      ];
    }
    const [data, total] = await Promise.all([
      prisma.student.findMany({
        where, skip, take: limit > 0 ? limit : undefined, orderBy: [{ group: { displayOrder: 'asc' } }, { rollNumber: 'asc' }],
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
      const activeAy = await prisma.academicYear.findFirst({ where: { status: 'ACTIVE' }, select: { id: true, branchId: true } });
      if (!activeAy) throw { status: 400, message: 'No active academic year found' };
      academicYearId = activeAy.id;
    }
    const ayRow = await prisma.academicYear.findUnique({
      where: { id: academicYearId },
      select: { branchId: true },
    });
    if (!ayRow) throw { status: 400, message: 'Academic year not found' };

    // Get next student number from sequence (permanent, never reuses)
    let studentNumber = 1;
    try {
      const seqResult: any = await prisma.$queryRawUnsafe(`SELECT nextval('students_number_seq') AS n`);
      studentNumber = parseInt(seqResult[0]?.n || '1', 10);
    } catch {
      // Fallback for test environment (mocked Prisma) or if sequence doesn't exist
      const maxStudent = await prisma.student.findFirst({ orderBy: { studentNumber: 'desc' }, select: { studentNumber: true } });
      studentNumber = (maxStudent?.studentNumber || 0) + 1;
    }

    let admissionNumber = data.admissionNumber;
    if (!admissionNumber) {
      const year = new Date().getFullYear();
      admissionNumber = `MCS-${year}-${String(studentNumber).padStart(4, '0')}`;
    }

    // Auto-generate username using studentNumber + admission year
    const admissionYear = data.dateOfBirth
      ? new Date(data.dateOfBirth).getFullYear()
      : new Date().getFullYear();
    const username = generateUsername(data.name, studentNumber, admissionYear);

    // Auto-assign roll number (sequential within the group)
    let rollNumber = data.rollNumber || undefined;
    if (!rollNumber && data.groupId) {
      const count = await prisma.student.count({ where: { groupId: data.groupId } });
      rollNumber = String(count + 1);
    }

    const person = await prisma.studentPerson.create({
      data: {
        branchId: ayRow.branchId,
        name: data.name,
        admissionNumber,
      },
    });

    const student = await prisma.student.create({
      data: {
        personId: person.id,
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
        studentNumber,
        rollNumber,
        username,
        credentialTag: 'CRED_NEW',
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
        if (oldRecord) { await deleteFileRecordById(oldRecord.id); }
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
  async linkParent(studentId: string, parentUserId: string, relation: string, isPrimary?: boolean, createdById?: string) {
    return prisma.studentParent.create({
      data: { studentId, parentId: parentUserId, relation, isPrimary: isPrimary || false, createdById },
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
   * linked to the Student record. Reuses the existing username that was
   * auto-generated on student creation. Returns the plaintext password once.
   */
  async generateCredentials(studentId: string) {
    const student = await prisma.student.findUnique({
      where: { id: studentId },
      select: { id: true, name: true, username: true, studentNumber: true, userId: true },
    });
    if (!student) throw { status: 404, message: 'Student not found' };
    if (student.userId) throw { status: 409, message: 'Student already has login credentials' };

    // Use existing username (auto-generated on student create)
    let finalUsername = student.username;
    if (!finalUsername) {
      // Edge case: student created before auto-generation existed
      const year = new Date().getFullYear();
      finalUsername = generateUsername(
        student.name,
        student.studentNumber || 1,
        year,
      );
      await prisma.student.update({
        where: { id: student.id },
        data: { username: finalUsername },
      });
    }

    // Ensure uniqueness (just in case of very rare collision)
    finalUsername = await this.ensureUniqueUsername(finalUsername);

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
      data: { username: finalUsername, credentialGeneratedAt: new Date() },
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

    // Track password change date on Student
    await prisma.student.update({
      where: { id: studentId },
      data: { passwordSetAt: new Date() },
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

  // ─── Manual WhatsApp handoff: Save Credential (M21) ───
  // Composite save for the Students Operations drawer. Persists the
  // FRONTEND-generated password (never mints a second one), records the
  // manual-handoff timestamp, and returns the website for local message
  // construction. NEVER touches the messaging provider, queue, or worker —
  // the browser opens WhatsApp with a prefilled message; the app sends nothing.
  //
  // "Existing password" signal: student.passwordSetAt (set only when a
  // password was knowingly saved before; generate-credentials alone does
  // not set it). Backend is authoritative — row state on the page is advisory.
  // credentialStatus 'sent' in this flow means MANUAL HANDOFF INITIATED,
  // never provider-confirmed delivery.

  async saveCredential(
    studentId: string,
    input: { password: string; adminPassword: string; replaceExisting?: boolean; idempotencyKey?: string },
    adminId: string,
    ipAddress?: string,
    branchId?: string,
  ) {
    const bc = await import('bcryptjs');

    const student = await prisma.student.findUnique({
      where: { id: studentId },
      select: {
        id: true, name: true, username: true, userId: true,
        passwordSetAt: true,
        group: { select: { id: true } },
        studentWhatsapp: true, phone: true,
        academicYear: { select: { branchId: true } },
        user: { select: { passwordHash: true } },
      },
    });
    if (!student) throw { status: 404, message: 'Student not found' };

    // M21 §26 — target-branch ownership (M13 pattern). Never reproduced the old gap.
    const targetBranch = student.academicYear?.branchId;
    if (branchId && targetBranch && branchId !== targetBranch) {
      throw { status: 403, message: 'Student does not belong to the requested branch' };
    }

    // M21 §12/§23 — business preconditions for the save leg.
    if (!student.username) throw { status: 400, code: 'NO_USERNAME', message: 'Username is required before saving credentials.' };
    if (!student.group) throw { status: 400, code: 'NO_CLASS', message: 'Class is required before saving credentials.' };
    const phone = student.studentWhatsapp || student.phone;
    if (!phone) throw { status: 400, code: 'NO_PHONE', message: 'WhatsApp/phone number is required before saving credentials.' };
    if (!student.userId || !student.user) throw { status: 400, message: 'Student has no login credentials. Generate credentials first.' };
    assertPasswordPolicy(input.password);

    // M21 §18 — authoritative existing-password check. Fail closed, no mutation.
    const hasExistingPassword = !!student.passwordSetAt;
    if (hasExistingPassword && !input.replaceExisting) {
      throw { status: 409, code: 'PASSWORD_REPLACEMENT_REQUIRED', message: 'Student already has a password. Confirm replacement first.' };
    }

    // M21 §25 — idempotency: same key seen on a recent credential_save audit
    // resolves to the stored result WITHOUT re-hashing or rotating.
    if (input.idempotencyKey) {
      const prior = await prisma.auditLog.findFirst({
        where: {
          action: 'credential_save', entity: 'Student', entityId: studentId,
          metadata: { path: ['idempotencyKey'], equals: input.idempotencyKey },
        },
        orderBy: { createdAt: 'desc' },
        select: { newValue: true },
      });
      const prev = (prior?.newValue as any) || {};
      if (prior && prev.credentialSentAt) {
        return {
          idempotent: true,
          website: prev.website || env.FRONTEND_URL || 'https://mothercareschool.pk',
          schoolName: prev.schoolName || env.SCHOOL_NAME || 'Mother Care School',
          appUrl: prev.appUrl || env.APP_DOWNLOAD_URL || 'https://play.google.com/store/apps/details?id=com.mothercare.app',
          credentialGeneratedAt: prev.credentialGeneratedAt,
          credentialSentAt: prev.credentialSentAt,
        };
      }
    }

    // M21 §19 — acting-admin verification (same pattern as set-password).
    const admin = await prisma.user.findUnique({ where: { id: adminId } });
    if (!admin) throw { status: 404, message: 'Admin user not found' };
    const isMatch = await bc.compare(input.adminPassword, admin.passwordHash);
    if (!isMatch) throw { status: 403, message: 'Admin password is incorrect' };

    // M21 §20 — password-history protection (last 3, across both actions).
    const recentChanges = await prisma.auditLog.findMany({
      where: { entity: 'Student', entityId: studentId, action: { in: ['password_reset', 'credential_save'] } },
      orderBy: { createdAt: 'desc' },
      take: 3,
      select: { newValue: true },
    });
    for (const entry of recentChanges) {
      const prevHash = (entry.newValue as any)?.passwordHash;
      if (prevHash && typeof prevHash === 'string') {
        const isReused = await bc.compare(input.password, prevHash);
        if (isReused) {
          throw { status: 409, message: 'This password was used recently. Please generate a different one.' };
        }
      }
    }

    // M21 §24 — commit hash + timestamps + audit together. No provider, no queue, ever.
    const newHash = await bc.hash(input.password, 12);
    const now = new Date();
    const website = env.FRONTEND_URL || 'https://mothercareschool.pk';
    const schoolName = env.SCHOOL_NAME || 'Mother Care School';
    const appUrl = env.APP_DOWNLOAD_URL || 'https://play.google.com/store/apps/details?id=com.mothercare.app';
    const [_, __, audit] = await prisma.$transaction([
      prisma.user.update({ where: { id: student.userId }, data: { passwordHash: newHash } }),
      prisma.student.update({
        where: { id: studentId },
        data: {
          passwordSetAt: now,
          credentialGeneratedAt: now,
          credentialSentAt: now,
          credentialStatus: 'sent', // manual-handoff-initiated semantics (M21 §34)
        },
      }),
      prisma.auditLog.create({
        data: {
          userId: adminId,
          action: 'credential_save',
          entity: 'Student',
          entityId: studentId,
          newValue: {
            username: student.name,
            passwordHash: newHash,
            credentialGeneratedAt: now.toISOString(),
            credentialSentAt: now.toISOString(),
            website,
            schoolName,
            appUrl,
          },
          metadata: input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : undefined,
          ipAddress,
        },
      }),
    ]);
    void audit;

    // M21 §44 — response carries NO password (drawer already holds P1).
    return {
      success: true,
      website,
      schoolName,
      appUrl,
      credentialGeneratedAt: now.toISOString(),
      credentialSentAt: now.toISOString(),
    };
  }
}

export const studentService = new StudentService();
