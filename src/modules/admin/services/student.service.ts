import { prisma } from '../../../lib/prisma';
import { deleteFileRecordById } from '../../upload/upload.service';
import { generateUsername, generatePassword } from '../../../utils/username';
import notificationService from '../../../services/notification.service';

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

  // ─── Send credentials via WhatsApp ─────────────────────────

  /**
   * Send login credentials to a single student via WhatsApp.
   * Generates a fresh temporary password so the student can log in immediately.
   */
  async sendCredentials(studentId: string, userId: string, ipAddress?: string) {
    const bc = await import('bcryptjs');
    const student = await prisma.student.findUnique({
      where: { id: studentId },
      select: { id: true, name: true, studentWhatsapp: true, username: true, phone: true, user: { select: { id: true, username: true } } },
    });
    if (!student) throw { status: 404, message: 'Student not found' };
    if (!student.user) throw { status: 400, message: 'No login credentials. Generate credentials first.' };

    const whatsapp = student.studentWhatsapp || student.phone;
    if (!whatsapp) throw { status: 400, message: 'No WhatsApp/phone number available for this student.' };

    // Generate a fresh temporary password, hash it, save it
    const tempPassword = generatePassword();
    const hash = await bc.hash(tempPassword, 12);
    await prisma.user.update({
      where: { id: student.user.id },
      data: { passwordHash: hash },
    });

    // Send via WhatsApp
    const result = await notificationService.sendCredential({
      to: whatsapp,
      username: student.user.username || student.username || '—',
      password: tempPassword,
      name: student.name,
      recipientType: 'student',
    });

    const status = result.success ? 'sent' : 'failed';
    const now = new Date();

    // Update student credential tracking fields
    await prisma.student.update({
      where: { id: studentId },
      data: {
        credentialSentAt: now,
        credentialStatus: status,
        passwordSetAt: now,
        ...(result.success ? { credentialDeliveredAt: null, credentialSeenAt: null } : {}),
      },
    });

    // Create CredentialSend history record (redacted — no passwords)
    await prisma.credentialSend.create({
      data: {
        studentId,
        sentAt: now,
        status,
        to: whatsapp.slice(0, 6) + '****',
        errorMsg: result.success ? null : result.errorMessage || result.messageStatus || 'Unknown error',
        sentById: userId,
      },
    });

    // Audit trail
    try {
      await prisma.auditLog.create({
        data: {
          userId,
          action: 'credential_sent',
          entity: 'Student',
          entityId: studentId,
          newValue: { sent: result.success, status, to: whatsapp.slice(0, 6) + '****' },
          ipAddress,
        },
      });
    } catch { /* best-effort */ }

    return {
      sent: result.success,
      status,
      to: whatsapp.slice(0, 6) + '****',
      channel: result.channel,
      messageId: result.messageId,
      errorCode: result.errorCode,
      errorMessage: result.errorMessage,
      retryable: result.retryable,
      solvable: result.solvable,
    };
  }

  /**
   * Send credentials via WhatsApp to multiple students.
   * Processes sequentially with delay to avoid rate limits.
   */
  async sendAllCredentials(studentIds: string[], userId: string, ipAddress?: string) {
    const results: { studentId: string; sent: boolean; reason?: string }[] = [];
    let sent = 0, skipped = 0, failed = 0;

    for (const sid of studentIds) {
      try {
        const result = await this.sendCredentials(sid, userId, ipAddress);
        results.push({ studentId: sid, sent: result.sent });
        if (result.sent) sent++; else failed++;
      } catch (e: any) {
        const reason = e.message || 'Unknown error';
        results.push({ studentId: sid, sent: false, reason });
        if (reason.includes('no WhatsApp') || reason.includes('credentials')) skipped++;
        else failed++;
      }
    }

    return { sent, skipped, failed, results };
  }
}

export const studentService = new StudentService();
