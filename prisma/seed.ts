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

const DEFAULT_SUBJECTS = [
  { name: 'Mathematics', code: 'MATH' },
  { name: 'English',     code: 'ENG' },
  { name: 'Urdu',        code: 'URD' },
  { name: 'Science',     code: 'SCI' },
  { name: 'Physics',     code: 'PHY' },
  { name: 'Chemistry',   code: 'CHEM' },
  { name: 'Computer',    code: 'CS' },
];

const DEFAULT_TEACHERS = [
  { name: 'Ms. Fatima Ali',   username: 'fatima_teacher',   empId: 'TCH-001', qual: 'M.Sc. Mathematics',   spec: 'Mathematics' },
  { name: 'Mr. Usman Khan',   username: 'usman_teacher',   empId: 'TCH-002', qual: 'M.A. English',         spec: 'English Literature' },
  { name: 'Ms. Ayesha Ahmed', username: 'ayesha_teacher',  empId: 'TCH-003', qual: 'M.Sc. Physics',        spec: 'Physics' },
];

const TIMETABLE_SLOTS = [
  { lecture: 1, start: '08:00', end: '08:40' },
  { lecture: 2, start: '08:40', end: '09:20' },
  { lecture: 3, start: '09:30', end: '10:10' },
  { lecture: 4, start: '10:10', end: '10:50' },
  { lecture: 5, start: '11:00', end: '11:40' },
];

const DATESHEET_PAPERS = [
  { day: 1, lecture: 1, start: '09:00', end: '12:00' },
  { day: 1, lecture: 2, start: '14:00', end: '17:00' },
  { day: 3, lecture: 3, start: '09:00', end: '12:00' },
  { day: 3, lecture: 4, start: '14:00', end: '17:00' },
  { day: 5, lecture: 5, start: '09:00', end: '12:00' },
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

async function ensureSubjects(academicYearId: string) {
  let created = 0;
  for (const sub of DEFAULT_SUBJECTS) {
    const existing = await prisma.subject.findFirst({ where: { academicYearId, name: sub.name } });
    if (!existing) {
      await prisma.subject.create({
        data: { academicYearId, name: sub.name, code: sub.code },
      });
      created++;
    }
  }
  console.log(`  ✓ ${created} subjects created (${DEFAULT_SUBJECTS.length - created} already exist)`);
}

async function ensureTeachers() {
  for (const t of DEFAULT_TEACHERS) {
    const existing = await prisma.teacherProfile.findUnique({ where: { employeeId: t.empId } });
    if (existing) continue;
    const user = await prisma.user.upsert({
      where: { username: t.username },
      update: {},
      create: { name: t.name, username: t.username, passwordHash: '$2a$12$placeholder', role: 'teacher', status: 'active' },
    });
    await prisma.teacherProfile.create({
      data: { userId: user.id, employeeId: t.empId, qualification: t.qual, specialization: t.spec, phone: '+92 300 0000000' },
    });
  }
  console.log(`  ✓ ${DEFAULT_TEACHERS.length} teachers ensured`);
}

async function ensureTimetable(academicYearId: string, name: string, type: string, slots: any[], activeDays: number[]) {
  let tt = await prisma.timetable.findUnique({ where: { academicYearId_name: { academicYearId, name } } });
  if (!tt) {
    tt = await prisma.timetable.create({ data: { academicYearId, name, type } });
  }
  // Day configs
  for (const d of activeDays) {
    await prisma.timetableDayConfig.upsert({
      where: { timetableId_dayOfWeek: { timetableId: tt.id, dayOfWeek: d } },
      create: { timetableId: tt.id, dayOfWeek: d, isActive: true },
      update: {},
    });
  }
  // Slots
  for (const s of slots) {
    const exists = await prisma.timetableSlot.findFirst({
      where: { timetableId: tt.id, lectureNumber: s.lecture, dayOfWeek: (s as any).day || null },
    });
    if (!exists) {
      await prisma.timetableSlot.create({
        data: { timetableId: tt.id, lectureNumber: s.lecture, startTime: s.start, endTime: s.end, dayOfWeek: (s as any).day || null },
      });
    }
  }
  const slotCount = await prisma.timetableSlot.count({ where: { timetableId: tt.id } });
  console.log(`  ✓ "${name}" (${type}): ${slotCount} slots, ${activeDays.length} active days`);
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
  // Use a known dev key so .env.local can be pre-configured
  const devRawKey = 'pk_mcs_global_dev_a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6';
  const devPrefix = 'pk_mcs_global_dev';
  const existingKey = await prisma.apiKey.findFirst({ where: { prefix: devPrefix } });
  if (!existingKey) {
    const bcrypt = await import('bcryptjs');
    const keyHash = await bcrypt.hash(devRawKey, 12);
    await prisma.apiKey.create({
      data: {
        name: 'Default Frontend Key (Global)',
        type: 'publishable',
        keyHash,
        prefix: devPrefix,
        createdBy: 'system',
      },
    });
    console.log(`  ✓ Publishable API key created`);
    console.log(`    Key: ${devRawKey}`);
    console.log(`    Add to frontend .env.local:`);
    console.log(`    NEXT_PUBLIC_PUBLISHABLE_KEY=${devRawKey}`);
  } else {
    console.log(`  ✓ Publishable API key already exists`);
  }

  // Seed a secret API key for server-to-server admin calls
  const devSecretKey = 'sk_mcs_global_dev_a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6';
  const devSecretPrefix = 'sk_mcs_global_dev';
  const existingSecretKey = await prisma.apiKey.findFirst({ where: { prefix: devSecretPrefix } });
  if (!existingSecretKey) {
    const bcrypt2 = await import('bcryptjs');
    const keyHash = await bcrypt2.hash(devSecretKey, 12);
    await prisma.apiKey.create({
      data: {
        name: 'Default Secret Key (Global)',
        type: 'secret',
        keyHash,
        prefix: devSecretPrefix,
        createdBy: 'system',
      },
    });
    console.log(`  ✓ Secret API key created`);
    console.log(`    Key: ${devSecretKey}`);
    console.log(`    Add to frontend .env.local (server-side only):`);
    console.log(`    SECRET_KEY=${devSecretKey}`);
  } else {
    console.log(`  ✓ Secret API key already exists`);
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

  // Step 7: Subjects
  console.log('\n[7/13] Subjects');
  await ensureSubjects(academicYear.id);

  // Step 8: Teachers
  console.log('\n[8/13] Teachers');
  await ensureTeachers();

  // Step 9: Timetable
  console.log('\n[9/13] Timetable');
  await ensureTimetable(academicYear.id, 'Regular Timetable', 'timetable', TIMETABLE_SLOTS, [1,2,3,4,5,6]);

  // Step 10: Date Sheet
  console.log('\n[10/13] Date Sheet');
  await ensureTimetable(academicYear.id, 'Final Exams', 'datesheet', DATESHEET_PAPERS, [1,2,3]);

  // Step 11: Section Subjects (link subjects to Class 1-10 groups)
  console.log('\n[11/13] Section Subjects');
  const groups = await prisma.group.findMany({ where: { academicYearId: academicYear.id, isActive: true } });
  const subjects = await prisma.subject.findMany({ where: { academicYearId: academicYear.id } });
  let links = 0;
  for (const group of groups) {
    const orderNum = group.displayOrder;
    // Assign Math, English, Urdu to all classes; Science for Class 1-5; Physics/Chem for Class 6-10
    const groupSubjects = subjects.filter(s => {
      if (s.code === 'MATH' || s.code === 'ENG' || s.code === 'URD') return true;
      if (orderNum <= 8 && s.code === 'SCI') return true;
      if (orderNum >= 9 && (s.code === 'PHY' || s.code === 'CHEM')) return true;
      return false;
    });
    for (const sub of groupSubjects) {
      const exists = await prisma.groupSubject.findUnique({ where: { groupId_subjectId: { groupId: group.id, subjectId: sub.id } } });
      if (!exists) {
        await prisma.groupSubject.create({ data: { groupId: group.id, subjectId: sub.id } });
        links++;
      }
    }
  }
  console.log(`  ✓ ${links} subject-group links created`);

  // ─── Step 12: Demo Students + Random Attendance ─────────────────────
  console.log('\n[12/13] Demo Students + Attendance (last 30 days)');

  const demoGroup = await prisma.group.findFirst({
    where: { academicYearId: academicYear.id, displayOrder: 1, isActive: true },
  });
  if (demoGroup) {
    const existingStudents = await prisma.student.count({ where: { groupId: demoGroup.id } });
    if (existingStudents < 20) {
      const DEMO_STUDENTS = [
        'Ahmed', 'Ali', 'Sara', 'Fatima', 'Hassan',
        'Ayesha', 'Usman', 'Zainab', 'Omar', 'Hira',
        'Bilal', 'Mariam', 'Hamza', 'Sana', 'Taha',
        'Noor', 'Ibrahim', 'Khadija', 'Rayan', 'Amina',
      ];

      // Get max existing studentNumber to continue from
      let maxSN = await prisma.student.findFirst({ orderBy: { studentNumber: 'desc' }, select: { studentNumber: true } });
      let nextSN = (maxSN?.studentNumber ?? 300) + 1;
      let nextAdm = nextSN;

      const studentsToCreate = DEMO_STUDENTS.map((name, i) => ({
        academicYearId: academicYear.id,
        groupId: demoGroup.id,
        name,
        rollNumber: String(i + 1),
        admissionNumber: `ADM-${nextAdm + i}`,
        studentNumber: nextSN + i,
        isActive: true,
        status: 'ACTIVE' as any,
        gender: (['male','female','male','female','male','female','male','female','male','female','male','female','male','female','male','female','male','female','male','female'] as any)[i],
      }));

      for (const data of studentsToCreate) {
        await prisma.student.upsert({
          where: { admissionNumber: data.admissionNumber },
          update: {},
          create: data,
        });
      }
      console.log(`  ✓ ${DEMO_STUDENTS.length} demo students created in "${demoGroup.name}"`);
    } else {
      console.log(`  ✓ ${existingStudents} students already exist in "${demoGroup.name}" — skipping creation`);
    }

    // ── Assign random attendance for last 30 days ──
    const allStudents = await prisma.student.findMany({
      where: { groupId: demoGroup.id, isActive: true },
      select: { id: true },
    });

    if (allStudents.length > 0) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const STATUSES = ['present', 'present', 'present', 'present', 'present', 'absent', 'late']; // ~71% P, ~14% A, ~14% L
      const seededRandom = (seed: number) => {
        const x = Math.sin(seed * 9301 + 49297) * 49297;
        return x - Math.floor(x);
      };

      let totalAtt = 0;
      for (const student of allStudents) {
        for (let dayOffset = 29; dayOffset >= 0; dayOffset--) {
          const d = new Date(today);
          d.setDate(d.getDate() - dayOffset);
          const status = STATUSES[Math.floor(seededRandom(student.id.charCodeAt(0) * 1000 + dayOffset * 7 + student.id.charCodeAt(student.id.length - 1)) * STATUSES.length)];

          await prisma.attendance.upsert({
            where: { studentId_date: { studentId: student.id, date: d } },
            update: { status },
            create: {
              studentId: student.id,
              academicYearId: academicYear.id,
              date: d,
              status,
            },
          });
          totalAtt++;
        }
      }
      console.log(`  ✓ ${totalAtt} attendance records created for ${allStudents.length} students over 30 days`);
    }
  } else {
    console.log('  ⚠ No group with displayOrder 1 found — skipping demo data');
  }

  // ─── Step 13: Teacher Assignment + Timetable Entries for Playgroup ──
  console.log('\n[13/13] Teacher Assignment + Timetable Entries for Playgroup');

  const playgroup = await prisma.group.findFirst({
    where: { academicYearId: academicYear.id, displayOrder: 1, isActive: true },
    include: {
      groupSubjects: { include: { subject: true } },
    },
  });

  if (playgroup && playgroup.groupSubjects.length > 0) {
    // Create a new teacher
    const TEACHER_NAME = 'Ms. Samina Hassan';
    const TEACHER_UNAME = 'samina_playgroup';

    const existingTeacher = await prisma.user.findUnique({ where: { username: TEACHER_UNAME } });
    if (!existingTeacher) {
      const passHash = await bcrypt.hash('teacher123', 12);
      const user = await prisma.user.create({
        data: {
          name: TEACHER_NAME,
          username: TEACHER_UNAME,
          passwordHash: passHash,
          role: 'teacher',
          status: 'active',
        },
      });

      await prisma.teacherProfile.create({
        data: {
          userId: user.id,
          employeeId: 'TCH-004',
          qualification: 'B.Ed. (Early Childhood Education)',
          specialization: 'Playgroup Lead',
          phone: '+92 300 1111111',
          joiningDate: new Date('2025-08-01'),
        },
      });
      console.log(`  ✓ Created teacher "${TEACHER_NAME}" (${TEACHER_UNAME} / teacher123)`);

      // Add as group member of Playgroup
      await prisma.groupMember.upsert({
        where: { groupId_userId: { groupId: playgroup.id, userId: user.id } },
        update: { role: 'teacher' },
        create: { groupId: playgroup.id, userId: user.id, role: 'teacher' },
      });
      console.log(`  ✓ Added "${TEACHER_NAME}" as member of "${playgroup.name}"`);

      // Create TeacherAssignment for each subject
      for (const gs of playgroup.groupSubjects) {
        await prisma.teacherAssignment.create({
          data: {
            academicYearId: academicYear.id,
            teacherId: user.id,
            groupId: playgroup.id,
            subjectId: gs.subjectId,
            isClassTeacher: gs.subject.code === 'MATH',
            role: 'primary',
          },
        });
      }
      console.log(`  ✓ ${playgroup.groupSubjects.length} subject assignments created for "${TEACHER_NAME}"`);

      // Get timetable + slots
      const tt = await prisma.timetable.findFirst({
        where: { academicYearId: academicYear.id, type: 'timetable', isActive: true },
      });
      if (tt) {
        const slots = await prisma.timetableSlot.findMany({
          where: { timetableId: tt.id, isActive: true },
          orderBy: { lectureNumber: 'asc' },
        });

        // Assign subjects to slots: Math→1, English→2, Urdu→3, Science→4, Math→5
        const slotSubjects: { slotId: string; subjectId: string }[] = [];
        const subjectMap = new Map(playgroup.groupSubjects.map(gs => [gs.subject.code, gs.subjectId]));
        const subjectCycle = ['MATH', 'ENG', 'URD', 'SCI', 'MATH'];

        let created = 0;
        for (let i = 0; i < slots.length; i++) {
          const code = subjectCycle[i] || 'MATH';
          const subId = subjectMap.get(code);
          if (!subId) continue;

          // Use upsert to handle re-runs
          await prisma.timetableEntry.upsert({
            where: { slotId_groupId: { slotId: slots[i].id, groupId: playgroup.id } },
            update: { subjectId: subId, teacherId: user.id },
            create: {
              slotId: slots[i].id,
              groupId: playgroup.id,
              subjectId: subId,
              teacherId: user.id,
            },
          });
          created++;
        }
        console.log(`  ✓ ${created} timetable entries created for "${playgroup.name}"`);
      }
    } else {
      console.log(`  ✓ Teacher "${TEACHER_NAME}" already exists — skipping`);
    }
  } else {
    console.log('  ⚠ Playgroup not found or has no subjects — skipping teacher assignment');
  }

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
