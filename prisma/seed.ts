/**
 * Database Seed Script — MCS-App v2.0
 *
 * Creates the default school structure:
 *   1. Branch "Mother Care Sohan" (code: MCS-SOHAN)
 *   2. AcademicCalendar "2025-2026" with start/end dates
 *   3. ACTIVE AcademicYear linked to branch + calendar
 *   4. 13 default groups (Playgroup → Class 10) with displayOrder 1-13
 *   5. CEO super_admin user + publishable API key for frontend
 *   6. Branch admin user assigned as Principal at Mother Care Sohan
 *
 * The seed is fully idempotent — running it multiple times produces
 * the same state without duplicates or errors.
 *
 * Usage:
 *   npx ts-node prisma/seed.ts
 */

import { PrismaClient, AcademicYearStatus } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

// ─── Constants ───────────────────────────────────────────────────────────

const DEFAULT_BRANCH_NAME = 'Mother Care Sohan';
const DEFAULT_BRANCH_CODE = 'MCS-SOHAN';
const CALENDAR_LABEL = '2025-2026';
const CALENDAR_START = new Date('2025-08-01T00:00:00+05:00');
const CALENDAR_END = new Date('2026-06-30T00:00:00+05:00');

const DEFAULT_GROUPS = [
  { name: 'Playgroup',       displayOrder: 1  },
  { name: 'Jr Montessori',   displayOrder: 2  },
  { name: 'Adv Montessori',  displayOrder: 3  },
  { name: 'Class 1',         displayOrder: 4  },
  { name: 'Class 2',         displayOrder: 5  },
  { name: 'Class 3',         displayOrder: 6  },
  { name: 'Class 4',         displayOrder: 7  },
  { name: 'Class 5',         displayOrder: 8  },
  { name: 'Class 6',         displayOrder: 9  },
  { name: 'Class 7',         displayOrder: 10 },
  { name: 'Class 8',         displayOrder: 11 },
  { name: 'Class 9',         displayOrder: 12 },
  { name: 'Class 10',        displayOrder: 13 },
];

// ─── Helper: Idempotent find-or-create ───────────────────────────────────

async function ensureBranch(name: string, code: string) {
  const existing = await prisma.branch.findUnique({ where: { code } });
  if (existing) {
    console.log(`  ✓ Branch "${name}" already exists (id: ${existing.id})`);
    return existing;
  }
  const branch = await prisma.branch.create({
    data: { name, code },
  });
  console.log(`  ✓ Created Branch "${name}" (id: ${branch.id})`);
  return branch;
}

async function ensureCalendar(label: string, startDate: Date, endDate: Date) {
  const existing = await prisma.academicCalendar.findUnique({ where: { label } });
  if (existing) {
    console.log(`  ✓ AcademicCalendar "${label}" already exists (id: ${existing.id})`);
    return existing;
  }
  // When creating, if this is the only calendar, make it current
  const count = await prisma.academicCalendar.count();
  const calendar = await prisma.academicCalendar.create({
    data: {
      label,
      startDate,
      endDate,
      isCurrent: count === 0, // First calendar becomes current
    },
  });
  console.log(`  ✓ Created AcademicCalendar "${label}" (id: ${calendar.id}, isCurrent: ${calendar.isCurrent})`);
  return calendar;
}

async function ensureAcademicYear(
  branchId: string,
  calendarId: string,
  status: AcademicYearStatus,
) {
  const existing = await prisma.academicYear.findFirst({
    where: {
      branchId,
      calendarId,
    },
  });
  if (existing) {
    console.log(`  ✓ AcademicYear (${status}) already exists (id: ${existing.id})`);
    return existing;
  }
  const ay = await prisma.academicYear.create({
    data: {
      branchId,
      calendarId,
      status,
    },
  });
  console.log(`  ✓ Created AcademicYear (${status}) (id: ${ay.id})`);
  return ay;
}

async function ensureGroups(academicYearId: string) {
  const existingCount = await prisma.group.count({
    where: { academicYearId },
  });

  if (existingCount > 0) {
    console.log(`  ✓ ${existingCount} groups already exist for AcademicYear ${academicYearId} — skipping`);
    return;
  }

  for (let i = 0; i < DEFAULT_GROUPS.length; i++) {
    const g = DEFAULT_GROUPS[i];
    const group = await prisma.group.create({
      data: {
        academicYearId,
        name: g.name,
        displayOrder: g.displayOrder,
        capacity: 30,
        onlyAdminCanSend: true,
        isActive: true,
      },
    });
    console.log(`  ✓ Created Group "${g.name}" (displayOrder: ${g.displayOrder})`);
  }

  const total = await prisma.group.count({ where: { academicYearId } });
  console.log(`  → Total groups: ${total}`);
}

// ─── Main ────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n🚀 MCS-App Database Seed v2.0\n');

  // Step 1: Branch
  console.log('[1/6] Branch');
  const branch = await ensureBranch(DEFAULT_BRANCH_NAME, DEFAULT_BRANCH_CODE);

  // Step 2: AcademicCalendar
  console.log('\n[2/6] AcademicCalendar');
  const calendar = await ensureCalendar(CALENDAR_LABEL, CALENDAR_START, CALENDAR_END);

  // Step 3: AcademicYear
  console.log('\n[3/6] AcademicYear');
  const academicYear = await ensureAcademicYear(branch.id, calendar.id, 'ACTIVE');

  // Step 4: Default Groups
  console.log('\n[4/6] Default Groups');
  await ensureGroups(academicYear.id);

  // Step 5: CEO Super Admin (global — key manager access)
  console.log('\n[5/6] CEO Super Admin');
  const ceoHash = await bcrypt.hash('Ceo@098765', 12);
  const ceoUser = await prisma.user.upsert({
    where: { email: 'ceo@mothercareschool.com' },
    update: {},
    create: {
      name: 'CEO',
      email: 'ceo@mothercareschool.com',
      username: 'ceo',
      passwordHash: ceoHash,
      role: 'super_admin',
      status: 'active',
    },
  });
  console.log(`  ✓ CEO created: ceo@mothercareschool.com / Ceo@098765`);

  // Assign CEO to branch as branch_admin too (for convenience)
  await prisma.branchMember.upsert({
    where: { branchId_userId: { branchId: branch.id, userId: ceoUser.id } },
    update: { role: 'branch_admin' },
    create: {
      branchId: branch.id,
      userId: ceoUser.id,
      role: 'branch_admin',
    },
  });
  console.log(`  ✓ CEO assigned as branch_admin at "${branch.name}"`);

  // Seed a publishable API key for the frontend
  const apiKeyPrefix = 'pk_mcs_frontend';
  const existingKey = await prisma.apiKey.findFirst({ where: { prefix: apiKeyPrefix } });
  if (!existingKey) {
    const rawKey = 'pk_mcs_frontend_key_2026';
    const bcrypt = await import('bcryptjs');
    const keyHash = await bcrypt.hash(rawKey, 12);
    await prisma.apiKey.create({
      data: {
        name: 'Default Frontend Key',
        type: 'publishable',
        keyHash,
        prefix: apiKeyPrefix,
        createdBy: 'system',
      },
    });
    console.log(`  ✓ Publishable API key created`);
    console.log(`    Raw key (for .env.local): ${rawKey}`);
  } else {
    console.log(`  ✓ Publishable API key already exists`);
  }

  // Step 6: Branch Admin (NOT super_admin — just branch_admin at Mother Care Sohan)
  console.log('\n[6/6] Branch Admin (Mother Care Sohan Principal)');
  const adminHash = await bcrypt.hash('admin123', 12);
  const adminUser = await prisma.user.upsert({
    where: { username: 'admin' },
    update: {},
    create: {
      name: 'Mother Care Admin',
      username: 'admin',
      passwordHash: adminHash,
      role: 'management',
      status: 'active',
    },
  });
  console.log(`  ✓ Branch admin created: admin / admin123 (role: management)`);

  await prisma.branchMember.upsert({
    where: { branchId_userId: { branchId: branch.id, userId: adminUser.id } },
    update: { role: 'branch_admin' },
    create: {
      branchId: branch.id,
      userId: adminUser.id,
      role: 'branch_admin',
    },
  });
  console.log(`  ✓ Branch admin assigned as branch_admin (Principal) at "${branch.name}"`);

  // Summary
  const groupCount = await prisma.group.count({ where: { academicYearId: academicYear.id } });
  console.log('\n─── Seed Summary ───────────────────────────────');
  console.log(`  Branch:           ${branch.name} (${branch.code})`);
  console.log(`  Calendar:         ${calendar.label}`);
  console.log(`  AcademicYear:     ${academicYear.status} (branch: ${branch.code})`);
  console.log(`  Groups created:   ${groupCount}`);
  console.log('');
  console.log('  ── User Credentials ──');
  console.log('  CEO (key-manager, global):');
  console.log('    Email:    ceo@mothercareschool.com');
  console.log('    Password: Ceo@098765');
  console.log('    Role:     super_admin + branch_admin');
  console.log('');
  console.log('  Branch Admin (Mother Care Sohan):');
  console.log('    Username: admin');
  console.log('    Password: admin123');
  console.log('    Role:     management + branch_admin (Principal)');
  console.log('    Note:     NOT super_admin — only this branch');
  console.log('───────────────────────────────────────────────\n');
}

main()
  .catch((e) => {
    console.error('\n❌ Seed failed:', e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
