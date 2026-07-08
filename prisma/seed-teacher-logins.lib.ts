import type { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import {
  DEFAULT_BRANCH_CODE,
  SEED_TEACHER_PORTAL_LOGINS,
  type TeacherPortalLoginSeed,
} from './seed-teacher-logins.config';

export interface SeedTeacherLoginsResult {
  branchId: string;
  academicYearId: string | null;
  teachers: Array<{
    name: string;
    username: string;
    password: string;
    employeeId: string;
    userId: string;
    assignmentsAdded: number;
  }>;
}

async function resolveBranch(prisma: PrismaClient, branchCode = DEFAULT_BRANCH_CODE) {
  const branch =
    (await prisma.branch.findUnique({ where: { code: branchCode } })) ??
    (await prisma.branch.findFirst({ orderBy: { createdAt: 'asc' } }));
  if (!branch) {
    throw new Error(`No branch found (expected code "${branchCode}"). Run the main seed first.`);
  }
  return branch;
}

async function resolveActiveAcademicYear(prisma: PrismaClient, branchId: string) {
  return prisma.academicYear.findFirst({
    where: { branchId, status: 'ACTIVE' },
    orderBy: { createdAt: 'desc' },
  });
}

async function ensureTeacherAssignments(
  prisma: PrismaClient,
  academicYearId: string,
  teacherId: string,
  spec: TeacherPortalLoginSeed,
): Promise<number> {
  if (!spec.groupDisplayOrder) return 0;

  const groupWhere: {
    academicYearId: string;
    displayOrder: number;
    isActive: boolean;
    section?: { equals: string; mode: 'insensitive' } | null;
  } = {
    academicYearId,
    displayOrder: spec.groupDisplayOrder,
    isActive: true,
  };

  if (spec.groupSection) {
    groupWhere.section = { equals: spec.groupSection, mode: 'insensitive' };
  } else {
    groupWhere.section = null;
  }

  const group = await prisma.group.findFirst({
    where: groupWhere,
    include: { groupSubjects: { include: { subject: true } } },
  });
  if (!group || group.groupSubjects.length === 0) return 0;

  let added = 0;

  if (spec.allGroupSubjects) {
    for (const gs of group.groupSubjects) {
      const existing = await prisma.teacherAssignment.findFirst({
        where: {
          academicYearId,
          teacherId,
          groupId: group.id,
          subjectId: gs.subjectId,
        },
      });
      if (existing) continue;

      await prisma.teacherAssignment.create({
        data: {
          academicYearId,
          teacherId,
          groupId: group.id,
          subjectId: gs.subjectId,
          isClassTeacher: Boolean(spec.isClassTeacher && gs.subject.code === 'MATH'),
          role: 'primary',
        },
      });
      added++;
    }
    return added;
  }

  if (!spec.subjectCode) return 0;

  const gs = group.groupSubjects.find((row) => row.subject.code === spec.subjectCode);
  if (!gs) return 0;

  const existing = await prisma.teacherAssignment.findFirst({
    where: {
      academicYearId,
      teacherId,
      groupId: group.id,
      subjectId: gs.subjectId,
    },
  });
  if (existing) return 0;

  await prisma.teacherAssignment.create({
    data: {
      academicYearId,
      teacherId,
      groupId: group.id,
      subjectId: gs.subjectId,
      isClassTeacher: spec.isClassTeacher ?? false,
      role: 'primary',
    },
  });
  return 1;
}

/**
 * Idempotently enables teacher portal login for the five dev teachers:
 * real bcrypt passwords, branch membership, and AY assignments where configured.
 */
export async function seedTeacherPortalLogins(
  prisma: PrismaClient,
  options?: { branchCode?: string; verbose?: boolean },
): Promise<SeedTeacherLoginsResult> {
  const verbose = options?.verbose ?? true;
  const branch = await resolveBranch(prisma, options?.branchCode);
  const academicYear = await resolveActiveAcademicYear(prisma, branch.id);

  const teachers: SeedTeacherLoginsResult['teachers'] = [];

  for (const t of SEED_TEACHER_PORTAL_LOGINS) {
    const passwordHash = await bcrypt.hash(t.password, 12);

    const existingProfile = await prisma.teacherProfile.findUnique({
      where: { employeeId: t.employeeId },
      include: { user: true },
    });

    let userId: string;

    if (existingProfile) {
      userId = existingProfile.userId;
      await prisma.user.update({
        where: { id: userId },
        data: {
          name: t.name,
          username: t.username,
          passwordHash,
          role: 'teacher',
          status: 'active',
        },
      });
      await prisma.teacherProfile.update({
        where: { id: existingProfile.id },
        data: {
          qualification: t.qualification,
          specialization: t.specialization,
          phone: t.phone,
          joiningDate: t.joiningDate ?? existingProfile.joiningDate,
          passwordSetAt: new Date(),
          credentialStatus: 'active',
        },
      });
      if (verbose) {
        console.log(`  ✓ Updated login for ${t.name} (${t.username})`);
      }
    } else {
      const user = await prisma.user.upsert({
        where: { username: t.username },
        update: {
          name: t.name,
          passwordHash,
          role: 'teacher',
          status: 'active',
        },
        create: {
          name: t.name,
          username: t.username,
          passwordHash,
          role: 'teacher',
          status: 'active',
        },
      });
      userId = user.id;

      await prisma.teacherProfile.upsert({
        where: { userId },
        update: {
          employeeId: t.employeeId,
          qualification: t.qualification,
          specialization: t.specialization,
          phone: t.phone,
          joiningDate: t.joiningDate,
          passwordSetAt: new Date(),
          credentialStatus: 'active',
        },
        create: {
          userId,
          employeeId: t.employeeId,
          qualification: t.qualification,
          specialization: t.specialization,
          phone: t.phone,
          joiningDate: t.joiningDate,
          passwordSetAt: new Date(),
          credentialStatus: 'active',
        },
      });
      if (verbose) {
        console.log(`  ✓ Created ${t.name} (${t.username})`);
      }
    }

    await prisma.branchMember.upsert({
      where: { branchId_userId: { branchId: branch.id, userId } },
      update: { role: 'teacher', isActive: true },
      create: { branchId: branch.id, userId, role: 'teacher', isActive: true },
    });

    let assignmentsAdded = 0;
    if (academicYear) {
      assignmentsAdded = await ensureTeacherAssignments(prisma, academicYear.id, userId, t);
      if (verbose && assignmentsAdded > 0) {
        console.log(`    → ${assignmentsAdded} assignment(s) added for ${t.username}`);
      }
    } else if (verbose) {
      console.log(`    ⚠ No ACTIVE academic year — skipped assignments for ${t.username}`);
    }

    teachers.push({
      name: t.name,
      username: t.username,
      password: t.password,
      employeeId: t.employeeId,
      userId,
      assignmentsAdded,
    });
  }

  return {
    branchId: branch.id,
    academicYearId: academicYear?.id ?? null,
    teachers,
  };
}

export function printTeacherLoginSummary(result: SeedTeacherLoginsResult) {
  console.log('\n─── Teacher Portal Logins ───────────────────────');
  for (const t of result.teachers) {
    console.log(`  ${t.name}`);
    console.log(`    username: ${t.username}`);
    console.log(`    password: ${t.password}`);
    console.log(`    employee: ${t.employeeId}`);
  }
  console.log('────────────────────────────────────────────────\n');
}
