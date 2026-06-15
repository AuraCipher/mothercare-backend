import { prisma } from '../../../lib/prisma';
import { storage } from '../../upload/storage.service';

export interface CreateStudentInput {
  name: string;
  gender?: 'male' | 'female' | 'other';
  dateOfBirth?: string;
  religion?: string;
  nationality?: string;
  address?: string;
  city?: string;
  postalCode?: string;
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
    page?: number;
    limit?: number;
  }) {
    const { search, groupId, academicYearId, page = 1, limit = 20 } = params;
    const skip = (page - 1) * limit;
    const where: any = {};
    if (groupId) where.groupId = groupId;
    if (academicYearId) where.academicYearId = academicYearId;
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
        phone: data.phone, bloodGroup: data.bloodGroup,
        bformCnic: data.bformCnic, motherTongue: data.motherTongue,
        studentEmail: data.studentEmail, studentWhatsapp: data.studentWhatsapp,
        previousSchool: data.previousSchool, previousClass: data.previousClass,
        tcNumber: data.tcNumber, referredBy: data.referredBy,
        groupId: data.groupId, academicYearId, admissionNumber,
        profilePhotoId: data.profilePhotoId,
      },
      include: { group: { select: { id: true, name: true, section: true } } },
    });
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
        phone: data.phone, bloodGroup: data.bloodGroup,
        bformCnic: data.bformCnic, motherTongue: data.motherTongue,
        studentEmail: data.studentEmail, studentWhatsapp: data.studentWhatsapp,
        previousSchool: data.previousSchool, previousClass: data.previousClass,
        tcNumber: data.tcNumber, referredBy: data.referredBy,
        groupId: data.groupId, admissionNumber: data.admissionNumber,
        profilePhotoId: data.profilePhotoId,
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
}

export const studentService = new StudentService();
