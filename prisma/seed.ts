/**
 * Database Seed Script — MCS-App v2.0
 *
 * Creates the default school structure:
 *   1. Branch "Mother Care Sohan" (code: MCS-SOHAN)
 *   2. AcademicCalendar "2025-2026" with start/end dates
 *   3. ACTIVE AcademicYear linked to branch + calendar
 *   4. 13 default groups (Playgroup → Class 10) with displayOrder 1-13
 *
 * The seed is fully idempotent — running it multiple times produces
 * the same state without duplicates or errors.
 *
 * Usage:
 *   npx ts-node prisma/seed.ts
 */

import { PrismaClient, AcademicYearStatus } from '@prisma/client';

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
  console.log('[1/4] Branch');
  const branch = await ensureBranch(DEFAULT_BRANCH_NAME, DEFAULT_BRANCH_CODE);

  // Step 2: AcademicCalendar
  console.log('\n[2/4] AcademicCalendar');
  const calendar = await ensureCalendar(CALENDAR_LABEL, CALENDAR_START, CALENDAR_END);

  // Step 3: AcademicYear
  console.log('\n[3/4] AcademicYear');
  const academicYear = await ensureAcademicYear(branch.id, calendar.id, 'ACTIVE');

  // Step 4: Default Groups
  console.log('\n[4/4] Default Groups');
  await ensureGroups(academicYear.id);

  // Summary
  console.log('\n─── Seed Summary ───────────────────────────────');
  console.log(`  Branch:           ${branch.name} (${branch.code})`);
  console.log(`  Calendar:         ${calendar.label}`);
  console.log(`  AcademicYear:     ${academicYear.status} (branch: ${branch.code})`);
  const groupCount = await prisma.group.count({ where: { academicYearId: academicYear.id } });
  console.log(`  Groups created:   ${groupCount}`);
  console.log('───────────────────────────────────────────────\n');
}

main()
  .catch((e) => {
    console.error('\n❌ Seed failed:', e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
