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
  { name: 'Computer Science', code: 'CSC' },
  { name: 'Islamiyat',   code: 'ISL' },
  { name: 'Quran',       code: 'QRN' },
  { name: 'Biology',     code: 'BIO' },
  { name: 'Arts',        code: 'ART' },
];

const DEFAULT_TEACHERS = [
  { name: 'Ms. Fatima Ali',   username: 'fatima_teacher',   empId: 'TCH-001', qual: 'M.Sc. Mathematics',   spec: 'Mathematics' },
  { name: 'Mr. Usman Khan',   username: 'usman_teacher',   empId: 'TCH-002', qual: 'M.A. English',         spec: 'English Literature' },
  { name: 'Ms. Ayesha Ahmed', username: 'ayesha_teacher',  empId: 'TCH-003', qual: 'M.Sc. Physics',        spec: 'Physics' },
];

const TIMETABLE_SLOTS = [
  { lecture: 1, start: '08:00', end: '08:40' },
  { lecture: 2, start: '08:40', end: '09:30' },
  { lecture: 3, start: '09:30', end: '10:10' },
  { lecture: 4, start: '10:10', end: '10:50' },
  { lecture: 5, start: '10:50', end: '11:30' },
  { lecture: 6, start: '11:30', end: '12:00', isBreak: true },
  { lecture: 7, start: '12:00', end: '12:40' },
  { lecture: 8, start: '12:40', end: '13:30' },
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
    await prisma.timetableSlot.upsert({
      where: { timetableId_lectureNumber: { timetableId: tt.id, lectureNumber: s.lecture } },
      update: { startTime: s.start, endTime: s.end },
      create: {
        timetableId: tt.id,
        lectureNumber: s.lecture,
        startTime: s.start,
        endTime: s.end,
        dayOfWeek: (s as any).day || null,
      },
    });
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
  console.log('\n[7/15] Subjects');
  await ensureSubjects(academicYear.id);

  // Step 8: Teachers
  console.log('\n[8/15] Teachers');
  await ensureTeachers();

  // Step 9: Timetable
  console.log('\n[9/15] Timetable');
  await ensureTimetable(academicYear.id, 'Regular Timetable', 'timetable', TIMETABLE_SLOTS, [1,2,3,4,5,6]);

  // Step 10: Date Sheet
  console.log('\n[10/15] Date Sheet');
  await ensureTimetable(academicYear.id, 'Final Exams', 'datesheet', DATESHEET_PAPERS, [1,2,3]);

  // Step 11: Section Subjects (link subjects to Class 1-10 groups)
  console.log('\n[11/15] Section Subjects');
  const groups = await prisma.group.findMany({ where: { academicYearId: academicYear.id, isActive: true } });
  const subjects = await prisma.subject.findMany({ where: { academicYearId: academicYear.id } });
  let links = 0;
  for (const group of groups) {
    const orderNum = group.displayOrder;
    // Assign subjects per class level
    const groupSubjects = subjects.filter(s => {
      const c = s.code || '';
      if (['MATH','ENG','URD','ISL','QRN'].includes(c)) return true;          // All classes
      if (orderNum <= 8 && ['SCI','ART'].includes(c)) return true;             // Playgroup - Class 5
      if (orderNum >= 9 && (['PHY','CHEM','BIO','CSC'].includes(c))) return true; // Class 6-10
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
  console.log('\n[12/15] Demo Students + Attendance (last 30 days)');

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

  // ─── Step 13: Teacher Assignment + Timetable Entries per Class ──
  console.log('\n[13/15] Teacher Assignment + Timetable Entries per Class');

  async function assignTeacherToGroup(
    groupOrder: number,
    teacherName: string,
    username: string,
    empId: string,
    qual: string,
    spec: string,
    empPhone: string,
    subjectCycle: (string | null)[],
  ) {
    const group = await prisma.group.findFirst({
      where: { academicYearId: academicYear.id, displayOrder: groupOrder, isActive: true },
      include: { groupSubjects: { include: { subject: true } } },
    });
    if (!group || group.groupSubjects.length === 0) {
      console.log(`  ⚠ Group order ${groupOrder} not found or has no subjects — skipping`);
      return;
    }

    let teacherId = (await prisma.user.findUnique({ where: { username }, select: { id: true } }))?.id;
    if (!teacherId) {
      const hash = await bcrypt.hash('teacher123', 12);
      const user = await prisma.user.create({
        data: { name: teacherName, username, passwordHash: hash, role: 'teacher', status: 'active' },
      });
      teacherId = user.id;

      await prisma.teacherProfile.create({
        data: {
          userId: user.id, employeeId: empId, qualification: qual,
          specialization: spec, phone: empPhone, joiningDate: new Date('2025-08-01'),
        },
      });
      console.log(`  ✓ Created "${teacherName}" (${username} / teacher123)`);

      await prisma.groupMember.upsert({
        where: { groupId_userId: { groupId: group.id, userId: user.id } },
        update: { role: 'teacher' },
        create: { groupId: group.id, userId: user.id, role: 'teacher' },
      });

      for (const gs of group.groupSubjects) {
        await prisma.teacherAssignment.create({
          data: {
            academicYearId: academicYear.id, teacherId: user.id, groupId: group.id,
            subjectId: gs.subjectId, isClassTeacher: gs.subject.code === 'MATH', role: 'primary',
          },
        });
      }
      console.log(`  ✓ ${group.groupSubjects.length} subject assignments for "${group.name}"`);
    } else {
      // Update name in case it changed
      await prisma.user.update({ where: { id: teacherId }, data: { name: teacherName } });
      console.log(`  ✓ Teacher "${teacherName}" already exists — updating entries`);
    }

    // Always upsert timetable entries
    const tt = await prisma.timetable.findFirst({
      where: { academicYearId: academicYear.id, type: 'timetable', isActive: true },
    });
    if (tt && teacherId) {
      const slots = await prisma.timetableSlot.findMany({
        where: { timetableId: tt.id, isActive: true },
        orderBy: { lectureNumber: 'asc' },
      });
      const subjectMap = new Map(group.groupSubjects.map(gs => [gs.subject.code, gs.subjectId]));

      let count = 0;
      for (let i = 0; i < slots.length; i++) {
        const code = subjectCycle[i];
        if (!code) continue;
        const subId = subjectMap.get(code);
        if (!subId) continue;
        await prisma.timetableEntry.upsert({
          where: { slotId_groupId: { slotId: slots[i].id, groupId: group.id } },
          update: { subjectId: subId, teacherId, note: null },
          create: { slotId: slots[i].id, groupId: group.id, subjectId: subId, teacherId },
        });
        count++;
      }
      console.log(`  ✓ ${count} timetable entries assigned for "${group.name}"`);
    }
  }

  const pgCycle: (string | null)[] = ['MATH', 'ENG', 'URD', 'SCI', 'ISL', null, 'QRN', 'ART'];

  await assignTeacherToGroup(
    1, 'Ms. Samina Akhtar', 'samina_playgroup', 'TCH-004',
    'B.Ed. (Early Childhood Education)', 'Playgroup Lead', '+92 300 1111111',
    pgCycle,
  );

  await assignTeacherToGroup(
    2, 'Ms. Amina Khan', 'amina_jr_mont', 'TCH-005',
    'B.Ed. (Montessori)', 'Jr Montessori Lead', '+92 300 2222222',
    pgCycle,
  );

  await assignTeacherToGroup(
    3, 'Mr. Imran Ali', 'imran_adv_mont', 'TCH-006',
    'B.Ed. (Advanced Montessori)', 'Adv Montessori Lead', '+92 300 3333333',
    pgCycle,
  );

  // ─── Step 14: Timetable Entries for All Classes ─────────────────────
  console.log('\n[14/15] Timetable Entries for All Classes');

  const allGroups = await prisma.group.findMany({ where: { academicYearId: academicYear.id, isActive: true } });
  const mainTt = await prisma.timetable.findFirst({
    where: { academicYearId: academicYear.id, type: 'timetable', isActive: true },
  });

  if (mainTt && allGroups.length > 0) {
    const ttSlots = await prisma.timetableSlot.findMany({
      where: { timetableId: mainTt.id, isActive: true },
      orderBy: { lectureNumber: 'asc' },
    });

    let totalEntries = 0;
    for (const group of allGroups) {
      for (const slot of ttSlots) {
        const slotDef = TIMETABLE_SLOTS.find(s => s.lecture === slot.lectureNumber);
        const isBreak = slotDef?.isBreak;

        await prisma.timetableEntry.upsert({
          where: { slotId_groupId: { slotId: slot.id, groupId: group.id } },
          update: { note: isBreak ? 'break' : undefined },
          create: {
            slotId: slot.id,
            groupId: group.id,
            note: isBreak ? 'break' : null,
          },
        });
        totalEntries++;
      }
    }
    console.log(`  ✓ ${totalEntries} timetable entries created for ${allGroups.length} groups (${ttSlots.length} slots each)`);
  } else {
    console.log('  ⚠ No timetable or groups found — skipping all-class timetable entries');
  }

  // ─── Step 15: Class 1–10 Teachers + Split Lectures ──────────────
  console.log('\n[15/15] Class 1–10 Teachers & Split Lectures');

  // 10 class head teachers + 3 subject specialists = 13 new teachers
  const CLASS_TEACHERS = [
    // class heads (one per class, displayOrder 4–13)
    { order: 4,  name: 'Ms. Sana Tariq',     uname: 'sana_class1',   emp: 'TCH-101', qual: 'B.Ed. (Primary)',          spec: 'Class 1 Head' },
    { order: 5,  name: 'Mr. Kamran Haider',   uname: 'kamran_class2', emp: 'TCH-102', qual: 'B.Ed. (Primary)',          spec: 'Class 2 Head' },
    { order: 6,  name: 'Ms. Rabia Anwar',     uname: 'rabia_class3',  emp: 'TCH-103', qual: 'B.Ed. (Primary)',          spec: 'Class 3 Head' },
    { order: 7,  name: 'Mr. Tariq Mehmood',   uname: 'tariq_class4',  emp: 'TCH-104', qual: 'B.Ed. (Primary)',          spec: 'Class 4 Head' },
    { order: 8,  name: 'Ms. Noreen Akhtar',   uname: 'noreen_class5', emp: 'TCH-105', qual: 'B.Ed. (Primary)',          spec: 'Class 5 Head' },
    { order: 9,  name: 'Mr. Fahad Ali',       uname: 'fahad_class6',  emp: 'TCH-106', qual: 'M.Sc. (Physics)',          spec: 'Class 6 Head' },
    { order: 10, name: 'Ms. Bushra Ansari',   uname: 'bushra_class7', emp: 'TCH-107', qual: 'M.Sc. (Chemistry)',        spec: 'Class 7 Head' },
    { order: 11, name: 'Mr. Danish Iqbal',    uname: 'danish_class8', emp: 'TCH-108', qual: 'M.A. (English)',           spec: 'Class 8 Head' },
    { order: 12, name: 'Ms. Farzana Kausar',  uname: 'farzana_class9',emp: 'TCH-109', qual: 'M.Sc. (Mathematics)',      spec: 'Class 9 Head' },
    { order: 13, name: 'Mr. Junaid Akram',    uname: 'junaid_class10',emp: 'TCH-110', qual: 'M.A. (Urdu)',              spec: 'Class 10 Head' },
    // subject specialists
    { order: 0,  name: 'Ms. Hina Rizvi',      uname: 'hina_spec',    emp: 'TCH-111', qual: 'M.A. (Islamic Studies)',   spec: 'Islamiyat & Quran' },
    { order: 0,  name: 'Mr. Shahid Mehmood',  uname: 'shahid_sci',   emp: 'TCH-112', qual: 'M.Sc. (General Science)',  spec: 'Science & Math' },
    { order: 0,  name: 'Ms. Farah Deeba',     uname: 'farah_lang',   emp: 'TCH-113', qual: 'M.A. (English Literature)', spec: 'Languages' },
  ];

  // Build teacher users & profiles, collect IDs
  const teacherIds: Record<string, string> = {};
  for (const t of CLASS_TEACHERS) {
    const existing = await prisma.user.findUnique({ where: { username: t.uname }, select: { id: true } });
    if (existing) {
      await prisma.user.update({ where: { id: existing.id }, data: { name: t.name } });
      teacherIds[t.uname] = existing.id;
    } else {
      const hash = await bcrypt.hash('teacher123', 12);
      const user = await prisma.user.create({
        data: { name: t.name, username: t.uname, passwordHash: hash, role: 'teacher', status: 'active' },
      });
      await prisma.teacherProfile.create({
        data: { userId: user.id, employeeId: t.emp, qualification: t.qual, specialization: t.spec, phone: '+92 300 4444444', joiningDate: new Date('2025-08-01') },
      });
      teacherIds[t.uname] = user.id;
    }
  }
  console.log(`  ✓ ${CLASS_TEACHERS.length} teachers ensured`);

  // Collect all groups by displayOrder
  const classGroups = await prisma.group.findMany({
    where: { academicYearId: academicYear.id, displayOrder: { gte: 4, lte: 13 }, isActive: true },
    include: { groupSubjects: { include: { subject: true } } },
  });
  // Deduplicate by displayOrder (pick first one)
  const seenOrders = new Set<number>();
  const uniqueGroups = classGroups.filter(g => { if (seenOrders.has(g.displayOrder)) return false; seenOrders.add(g.displayOrder); return true; }).sort((a, b) => a.displayOrder - b.displayOrder);

  // Get timetable slots
  const tt = await prisma.timetable.findFirst({ where: { academicYearId: academicYear.id, type: 'timetable', isActive: true } });
  if (!tt || uniqueGroups.length === 0) { console.log('  ⚠ No timetable or classes found — skipping'); } else {
    const ttSlots = await prisma.timetableSlot.findMany({ where: { timetableId: tt.id, isActive: true }, orderBy: { lectureNumber: 'asc' } });
    const subjectMap = new Map<string, string>();
    for (const g of uniqueGroups) {
      for (const gs of g.groupSubjects) subjectMap.set(`${g.id}::${gs.subject.code}`, gs.subjectId);
    }

    // ── Class head teachers ─────────────────────────────────────
    // Each head teaches in their OWN class at L1, L2, L3, L8 → no slot conflicts
    const headAssignments = [
      // Class 1–5: MATH@L1, ENG@L2, URD@L3, ART@L5
      { classOrder: 4,  slots: [1,2,3,5], subjects: ['MATH','ENG','URD','ART'] },
      { classOrder: 5,  slots: [1,2,3,5], subjects: ['MATH','ENG','URD','ART'] },
      { classOrder: 6,  slots: [1,2,3,5], subjects: ['MATH','ENG','URD','ART'] },
      { classOrder: 7,  slots: [1,2,3,5], subjects: ['MATH','ENG','URD','ART'] },
      { classOrder: 8,  slots: [1,2,3,5], subjects: ['MATH','ENG','URD','ART'] },
      // Class 6–10: MATH@L1, ENG@L2, URD@L3 + science@L5
      { classOrder: 9,  slots: [1,2,3,5], subjects: ['MATH','ENG','URD','PHY'] },
      { classOrder: 10, slots: [1,2,3,5], subjects: ['MATH','ENG','URD','CHEM'] },
      { classOrder: 11, slots: [1,2,3,5], subjects: ['MATH','ENG','URD','BIO'] },
      { classOrder: 12, slots: [1,2,3,5], subjects: ['MATH','ENG','URD','CSC'] },
      { classOrder: 13, slots: [1,2,3,5], subjects: ['MATH','ENG','URD','BIO'] },
    ];

    const unameToId = (uname: string) => teacherIds[uname];

    // ── Subject specialists ──────────────────────────────────────
    // We assign one class per slot per specialist. Since there are 7 non-break slots
    // and 10 classes, each specialist can cover at most 7. Remaining classes get
    // those subjects assigned to their class head via the fallback below.

    // ── Specialists: hina (Islamiyat), shahid (Science), farah (Quran) ──
    // Each specialist gets one unique slot, so max 3 classes each.
    // Slots available: L4, L7, L8 (heads use L1, L2, L3, L5; L6 = break)
    // Rotation ensures: each teacher at a different slot per class → zero conflicts
    const specEntries: { uname: string; classOrder: number; slot: number; subject: string }[] = [
      // hina → ISL
      { uname: 'hina_spec', classOrder: 4,  slot: 4, subject: 'ISL' },
      { uname: 'hina_spec', classOrder: 7,  slot: 7, subject: 'ISL' },
      { uname: 'hina_spec', classOrder: 10, slot: 8, subject: 'ISL' },
      // shahid → Science (SCI for <Class 6, PHY/CHEM for >=Class 6)
      { uname: 'shahid_sci', classOrder: 5,  slot: 4, subject: 'SCI' },
      { uname: 'shahid_sci', classOrder: 8,  slot: 7, subject: 'SCI' },
      { uname: 'shahid_sci', classOrder: 11, slot: 8, subject: 'PHY' },
      // farah → Quran
      { uname: 'farah_lang', classOrder: 6,  slot: 4, subject: 'QRN' },
      { uname: 'farah_lang', classOrder: 9,  slot: 7, subject: 'QRN' },
      { uname: 'farah_lang', classOrder: 12, slot: 8, subject: 'QRN' },
    ];

    // Check for remaining slots per class — for non-assigned slots, fallback to class head
    // First, build what each class has
    const classSlotTeachers: Record<number, Record<number, { teacherId: string; subject: string }>> = {};
    for (const grp of uniqueGroups) classSlotTeachers[grp.displayOrder] = { 6: { teacherId: '', subject: 'break' } };

    // Fill class heads
    for (const ha of headAssignments) {
      const grp = uniqueGroups.find(g => g.displayOrder === ha.classOrder);
      if (!grp) continue;
      const teacherId = unameToId(CLASS_TEACHERS[ha.classOrder - 4].uname);
      if (!teacherId) continue;
      if (!classSlotTeachers[ha.classOrder]) classSlotTeachers[ha.classOrder] = {};
      for (let i = 0; i < ha.slots.length; i++) {
        classSlotTeachers[ha.classOrder][ha.slots[i]] = { teacherId, subject: ha.subjects[i] };
      }
    }

    // Fill specialists (skip if slot already taken — specialist loses that class)
    for (const entry of specEntries) {
      if (!classSlotTeachers[entry.classOrder]) classSlotTeachers[entry.classOrder] = {};
      const tId = teacherIds[entry.uname];
      if (!classSlotTeachers[entry.classOrder][entry.slot]) {
        const grp = uniqueGroups.find(g => g.displayOrder === entry.classOrder);
        if (!grp || !tId) continue;
        classSlotTeachers[entry.classOrder][entry.slot] = { teacherId: tId, subject: entry.subject };
      } else {
        // Slot already taken — give this subject to class head instead
        const grp = uniqueGroups.find(g => g.displayOrder === entry.classOrder);
        if (!grp) continue;
        // Find the nearest free slot for this class
        const freeSlot = [1,2,3,4,5,7,8].find(s => !classSlotTeachers[entry.classOrder][s]);
        if (freeSlot) {
          const headDef = headAssignments.find(h => h.classOrder === entry.classOrder);
          const headId = headDef ? unameToId(CLASS_TEACHERS[entry.classOrder - 4].uname) : null;
          classSlotTeachers[entry.classOrder][freeSlot] = { teacherId: headId || (tId || ''), subject: entry.subject };
        }
      }
    }

    // Fill any remaining empty slots with class head
    for (const grp of uniqueGroups) {
      const headDef = headAssignments.find(h => h.classOrder === grp.displayOrder);
      const headId = headDef ? unameToId(CLASS_TEACHERS[grp.displayOrder - 4].uname) : null;
      for (const slotNum of [1,2,3,4,5,7,8]) {
        if (!classSlotTeachers[grp.displayOrder]) classSlotTeachers[grp.displayOrder] = {};
        if (!classSlotTeachers[grp.displayOrder][slotNum] && headId) {
          // Pick an unassigned subject from this class's pool
          const unassignedSub = grp.groupSubjects.find(gs => {
            return !Object.values(classSlotTeachers[grp.displayOrder] || {}).some((v: any) => v.subject === gs.subject.code);
          });
          classSlotTeachers[grp.displayOrder][slotNum] = { teacherId: headId, subject: unassignedSub?.subject.code || 'MATH' };
        }
      }
    }

    // ── Write timetable entries ────────────────────────────────
    let entryCount = 0;
    for (const grp of uniqueGroups) {
      const slots = classSlotTeachers[grp.displayOrder];
      if (!slots) continue;

      for (const slotNum of [1,2,3,4,5,7,8]) {
        const assignment = slots[slotNum];
        if (!assignment || assignment.subject === 'break') continue;

        const subKey = `${grp.id}::${assignment.subject}`;
        const subId = subjectMap.get(subKey);
        if (!subId) continue;

        const slotDef = ttSlots.find(s => s.lectureNumber === slotNum);
        if (!slotDef) continue;

        await prisma.timetableEntry.upsert({
          where: { slotId_groupId: { slotId: slotDef.id, groupId: grp.id } },
          update: { subjectId: subId, teacherId: assignment.teacherId, note: null },
          create: { slotId: slotDef.id, groupId: grp.id, subjectId: subId, teacherId: assignment.teacherId },
        });
        entryCount++;
      }
    }

    // ── Verify no slot conflicts ───────────────────────────────
    const teacherSlotUsage: Record<string, Set<number>> = {};
    let conflicts = 0;
    for (const grp of uniqueGroups) {
      const slots = classSlotTeachers[grp.displayOrder];
      if (!slots) continue;
      for (const slotNum of [1,2,3,4,5,7,8]) {
        const a = slots[slotNum];
        if (!a || a.subject === 'break') continue;
        if (!teacherSlotUsage[a.teacherId]) teacherSlotUsage[a.teacherId] = new Set();
        if (teacherSlotUsage[a.teacherId].has(slotNum)) {
          conflicts++;
          console.log(`  ⚠ CONFLICT: Teacher ${a.teacherId} in 2 classes at L${slotNum}`);
        }
        teacherSlotUsage[a.teacherId].add(slotNum);
      }
    }

    console.log(`  ✓ ${entryCount} timetable entries written for ${uniqueGroups.length} classes`);
    if (conflicts === 0) console.log('  ✓ Zero slot conflicts — all teachers clear');
  }
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
