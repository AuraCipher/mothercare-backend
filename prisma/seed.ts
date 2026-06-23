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
  { name: 'Class 8',         section: 'BIO',  displayOrder: 11 },
  { name: 'Class 8',         section: 'ARTS', displayOrder: 11 },
  { name: 'Class 8',         section: 'CS',   displayOrder: 11 },
  { name: 'Class 9',         section: 'BIO',  displayOrder: 12 },
  { name: 'Class 9',         section: 'ARTS', displayOrder: 12 },
  { name: 'Class 9',         section: 'CS',   displayOrder: 12 },
  { name: 'Class 10',        section: 'BIO',  displayOrder: 13 },
  { name: 'Class 10',        section: 'ARTS', displayOrder: 13 },
  { name: 'Class 10',        section: 'CS',   displayOrder: 13 },
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
  let created = 0;
  for (let i = 0; i < DEFAULT_GROUPS.length; i++) {
    const g = DEFAULT_GROUPS[i];
    if (g.section) {
      const existing = await prisma.group.findFirst({ where: { academicYearId, name: g.name, section: { equals: g.section, mode: 'insensitive' } } });
      if (existing) continue;
    } else {
      const existing = await prisma.group.findFirst({ where: { academicYearId, name: g.name, section: null } });
      if (existing) continue;
    }
    await prisma.group.create({
      data: {
        academicYearId,
        name: g.name,
        section: (g as any).section || undefined,
        displayOrder: g.displayOrder,
        capacity: 30,
        onlyAdminCanSend: true,
        isActive: true,
      },
    });
    created++;
  }
  const total = await prisma.group.count({ where: { academicYearId } });
  if (created > 0) console.log(`  ✓ Created ${created} new groups (${total} total)`);
  else console.log(`  ✓ All ${total} groups already exist`);
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
    const sec = (group.section || '').toUpperCase();
    // Assign subjects per class level and section
    const groupSubjects = subjects.filter(s => {
      const c = s.code || '';
      if (['MATH','ENG','URD','ISL','QRN'].includes(c)) return true;        // Core — all classes

      // Class 8-10 sections get specialised subjects
      if (orderNum >= 11 && sec === 'BIO' && ['BIO','PHY','CHEM'].includes(c)) return true;
      if (orderNum >= 11 && sec === 'ARTS' && ['ART','SCI'].includes(c)) return true;
      if (orderNum >= 11 && sec === 'CS' && ['CSC','SCI'].includes(c)) return true;

      // Fallback for non-sectioned classes (Playgroup - Class 7)
      if (orderNum <= 10) {
        if (orderNum <= 8 && ['SCI','ART'].includes(c)) return true;        // Playgroup - Class 5
        if (orderNum >= 9 && (['PHY','CHEM','BIO','CSC'].includes(c))) return true; // Class 6-7 (standalone)
      }
      return false;
    });
    // For sectioned groups (Class 8-10), clean old links first
    if (group.section && orderNum >= 11) {
      await prisma.groupSubject.deleteMany({ where: { groupId: group.id } });
    }
    for (const sub of groupSubjects) {
      await prisma.groupSubject.upsert({
        where: { groupId_subjectId: { groupId: group.id, subjectId: sub.id } },
        update: {},
        create: { groupId: group.id, subjectId: sub.id },
      });
      links++;
    }
  }
  console.log(`  ✓ ${links} subject-group links created`);

  // ─── Step 12: Demo Students + Random Attendance ─────────────────────
  console.log('\n[12/15] Demo Students + Attendance (last 30 days)');

  async function seedDemoStudents(groupOrder: number, studentNames: string[]) {
    const group = await prisma.group.findFirst({
      where: { academicYearId: academicYear.id, displayOrder: groupOrder, isActive: true },
    });
    if (!group) { console.log(`  ⚠ Group order ${groupOrder} not found — skipping`); return; }

    const existingCount = await prisma.student.count({ where: { groupId: group.id } });
    if (existingCount >= studentNames.length) {
      console.log(`  ✓ ${existingCount} students already exist in "${group.name}" — skipping creation`);
    } else {
      let maxSN = await prisma.student.findFirst({ orderBy: { studentNumber: 'desc' }, select: { studentNumber: true } });
      let nextSN = (maxSN?.studentNumber ?? 300) + 1;
      let nextAdm = nextSN;

      const studentsToCreate = studentNames.map((name, i) => ({
        academicYearId: academicYear.id,
        groupId: group.id,
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
      console.log(`  ✓ ${studentNames.length} demo students created in "${group.name}"`);
    }

    // Random attendance for last 30 days
    const allStudents = await prisma.student.findMany({
      where: { groupId: group.id, isActive: true },
      select: { id: true },
    });
    if (allStudents.length === 0) return;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const STATUSES = ['present', 'present', 'present', 'present', 'present', 'absent', 'late'];
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

  await seedDemoStudents(1, [
    'Ahmed', 'Ali', 'Sara', 'Fatima', 'Hassan',
    'Ayesha', 'Usman', 'Zainab', 'Omar', 'Hira',
    'Bilal', 'Mariam', 'Hamza', 'Sana', 'Taha',
    'Noor', 'Ibrahim', 'Khadija', 'Rayan', 'Amina',
  ]);

  await seedDemoStudents(2, [
    'Zara', 'Hania', 'Ehsan', 'Mahnoor', 'Rohan',
    'Iqra', 'Shayan', 'Laiba', 'Rayan', 'Anaya',
    'Sufyan', 'Eman', 'Taha', 'Aleena', 'Hamza',
  ]);

  await seedDemoStudents(3, [
    'Areeba', 'Faizan', 'Mehwish', 'Rohaan', 'Sabeen',
    'Talha', 'Umaima', 'Zayan', 'Aizal', 'Daniyal',
    'Hareem', 'Junaid', 'Kashaf', 'Muneeb', 'Nimra',
    'Owais', 'Rameen', 'Saim',
  ]);

  await seedDemoStudents(4, [
    'Arham', 'Bisma', 'Haroon', 'Izza', 'Kabir',
    'Lubna', 'Muzamil', 'Nashit', 'Pari', 'Rizwan',
    'Shumaila', 'Tayyab', 'Uzair', 'Wajiha', 'Yasir',
    'Zunaira', 'Anas', 'Esha', 'Faisal', 'Ghazala',
    'Husnain', 'Insha', 'Javed', 'Komal', 'Luqman',
  ]);

  // Sync the student number sequence to max + 1
  try {
    await prisma.$executeRawUnsafe(`SELECT setval('students_number_seq', (SELECT COALESCE(MAX("studentNumber"), 0) + 1 FROM students), false)`);
  } catch {
    // Sequence may not exist on first run — skip
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

  // ─── Step 15: Class 1–10 Teachers & Split Lectures ──────────────
  console.log('\n[15/15] Class 1–10 Teachers & Split Lectures');

  // 19 teachers total: 3 Montessori + 7 Class 1-7 + 9 section heads
  const CLASS_TEACHERS = [
    // Standalone heads (Class 1-7)
    { order: 4,  section: null, name: 'Ms. Sana Tariq',     uname: 'sana_class1',   emp: 'TCH-101', qual: 'B.Ed. (Primary)',           spec: 'Class 1 Head' },
    { order: 5,  section: null, name: 'Mr. Kamran Haider',   uname: 'kamran_class2', emp: 'TCH-102', qual: 'B.Ed. (Primary)',           spec: 'Class 2 Head' },
    { order: 6,  section: null, name: 'Ms. Rabia Anwar',     uname: 'rabia_class3',  emp: 'TCH-103', qual: 'B.Ed. (Primary)',           spec: 'Class 3 Head' },
    { order: 7,  section: null, name: 'Mr. Tariq Mehmood',   uname: 'tariq_class4',  emp: 'TCH-104', qual: 'B.Ed. (Primary)',           spec: 'Class 4 Head' },
    { order: 8,  section: null, name: 'Ms. Noreen Akhtar',   uname: 'noreen_class5', emp: 'TCH-105', qual: 'B.Ed. (Primary)',           spec: 'Class 5 Head' },
    { order: 9,  section: null, name: 'Mr. Fahad Ali',       uname: 'fahad_class6',  emp: 'TCH-106', qual: 'M.Sc. (Physics)',           spec: 'Class 6 Head' },
    { order: 10, section: null, name: 'Ms. Bushra Ansari',   uname: 'bushra_class7', emp: 'TCH-107', qual: 'M.Sc. (Chemistry)',         spec: 'Class 7 Head' },
    // Class 8 sections
    { order: 11, section: 'BIO',  name: 'Mr. Danish Iqbal',    uname: 'danish_class8',   emp: 'TCH-108', qual: 'M.Sc. (Biology)',     spec: 'Class 8 BIO Head' },
    { order: 11, section: 'ARTS', name: 'Ms. Maira Shah',      uname: 'maira_arts8',     emp: 'TCH-114', qual: 'B.Ed. (Fine Arts)',     spec: 'Class 8 ARTS Head' },
    { order: 11, section: 'CS',   name: 'Mr. Salman Khan',     uname: 'salman_cs8',      emp: 'TCH-115', qual: 'B.Sc. (Computer Sci)',  spec: 'Class 8 CS Head' },
    // Class 9 sections
    { order: 12, section: 'BIO',  name: 'Ms. Farzana Kausar',  uname: 'farzana_class9',  emp: 'TCH-109', qual: 'M.Sc. (Botany)',       spec: 'Class 9 BIO Head' },
    { order: 12, section: 'ARTS', name: 'Ms. Nadia Hussain',   uname: 'nadia_arts9',     emp: 'TCH-116', qual: 'B.Ed. (Arts Education)', spec: 'Class 9 ARTS Head' },
    { order: 12, section: 'CS',   name: 'Mr. Bilal Ahmed',     uname: 'bilal_cs9',       emp: 'TCH-117', qual: 'B.Sc. (Computer Sci)',  spec: 'Class 9 CS Head' },
    // Class 10 sections
    { order: 13, section: 'BIO',  name: 'Mr. Junaid Akram',    uname: 'junaid_class10',  emp: 'TCH-110', qual: 'M.Sc. (Zoology)',       spec: 'Class 10 BIO Head' },
    { order: 13, section: 'ARTS', name: 'Ms. Saima Riaz',      uname: 'saima_arts10',    emp: 'TCH-118', qual: 'B.Ed. (Fine Arts)',     spec: 'Class 10 ARTS Head' },
    { order: 13, section: 'CS',   name: 'Mr. Zubair Anwar',    uname: 'zubair_cs10',     emp: 'TCH-119', qual: 'B.Sc. (Computer Sci)',  spec: 'Class 10 CS Head' },
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
  console.log(`  ✓ ${CLASS_TEACHERS.length} teachers ensured (16 class heads + 3 Montessori)`);

  // Find ALL groups (including sections)
  // Sort so uppercase sections come before lowercase (ARTS before Arts) to prefer new naming
  const allClassGroups = await prisma.group.findMany({
    where: { academicYearId: academicYear.id, displayOrder: { gte: 4, lte: 13 }, isActive: true },
    include: { groupSubjects: { include: { subject: true } } },
    orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
  });
  allClassGroups.sort((a, b) => {
    const da = a.displayOrder, db = b.displayOrder;
    if (da !== db) return da - db;
    const na = a.name || '', nb = b.name || '';
    if (na !== nb) return na.localeCompare(nb);
    const sa = a.section || '', sb = b.section || '';
    return sb.localeCompare(sa); // reverse: ARTS (upper) before Arts (lower)
  });

  if (allClassGroups.length === 0) { console.log('  ⚠ No classes found — skipping'); } else {
    // Subject → slot mapping per group
    // Standalone (no section) and sectioned groups each get their own head + specialists

    const findTeacher = (order: number, section: string | null): string | null => {
      const secUp = section?.toUpperCase() || null;
      const t = CLASS_TEACHERS.find(tc => tc.order === order && (tc.section?.toUpperCase() || null) === secUp);
      return t ? teacherIds[t.uname] || null : null;
    };

    // All Class 1-10 groups get full 7-slot coverage (one teacher manages all)
    const groupSlotPlan = (group: any): { slots: number[]; subjects: string[] } | null => {
      const order = group.displayOrder;
      const sec = group.section || '';
      if (order >= 4 && order <= 10) return { slots: [1,2,3,4,5,7,8], subjects: ['MATH','ENG','URD','SCI','ISL','ART','QRN'] };
      if (order >= 11 && sec) return { slots: [1,2,3,4,5,7,8], subjects: ['MATH','ENG','URD','ISL','QRN','SCI_OR_ART','PHY_OR_CSC'] };
      return null;
    };

    // Map placeholder codes to actual subjects per group
    const resolveSubject = (group: any, code: string): string => {
      const sec = group.section || '';
      if (code === 'SCI_OR_ART') return sec === 'ARTS' ? 'ART' : sec === 'BIO' ? 'BIO' : sec === 'CS' ? 'CSC' : 'SCI';
      if (code === 'PHY_OR_CSC') return sec === 'CS' ? 'CSC' : sec === 'BIO' ? 'PHY' : sec === 'ARTS' ? 'SCI' : 'PHY';
      return code;
    };

    // Get timetable slots
    const tt15 = await prisma.timetable.findFirst({ where: { academicYearId: academicYear.id, type: 'timetable', isActive: true } });
    if (!tt15) { console.log('  ⚠ No timetable found'); } else {
      const ttSlots = await prisma.timetableSlot.findMany({ where: { timetableId: tt15.id, isActive: true }, orderBy: { lectureNumber: 'asc' } });
      const subjectMap = new Map<string, string>();
      for (const g of allClassGroups) {
        for (const gs of g.groupSubjects) subjectMap.set(`${g.id}::${gs.subject.code}`, gs.subjectId);
      }

      // Clear old teacher/subject assignments from all groups (fresh start each run)
      const allGroupIds = allClassGroups.map(g => g.id);
      await prisma.timetableEntry.updateMany({
        where: { groupId: { in: allGroupIds }, note: { not: 'break' } },
        data: { teacherId: null, subjectId: null },
      });

      // Track used teacher+slot to prevent conflicts
      const teacherUsedSlots = new Map<string, Set<number>>();
      let written = 0;

      for (const group of allClassGroups) {
        const plan = groupSlotPlan(group);
        if (!plan) continue;

        const headId = findTeacher(group.displayOrder, group.section || null);
        if (!headId) continue;

        // Skip if head teacher already has any of these slots (prevents duplicate-group conflicts)
        const headExisting = teacherUsedSlots.get(headId);
        const headSlotsUsed = headExisting && plan.slots.some(s => headExisting.has(s));
        if (headSlotsUsed) {
          if (group.section) console.log(`  ↺ Skipped dupe group "${group.name} ${group.section}" — teacher already assigned`);
          continue;
        }

        // Assign head teacher's slots
        for (let i = 0; i < plan.slots.length; i++) {
          const slotNum = plan.slots[i];
          const rawCode = plan.subjects[i];
          const subjCode = resolveSubject(group, rawCode);
          const subId = subjectMap.get(`${group.id}::${subjCode}`);
          if (!subId) continue;

          if (!teacherUsedSlots.has(headId)) teacherUsedSlots.set(headId, new Set());
          teacherUsedSlots.get(headId)!.add(slotNum);

          await prisma.timetableEntry.upsert({
            where: { slotId_groupId: { slotId: ttSlots.find(s => s.lectureNumber === slotNum)!.id, groupId: group.id } },
            update: { subjectId: subId, teacherId: headId, note: null },
            create: { slotId: ttSlots.find(s => s.lectureNumber === slotNum)!.id, groupId: group.id, subjectId: subId, teacherId: headId },
          });
          written++;
        }

      }

      // Verify conflicts
      let conflictCount = 0;
      for (const [, slots] of teacherUsedSlots) {
        if (slots.size !== new Set(slots).size) conflictCount++;
      }
      console.log(`  ✓ ${written} timetable entries for ${allClassGroups.length} groups`);
      if (conflictCount === 0) console.log('  ✓ Zero slot conflicts');
    }
  }

  // Deactivate old duplicate section groups (e.g. "Arts" lowercase vs "ARTS" uppercase)
  const dupeSections = ['Arts', 'Bio', 'Cs']; // lowercase variants that may exist from previous seeds
  for (const name of ['Class 8', 'Class 9', 'Class 10']) {
    const oldGroups = await prisma.group.findMany({
      where: { academicYearId: academicYear.id, name, section: { in: dupeSections } },
    });
    for (const og of oldGroups) {
      const hasNew = await prisma.group.findFirst({
        where: { academicYearId: academicYear.id, name, section: og.section?.toUpperCase(), isActive: true },
      });
      if (hasNew && og.id !== hasNew.id) {
        await prisma.group.update({ where: { id: og.id }, data: { isActive: false } });
        console.log(`  🗑 Deactivated old duplicate: "${name} ${og.section}"`);
      }
    }
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
