import type { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import {
  SEED_STUDENT_PORTAL_LOGINS,
  type StudentPortalLoginSeed,
} from './seed-student-logins.config';
import { DEFAULT_BRANCH_CODE } from './seed-teacher-logins.config';

export interface SeedStudentLoginsResult {
  branchId: string;
  academicYearId: string | null;
  students: Array<{
    label: string;
    studentName: string;
    username: string;
    password: string;
    studentId: string;
    groupLabel: string;
    rollNumber: string | null;
  }>;
  skipped: Array<{ label: string; reason: string }>;
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

async function findStudentForLogin(
  prisma: PrismaClient,
  academicYearId: string,
  spec: StudentPortalLoginSeed,
) {
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
    select: { id: true, name: true, section: true },
  });
  if (!group) return null;

  const student = await prisma.student.findFirst({
    where: {
      academicYearId,
      groupId: group.id,
      name: spec.studentName,
      isActive: true,
      status: 'ACTIVE',
      ...(spec.rollNumber ? { rollNumber: spec.rollNumber } : {}),
    },
    select: {
      id: true,
      name: true,
      rollNumber: true,
      userId: true,
      username: true,
    },
  });

  if (!student) return null;

  const groupLabel = group.section ? `${group.name} — ${group.section}` : group.name;
  return { student, groupLabel };
}

/**
 * Idempotently enables student portal login for dev test accounts:
 * links User(role=student) to existing Student rows in the active AY.
 */
export async function seedStudentPortalLogins(
  prisma: PrismaClient,
  options?: { branchCode?: string; verbose?: boolean },
): Promise<SeedStudentLoginsResult> {
  const verbose = options?.verbose ?? true;
  const branch = await resolveBranch(prisma, options?.branchCode);
  const academicYear = await resolveActiveAcademicYear(prisma, branch.id);

  const students: SeedStudentLoginsResult['students'] = [];
  const skipped: SeedStudentLoginsResult['skipped'] = [];

  if (!academicYear) {
    for (const spec of SEED_STUDENT_PORTAL_LOGINS) {
      skipped.push({ label: spec.label, reason: 'No ACTIVE academic year' });
    }
    if (verbose) {
      console.log('  ⚠ No ACTIVE academic year — skipped all student portal logins');
    }
    return { branchId: branch.id, academicYearId: null, students, skipped };
  }

  for (const spec of SEED_STUDENT_PORTAL_LOGINS) {
    const match = await findStudentForLogin(prisma, academicYear.id, spec);
    if (!match) {
      skipped.push({
        label: spec.label,
        reason: `Student "${spec.studentName}" not found in group order ${spec.groupDisplayOrder}`,
      });
      if (verbose) {
        console.log(`  ⚠ Skipped ${spec.label} — student record not found`);
      }
      continue;
    }

    const { student, groupLabel } = match;
    const passwordHash = await bcrypt.hash(spec.password, 12);

    let userId = student.userId;

    if (userId) {
      await prisma.user.update({
        where: { id: userId },
        data: {
          name: student.name,
          username: spec.username,
          passwordHash,
          role: 'student',
          status: 'active',
        },
      });
      if (verbose) {
        console.log(`  ✓ Updated login for ${spec.label} (${spec.username})`);
      }
    } else {
      const existingUser = await prisma.user.findUnique({ where: { username: spec.username } });
      if (existingUser) {
        await prisma.user.update({
          where: { id: existingUser.id },
          data: {
            name: student.name,
            passwordHash,
            role: 'student',
            status: 'active',
          },
        });
        userId = existingUser.id;
        if (verbose) {
          console.log(`  ✓ Linked existing user ${spec.username} to ${spec.label}`);
        }
      } else {
        const user = await prisma.user.create({
          data: {
            name: student.name,
            username: spec.username,
            passwordHash,
            role: 'student',
            status: 'active',
          },
        });
        userId = user.id;
        if (verbose) {
          console.log(`  ✓ Created login for ${spec.label} (${spec.username})`);
        }
      }
    }

    await prisma.student.update({
      where: { id: student.id },
      data: {
        userId,
        username: spec.username,
        credentialTag: 'CRED_NEW',
        credentialGeneratedAt: new Date(),
        passwordSetAt: new Date(),
        credentialStatus: 'active',
      },
    });

    students.push({
      label: spec.label,
      studentName: student.name,
      username: spec.username,
      password: spec.password,
      studentId: student.id,
      groupLabel,
      rollNumber: student.rollNumber,
    });
  }

  return {
    branchId: branch.id,
    academicYearId: academicYear.id,
    students,
    skipped,
  };
}

export function printStudentLoginSummary(result: SeedStudentLoginsResult) {
  console.log('\n─── Student Portal Logins ───────────────────────');
  for (const s of result.students) {
    console.log(`  ${s.label}`);
    console.log(`    class:    ${s.groupLabel}${s.rollNumber ? ` (roll ${s.rollNumber})` : ''}`);
    console.log(`    username: ${s.username}`);
    console.log(`    password: ${s.password}`);
  }
  if (result.skipped.length > 0) {
    console.log('\n  Skipped:');
    for (const row of result.skipped) {
      console.log(`    - ${row.label}: ${row.reason}`);
    }
  }
  console.log('────────────────────────────────────────────────\n');
}
