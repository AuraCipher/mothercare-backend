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
  branchId?: string;
  admissionNumber?: string;
  rollNumber?: string;
  profilePhotoId?: string;
  // Guardian fields — if provided, creates a parent profile and links it
  guardianName?: string;
  guardianRelation?: string;
  // Dedicated guardian CONTACT fields. When any of these are supplied the
  // parent profile is written from them alone and the student's own
  // phone / studentEmail / studentWhatsapp are NOT copied across — those
  // belong to the student row. Falls back to the student's values when
  // omitted, so legacy callers (the existing Add-Student form, which labels
  // a single set of numbers as "Guardian") keep behaving exactly as before.
  guardianPhone?: string;
  guardianWhatsapp?: string;
  guardianEmail?: string;
  guardianCnic?: string;
  guardianOccupation?: string;
  guardianEmployerName?: string;
  guardianMaritalStatus?: string;
  guardianMonthlyIncome?: string;
  createdById?: string;
  // Client-generated unique identity for one logical create. A retry — the
  // same key sent again after a dropped response, a double-tap, or a "did
  // that go through?" resubmit — converges on the FIRST committed student
  // instead of inserting another copy of the same child.
  idempotencyKey?: string;
}

export interface ParentLink {
  isPrimary?: boolean | null;
  parent?: { whatsapp?: string | null; phone?: string | null } | null;
}

/**
 * Resolve the WhatsApp recipient for a student: the PARENT's number.
 * Primary parent first, then any linked parent; whatsapp before phone.
 * Students are minors — the student's own numbers are never used here.
 */
export function pickParentWhatsapp(links: ParentLink[] | null | undefined): string | null {
  if (!links || links.length === 0) return null;
  const ordered = [...links].sort((a, b) => Number(b.isPrimary ?? false) - Number(a.isPrimary ?? false));
  for (const link of ordered) {
    const number = link.parent?.whatsapp?.trim() || link.parent?.phone?.trim();
    if (number) return number;
  }
  return null;
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
  // These two were previously accepted by the UI but silently dropped: the
  // interface omitted them AND the prisma.update() data did not include them,
  // so editing Roll No or Admission Date appeared to save and did nothing.
  rollNumber?: string;
  admissionDate?: string;
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
    status?: 'active' | 'inactive' | 'all';
  }) {
    const { search, groupId, academicYearId, branchId, rollNumber, page = 1, limit: rawLimit, status = 'active' } = params;
    const limit = rawLimit || 20;
    const skip = (page - 1) * limit;
    const where: any = {};
    if (groupId) where.groupId = groupId;
    if (academicYearId) where.academicYearId = academicYearId;
    if (branchId) where.academicYear = { branchId };
    if (rollNumber) where.rollNumber = { contains: rollNumber, mode: 'insensitive' };
    // Default view = active students only. 'inactive' → everyone else
    // (WITHDRAWN/SUSPENDED/EXPELED/TRANSFERRED/GRADUATED/DECEASED) for the
    // separate Deactivated page, mirroring the teachers split.
    if (status === 'active') where.status = 'ACTIVE';
    else if (status === 'inactive') where.status = { not: 'ACTIVE' };
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { admissionNumber: { contains: search, mode: 'insensitive' } },
      ];
    }
    const [data, total] = await Promise.all([
      prisma.student.findMany({
        where, skip, take: limit > 0 ? limit : undefined, orderBy: [{ group: { displayOrder: 'asc' } }, { rollNumber: 'asc' }],
        include: {
          group: { select: { id: true, name: true, section: true } },
          parents: {
            select: {
              isPrimary: true,
              parent: { select: { whatsapp: true, phone: true } },
            },
          },
          // Enrollment history drives the permanent-delete guard (same role
          // as teacher assignments on the teachers deactivated page).
          _count: { select: { enrollments: true } },
        },
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

    // ── Idempotency (same proven pattern as payroll M15) ───────────
    // Every POST that reaches the server allocates a fresh admission
    // number from the sequence, so the database can never tell a retry
    // from a new child. The key is the client's promise that "this body
    // is the same logical student as last time"; without it a lost
    // response on a weak connection turned every resubmit into a
    // duplicate admission.
    const rawIdempotencyKey = data.idempotencyKey?.trim() || null;
    if (data.idempotencyKey && (!rawIdempotencyKey || rawIdempotencyKey.length > 128)) {
      throw { status: 400, message: 'idempotencyKey must be a non-empty string up to 128 characters' };
    }
    const includeGroup = { group: { select: { id: true, name: true, section: true } } } as const;
    // Generic so the replayed/deduplicated flag merges into the SAME type
    // Prisma returned, keeping downstream property access type-safe.
    const returnReplayed = <T>(student: T): T => Object.assign(student as any, { replayed: true }) as T;
    const returnDeduplicated = <T>(student: T): T => Object.assign(student as any, { deduplicated: true }) as T;
    if (rawIdempotencyKey) {
      const replay = await prisma.student.findFirst({
        where: { idempotencyKey: rawIdempotencyKey },
        include: includeGroup,
      });
      if (replay) return returnReplayed(replay);
    }

    // ── Resolve the academic year + branch ──────────────────────────
    // A student always belongs to the academic year of their class, so the
    // group is authoritative when it is known. Falling back to a global
    // "first ACTIVE academic year" picks a year from a DIFFERENT branch —
    // the student is then written under a year nobody is looking at, and
    // every list scoped to the admin's branch/year silently omits them.
    let academicYearId = data.academicYearId;
    if (data.groupId) {
      const group = await prisma.group.findUnique({
        where: { id: data.groupId },
        select: { academicYearId: true },
      });
      if (!group) throw { status: 400, message: 'Class not found' };
      if (academicYearId && academicYearId !== group.academicYearId) {
        throw { status: 400, message: 'The selected class does not belong to the selected academic year' };
      }
      academicYearId = group.academicYearId;
    }
    if (!academicYearId) {
      const activeAy = await prisma.academicYear.findFirst({
        where: { status: 'ACTIVE', ...(data.branchId ? { branchId: data.branchId } : {}) },
        select: { id: true },
        orderBy: { createdAt: 'desc' },
      });
      if (!activeAy) throw { status: 400, message: 'No active academic year found' };
      academicYearId = activeAy.id;
    }
    const ayRow = await prisma.academicYear.findUnique({
      where: { id: academicYearId },
      select: { branchId: true },
    });
    if (!ayRow) throw { status: 400, message: 'Academic year not found' };
    if (data.branchId && data.branchId !== ayRow.branchId) {
      throw { status: 400, message: 'The selected class does not belong to the selected branch' };
    }

    // ── Soft-duplicate guard ────────────────────────────────────────
    // Second line of defense for retries that arrive WITHOUT the key: the
    // admin saw a failure, discarded the form, reopened it and refilled
    // it within minutes. The same child in the same class, moments apart,
    // is a resubmit — return the first admission instead of stacking
    // another copy. Guardian name must line up when it is provided, so
    // two genuinely different kids with one common name (twins) are not
    // collapsed into each other by accident.
    if (data.groupId) {
      const since = new Date(Date.now() - 120_000);
      const normalize = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();
      const nameNorm = normalize(data.name);
      const guardianNorm = (data.guardianName || '').trim().replace(/\s+/g, ' ').toLowerCase();
      const recent = await prisma.student.findMany({
        where: {
          groupId: data.groupId,
          academicYearId,
          isActive: true,
          createdAt: { gte: since },
        },
        select: {
          id: true, name: true, studentNumber: true,
          parents: { select: { parent: { select: { user: { select: { name: true } } } } } },
        },
      });
      const twin = recent.find(s => {
        if (normalize(String(s.name ?? '')) !== nameNorm) return false;
        if (!guardianNorm) return true;
        return (s.parents || []).some(
          p => p.parent?.user?.name && normalize(p.parent.user.name) === guardianNorm,
        );
      });
      if (twin) {
        const first = await prisma.student.findFirst({
          where: { id: twin.id },
          include: includeGroup,
        });
        return returnDeduplicated(first);
      }
    }

    // Get next student number from sequence (permanent, never reuses)
    let studentNumber = 1;
    try {
      const seqResult: any = await prisma.$queryRawUnsafe(`SELECT nextval('students_number_seq') AS n`);
      studentNumber = parseInt(seqResult[0]?.n || '1', 10);
    } catch {
      // Fallback when the sequence is unavailable (e.g. a database that has
      // not run the sequence migration). NULLs sort FIRST for DESC in
      // Postgres, so the ordering must be explicit — otherwise this always
      // returns a NULL row and yields studentNumber 1, which collides with
      // the first student that was ever created.
      const maxStudent = await prisma.student.findFirst({
        orderBy: [{ studentNumber: { sort: 'desc', nulls: 'last' } }],
        select: { studentNumber: true },
      });
      studentNumber = (maxStudent?.studentNumber ?? 0) + 1;
    }

    let admissionNumber = data.admissionNumber;
    if (!admissionNumber) {
      // Both `student_persons.admissionNumber` and `students.studentNumber`
      // are unique, and deleted students leave gaps behind. Walk forward
      // until a pair is actually free instead of trusting the counter.
      const allocYear = new Date().getFullYear();
      for (let attempt = 0; attempt < 100; attempt++) {
        const candidate = `MCS-${allocYear}-${String(studentNumber).padStart(4, '0')}`;
        const [personTaken, numberTaken] = await Promise.all([
          prisma.studentPerson.findFirst({ where: { admissionNumber: candidate }, select: { id: true } }),
          prisma.student.findFirst({ where: { studentNumber }, select: { id: true } }),
        ]);
        if (!personTaken && !numberTaken) {
          admissionNumber = candidate;
          break;
        }
        studentNumber += 1;
      }
      if (!admissionNumber) {
        throw { status: 409, message: 'Could not allocate an admission number. Please try again.' };
      }
    }

    // Auto-generate username using studentNumber + admission year
    const admissionYear = data.dateOfBirth
      ? new Date(data.dateOfBirth).getFullYear()
      : new Date().getFullYear();
    const username = generateUsername(data.name, studentNumber, admissionYear);

    // Auto-assign roll number (sequential within the group).
    // MAX + 1, not COUNT + 1: the count ignores gaps and the roll numbers
    // already in use, so it happily hands out a roll that somebody else has
    // and the roll filter then matches two different students.
    let rollNumber = data.rollNumber || undefined;
    if (!rollNumber && data.groupId) {
      const classStudents = await prisma.student.findMany({
        where: { groupId: data.groupId },
        select: { rollNumber: true },
      });
      const taken = new Set(
        classStudents.map(s => s.rollNumber).filter((r): r is string => !!r),
      );
      let maxRoll = 0;
      for (const r of taken) {
        const n = parseInt(r, 10);
        if (Number.isFinite(n) && n > maxRoll) maxRoll = n;
      }
      let candidate = maxRoll + 1;
      while (taken.has(String(candidate))) candidate++;
      rollNumber = String(candidate);
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
        idempotencyKey: rawIdempotencyKey || undefined,
      },
      include: { group: { select: { id: true, name: true, section: true } } },
    }).catch(async (e: any) => {
      // Two requests carrying the same key can interleave between the
      // replay lookup and the insert. The unique index arbitrates: the
      // loser converges on the winner's row instead of surfacing a
      // "That record already exists." for a school operation that
      // actually succeeded.
      if (rawIdempotencyKey && e?.code === 'P2002' && String(e?.meta?.target || '').includes('idempotencyKey')) {
        const winner = await prisma.student.findFirst({
          where: { idempotencyKey: rawIdempotencyKey },
          include: includeGroup,
        });
        if (winner) return returnReplayed(winner as any);
      }
      throw e;
    });

    // Resolve guardian contact. Dedicated guardian* fields win; otherwise fall
    // back to the student's own values so legacy callers (the Add-Student form,
    // which sends ONE set of numbers labelled "Guardian") keep working as before.
    // The student row itself always keeps its own phone/email/whatsapp as-is.
    const guardianPhone = data.guardianPhone?.trim() || data.phone || null;
    const guardianWhatsapp = data.guardianWhatsapp?.trim() || data.studentWhatsapp || null;
    const guardianEmail = data.guardianEmail?.trim() || data.studentEmail || null;

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
            phone: guardianPhone,
            email: guardianEmail,
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
            phone: guardianPhone,
            email: guardianEmail,
            status: 'active',
          },
        });
      }
      try {
        const parentProfile = await prisma.parentProfile.create({
          data: {
            userId: parentUser.id,
            relation: data.guardianRelation || 'Guardian',
            phone: guardianPhone,
            whatsapp: guardianWhatsapp,
            email: guardianEmail,
            cnicNumber: data.guardianCnic?.trim() || null,
            occupation: data.guardianOccupation?.trim() || null,
            employerName: data.guardianEmployerName?.trim() || null,
            maritalStatus: data.guardianMaritalStatus?.trim() || null,
            monthlyIncome: data.guardianMonthlyIncome?.trim() || null,
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
        rollNumber: data.rollNumber,
        admissionDate: data.admissionDate ? new Date(data.admissionDate) : undefined,
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

  // Deactivate for the teachers-style flow: status → WITHDRAWN, login off,
  // audit row written. Idempotent-safe: re-deactivating is a no-op update.
  async deactivateStudent(id: string, changedById?: string) {
    const existing = await prisma.student.findUnique({ where: { id }, select: { id: true, status: true } });
    if (!existing) throw { status: 404, message: 'Student not found' };
    if (existing.status !== 'ACTIVE') {
      throw { status: 400, message: `Student is already ${existing.status.toLowerCase()}` };
    }
    return prisma.$transaction([
      prisma.student.update({ where: { id }, data: { status: 'WITHDRAWN' as any, isActive: false } }),
      prisma.studentStatusLog.create({
        data: { studentId: id, previousStatus: 'ACTIVE', newStatus: 'WITHDRAWN', reason: 'Deactivated by admin', changedById: changedById ?? null },
      }),
    ]).then((rows) => rows[0]);
  }

  // Reactivate: back to ACTIVE with login restored + audit row.
  async reactivateStudent(id: string, changedById?: string) {
    const existing = await prisma.student.findUnique({ where: { id }, select: { id: true, status: true } });
    if (!existing) throw { status: 404, message: 'Student not found' };
    if (existing.status === 'ACTIVE') {
      throw { status: 400, message: 'Student is already active' };
    }
    return prisma.$transaction([
      prisma.student.update({ where: { id }, data: { status: 'ACTIVE' as any, isActive: true } }),
      prisma.studentStatusLog.create({
        data: { studentId: id, previousStatus: existing.status, newStatus: 'ACTIVE', reason: 'Reactivated by admin', changedById: changedById ?? null },
      }),
    ]).then((rows) => rows[0]);
  }

  // Permanent delete — teachers-style guard: only students with ZERO
  // enrollment history (never attended a class) can be removed for real.
  // Everything else stays deactivated forever. All Student relations cascade
  // via the schema (onDelete: Cascade), so removing the row removes the
  // record completely.
  async deleteStudent(id: string) {
    const student = await prisma.student.findUnique({
      where: { id },
      select: {
        id: true, name: true, status: true,
        _count: { select: { enrollments: true, studentFees: true, attendances: true, feePayments: true } },
      },
    });
    if (!student) throw { status: 404, message: 'Student not found' };
    const history =
      (student._count?.enrollments ?? 0) +
      (student._count?.studentFees ?? 0) +
      (student._count?.attendances ?? 0) +
      (student._count?.feePayments ?? 0);
    if (history > 0) {
      throw {
        status: 400,
        message: 'Cannot delete: student has attendance, enrollment, or fee history. Keep them deactivated instead.',
      };
    }
    await prisma.student.delete({ where: { id } });
    return { id: student.id, name: student.name };
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

  // ─── Manual WhatsApp handoff: Save Credential (M21) ───  // Composite save for the Students Operations drawer. Persists the
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
        academicYear: { select: { branchId: true } },
        user: { select: { passwordHash: true } },
        parents: {
          select: {
            isPrimary: true,
            parent: { select: { whatsapp: true, phone: true } },
          },
        },
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
    // Recipient is ALWAYS the parent's number (primary first, whatsapp before
    // phone). The student's own numbers are never used for sending.
    const recipientPhone = pickParentWhatsapp(student.parents);
    if (!recipientPhone) throw { status: 400, code: 'NO_PHONE', message: 'Parent WhatsApp/phone number is required before saving credentials.' };
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
          recipientPhone: prev.recipientPhone || recipientPhone,
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
            recipientPhone,
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
      recipientPhone,
      credentialGeneratedAt: now.toISOString(),
      credentialSentAt: now.toISOString(),
    };
  }
}

export const studentService = new StudentService();
