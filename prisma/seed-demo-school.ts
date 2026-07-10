/**
 * Standalone demo school seed — does NOT modify prisma/seed.ts
 *
 * Creates an isolated mini campus:
 *   • 1 CEO (super_admin)
 *   • 1 branch + 1 branch admin (Principal)
 *   • 1 ACTIVE academic year
 *   • 2 plain classes (3–5 students each, ≥2 portal logins per class)
 *   • 1 multi-section class (3 sections, 2–3 students each, all with portal logins)
 *   • 1 teacher per class/section (first class teacher = all subjects + class teacher)
 *
 * Usage:
 *   npm run seed:demo
 *   npx ts-node prisma/seed-demo-school.ts
 */

import { PrismaClient, type AcademicYearStatus } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { ensureSchoolAnnouncementRoom } from '../src/modules/chat/services/chat-community.bootstrap';
import { syncSchoolAnnouncementMembers } from '../src/modules/chat/services/chat-branch-settings.service';
import { getOrCreateBranchChatSettings } from '../src/modules/chat/services/chat-permissions.service';

const prisma = new PrismaClient();

// ─── Demo campus constants (unique codes — won't collide with main seed) ───

const DEMO_BRANCH_NAME = 'Mother Care Demo Campus';
const DEMO_BRANCH_CODE = 'MCS-DEMO';
const DEMO_CALENDAR_LABEL = '2025-2026-DEMO';
const DEMO_CALENDAR_START = new Date('2025-08-01T00:00:00+05:00');
const DEMO_CALENDAR_END = new Date('2026-06-30T00:00:00+05:00');

const DEMO_PASSWORDS = {
  ceo: 'DemoCeo@123',
  admin: 'DemoAdmin@123',
  teacher: 'DemoTeacher@123',
  student: 'DemoStudent@123',
} as const;

const CORE_SUBJECTS = [
  { name: 'Mathematics', code: 'MATH' },
  { name: 'English', code: 'ENG' },
  { name: 'Urdu', code: 'URD' },
  { name: 'Science', code: 'SCI' },
];

const SECTION_SUBJECTS = [
  { name: 'Computer Science', code: 'CSC' },
  { name: 'Biology', code: 'BIO' },
  { name: 'Physics', code: 'PHY' },
  { name: 'Chemistry', code: 'CHEM' },
  { name: 'Arts', code: 'ART' },
];

type StudentSpec = {
  name: string;
  rollNumber: string;
  withLogin?: boolean;
  username?: string;
};

type ClassSpec = {
  key: string;
  name: string;
  displayOrder: number;
  section?: string;
  students: StudentSpec[];
  teacher: {
    name: string;
    username: string;
    employeeId: string;
    specialization: string;
    /** Subject codes to assign. Empty = all group subjects. */
    subjectCodes?: string[];
    isClassTeacher: boolean;
  };
};

const DEMO_CLASSES: ClassSpec[] = [
  {
    key: 'playgroup',
    name: 'Playgroup',
    displayOrder: 1,
    students: [
      { name: 'Ahmed', rollNumber: '1', withLogin: true, username: 'demo_pg_ahmed' },
      { name: 'Sara', rollNumber: '2', withLogin: true, username: 'demo_pg_sara' },
      { name: 'Omar', rollNumber: '3', withLogin: true, username: 'demo_pg_omar' },
      { name: 'Hira', rollNumber: '4' },
    ],
    teacher: {
      name: 'Ms. Nadia Playgroup',
      username: 'demo_teacher_playgroup',
      employeeId: 'DEMO-TCH-PG',
      specialization: 'Early Childhood',
      subjectCodes: undefined,
      isClassTeacher: true,
    },
  },
  {
    key: 'class2',
    name: 'Class 2',
    displayOrder: 2,
    students: [
      { name: 'Ali', rollNumber: '1', withLogin: true, username: 'demo_c2_ali' },
      { name: 'Fatima', rollNumber: '2', withLogin: true, username: 'demo_c2_fatima' },
      { name: 'Hassan', rollNumber: '3' },
      { name: 'Zainab', rollNumber: '4' },
      { name: 'Usman', rollNumber: '5' },
    ],
    teacher: {
      name: 'Mr. Bilal Class 2',
      username: 'demo_teacher_class2',
      employeeId: 'DEMO-TCH-C2',
      specialization: 'Primary Education',
      subjectCodes: ['ENG', 'URD', 'SCI'],
      isClassTeacher: true,
    },
  },
  {
    key: 'class8-cs',
    name: 'Class 8',
    displayOrder: 11,
    section: 'CS',
    students: [
      { name: 'Adnan', rollNumber: '1', withLogin: true, username: 'demo_8cs_adnan' },
      { name: 'Aisha', rollNumber: '2', withLogin: true, username: 'demo_8cs_aisha' },
    ],
    teacher: {
      name: 'Ms. Sana CS',
      username: 'demo_teacher_8cs',
      employeeId: 'DEMO-TCH-8CS',
      specialization: 'Computer Science',
      subjectCodes: ['CSC', 'SCI'],
      isClassTeacher: true,
    },
  },
  {
    key: 'class8-bio',
    name: 'Class 8',
    displayOrder: 11,
    section: 'BIO',
    students: [
      { name: 'Bilal', rollNumber: '1', withLogin: true, username: 'demo_8bio_bilal' },
      { name: 'Daniyal', rollNumber: '2', withLogin: true, username: 'demo_8bio_daniyal' },
      { name: 'Eman', rollNumber: '3', withLogin: true, username: 'demo_8bio_eman' },
    ],
    teacher: {
      name: 'Mr. Imran Biology',
      username: 'demo_teacher_8bio',
      employeeId: 'DEMO-TCH-8BIO',
      specialization: 'Biology',
      subjectCodes: ['BIO', 'PHY'],
      isClassTeacher: true,
    },
  },
  {
    key: 'class8-arts',
    name: 'Class 8',
    displayOrder: 11,
    section: 'ARTS',
    students: [
      { name: 'Farah', rollNumber: '1', withLogin: true, username: 'demo_8arts_farah' },
      { name: 'Hamza', rollNumber: '2', withLogin: true, username: 'demo_8arts_hamza' },
    ],
    teacher: {
      name: 'Ms. Kulsoom Arts',
      username: 'demo_teacher_8arts',
      employeeId: 'DEMO-TCH-8ARTS',
      specialization: 'Arts',
      subjectCodes: ['ART', 'ENG'],
      isClassTeacher: true,
    },
  },
];

function subjectsForGroup(name: string, section?: string) {
  const codes = new Set(['MATH', 'ENG', 'URD', 'SCI']);
  const sec = (section || '').toUpperCase();
  if (sec === 'CS') {
    codes.add('CSC');
  } else if (sec === 'BIO') {
    codes.add('BIO');
    codes.add('PHY');
    codes.add('CHEM');
  } else if (sec === 'ARTS') {
    codes.add('ART');
  }
  if (name === 'Playgroup' || name === 'Class 2') {
    return [...CORE_SUBJECTS];
  }
  const catalog = [...CORE_SUBJECTS, ...SECTION_SUBJECTS];
  return catalog.filter((s) => codes.has(s.code));
}

async function hashPassword(plain: string) {
  return bcrypt.hash(plain, 12);
}

async function ensureBranch() {
  const existing = await prisma.branch.findUnique({ where: { code: DEMO_BRANCH_CODE } });
  if (existing) {
    console.log(`  ✓ Branch "${DEMO_BRANCH_NAME}" exists (${existing.id})`);
    return existing;
  }
  const branch = await prisma.branch.create({
    data: { name: DEMO_BRANCH_NAME, code: DEMO_BRANCH_CODE },
  });
  console.log(`  ✓ Created branch "${DEMO_BRANCH_NAME}"`);
  return branch;
}

async function ensureCalendar() {
  const existing = await prisma.academicCalendar.findUnique({ where: { label: DEMO_CALENDAR_LABEL } });
  if (existing) return existing;
  return prisma.academicCalendar.create({
    data: {
      label: DEMO_CALENDAR_LABEL,
      startDate: DEMO_CALENDAR_START,
      endDate: DEMO_CALENDAR_END,
      isCurrent: false,
    },
  });
}

async function ensureAcademicYear(branchId: string, calendarId: string) {
  const existing = await prisma.academicYear.findFirst({
    where: { branchId, calendarId },
  });
  if (existing) return existing;
  return prisma.academicYear.create({
    data: { branchId, calendarId, status: 'ACTIVE' as AcademicYearStatus },
  });
}

async function ensureSubjects(academicYearId: string) {
  const catalog = [...CORE_SUBJECTS, ...SECTION_SUBJECTS];
  const map = new Map<string, string>();
  for (const sub of catalog) {
    let row = await prisma.subject.findFirst({
      where: { academicYearId, code: sub.code },
    });
    if (!row) {
      row = await prisma.subject.create({
        data: { academicYearId, name: sub.name, code: sub.code },
      });
    }
    map.set(sub.code, row.id);
  }
  return map;
}

async function ensureGroup(academicYearId: string, spec: ClassSpec) {
  const where = {
    academicYearId,
    name: spec.name,
    section: spec.section ?? null,
  };
  let group = await prisma.group.findFirst({ where });
  if (!group) {
    group = await prisma.group.create({
      data: {
        academicYearId,
        name: spec.name,
        section: spec.section,
        displayOrder: spec.displayOrder,
        capacity: 30,
        onlyAdminCanSend: true,
        isActive: true,
      },
    });
  }

  const subjectDefs = subjectsForGroup(spec.name, spec.section);
  for (const sub of subjectDefs) {
    const subject = await prisma.subject.findFirst({
      where: { academicYearId, code: sub.code },
    });
    if (!subject) continue;
    await prisma.groupSubject.upsert({
      where: { groupId_subjectId: { groupId: group.id, subjectId: subject.id } },
      update: {},
      create: { groupId: group.id, subjectId: subject.id },
    });
  }

  return group;
}

async function nextStudentNumbers(count: number) {
  const max = await prisma.student.findFirst({
    orderBy: { studentNumber: 'desc' },
    select: { studentNumber: true },
  });
  let n = (max?.studentNumber ?? 9000) + 1;
  const numbers: number[] = [];
  for (let i = 0; i < count; i++) numbers.push(n++);
  return numbers;
}

async function ensureStudent(
  academicYearId: string,
  groupId: string,
  spec: StudentSpec,
  studentNumber: number,
  admissionSuffix: string,
) {
  const admissionNumber = `DEMO-${admissionSuffix}`;
  let student = await prisma.student.findUnique({ where: { admissionNumber } });
  if (!student) {
    student = await prisma.student.create({
      data: {
        academicYearId,
        groupId,
        name: spec.name,
        rollNumber: spec.rollNumber,
        admissionNumber,
        studentNumber,
        isActive: true,
        status: 'ACTIVE',
      },
    });
  }

  await prisma.enrollment.upsert({
    where: { studentId_academicYearId: { studentId: student.id, academicYearId } },
    update: { groupId, rollNumber: spec.rollNumber, leftAt: null },
    create: {
      studentId: student.id,
      academicYearId,
      groupId,
      rollNumber: spec.rollNumber,
    },
  });

  if (spec.withLogin && spec.username) {
    const passwordHash = await hashPassword(DEMO_PASSWORDS.student);
    const user = await prisma.user.upsert({
      where: { username: spec.username },
      update: { name: spec.name, passwordHash, role: 'student', status: 'active' },
      create: {
        name: spec.name,
        username: spec.username,
        passwordHash,
        role: 'student',
        status: 'active',
      },
    });
    await prisma.student.update({
      where: { id: student.id },
      data: {
        userId: user.id,
        username: spec.username,
        credentialTag: 'CRED_NEW',
        credentialGeneratedAt: new Date(),
        passwordSetAt: new Date(),
        credentialStatus: 'active',
      },
    });
  }

  return student;
}

async function ensureTeacher(
  branchId: string,
  academicYearId: string,
  groupId: string,
  spec: ClassSpec['teacher'],
) {
  const passwordHash = await hashPassword(DEMO_PASSWORDS.teacher);
  const user = await prisma.user.upsert({
    where: { username: spec.username },
    update: { name: spec.name, passwordHash, role: 'teacher', status: 'active' },
    create: {
      name: spec.name,
      username: spec.username,
      passwordHash,
      role: 'teacher',
      status: 'active',
    },
  });

  await prisma.teacherProfile.upsert({
    where: { userId: user.id },
    update: {
      employeeId: spec.employeeId,
      specialization: spec.specialization,
      passwordSetAt: new Date(),
      credentialStatus: 'active',
    },
    create: {
      userId: user.id,
      employeeId: spec.employeeId,
      specialization: spec.specialization,
      qualification: 'B.Ed.',
      phone: '+92 300 9990000',
      joiningDate: new Date('2025-08-01'),
      passwordSetAt: new Date(),
      credentialStatus: 'active',
    },
  });

  await prisma.branchMember.upsert({
    where: { branchId_userId: { branchId, userId: user.id } },
    update: { role: 'teacher', isActive: true },
    create: { branchId, userId: user.id, role: 'teacher', isActive: true },
  });

  const groupSubjects = await prisma.groupSubject.findMany({
    where: { groupId },
    include: { subject: true },
  });

  const codesToAssign =
    spec.subjectCodes && spec.subjectCodes.length > 0
      ? spec.subjectCodes
      : groupSubjects.map((gs) => gs.subject.code).filter(Boolean) as string[];

  let firstAssigned = true;
  for (const gs of groupSubjects) {
    const code = gs.subject.code;
    if (!code || !codesToAssign.includes(code)) continue;

    const existing = await prisma.teacherAssignment.findFirst({
      where: {
        academicYearId,
        teacherId: user.id,
        groupId,
        subjectId: gs.subjectId,
      },
    });
    if (existing) continue;

    await prisma.teacherAssignment.create({
      data: {
        academicYearId,
        teacherId: user.id,
        groupId,
        subjectId: gs.subjectId,
        isClassTeacher: spec.isClassTeacher && (firstAssigned || code === 'MATH'),
        role: 'primary',
      },
    });
    firstAssigned = false;
  }

  return user;
}

async function ensureCeo(branchId: string) {
  const passwordHash = await hashPassword(DEMO_PASSWORDS.ceo);
  const user = await prisma.user.upsert({
    where: { email: 'ceo.demo@mcs.app' },
    update: { passwordHash, role: 'super_admin', status: 'active' },
    create: {
      name: 'Demo CEO',
      email: 'ceo.demo@mcs.app',
      username: 'demo_ceo',
      passwordHash,
      role: 'super_admin',
      status: 'active',
    },
  });
  await prisma.branchMember.upsert({
    where: { branchId_userId: { branchId, userId: user.id } },
    update: { role: 'branch_admin', isActive: true },
    create: { branchId, userId: user.id, role: 'branch_admin', isActive: true },
  });
  return user;
}

async function ensureBranchAdmin(branchId: string) {
  const passwordHash = await hashPassword(DEMO_PASSWORDS.admin);
  const user = await prisma.user.upsert({
    where: { username: 'demo_admin' },
    update: { passwordHash, role: 'management', status: 'active' },
    create: {
      name: 'Demo Principal',
      username: 'demo_admin',
      passwordHash,
      role: 'management',
      status: 'active',
    },
  });
  await prisma.branchMember.upsert({
    where: { branchId_userId: { branchId, userId: user.id } },
    update: { role: 'branch_admin', isActive: true },
    create: { branchId, userId: user.id, role: 'branch_admin', isActive: true },
  });
  return user;
}

async function main() {
  console.log('\n🌱 MCS Demo School Seed (standalone)\n');

  console.log('[1/8] Branch + calendar + academic year');
  const branch = await ensureBranch();
  const calendar = await ensureCalendar();
  const academicYear = await ensureAcademicYear(branch.id, calendar.id);
  console.log(`  ✓ Academic year ${academicYear.id} (ACTIVE)`);

  console.log('\n[2/8] CEO + branch admin');
  await ensureCeo(branch.id);
  await ensureBranchAdmin(branch.id);
  console.log('  ✓ demo_ceo / DemoCeo@123');
  console.log('  ✓ demo_admin / DemoAdmin@123 (Principal)');

  console.log('\n[3/8] Subjects');
  await ensureSubjects(academicYear.id);
  console.log(`  ✓ Subject catalog for demo AY`);

  console.log('\n[4/8] Classes, students, teachers');
  const numbers = await nextStudentNumbers(
    DEMO_CLASSES.reduce((sum, c) => sum + c.students.length, 0),
  );
  let numberIdx = 0;

  for (const classSpec of DEMO_CLASSES) {
    const group = await ensureGroup(academicYear.id, classSpec);
    const label = classSpec.section ? `${classSpec.name} — ${classSpec.section}` : classSpec.name;
    console.log(`\n  → ${label}`);

    for (const studentSpec of classSpec.students) {
      await ensureStudent(
        academicYear.id,
        group.id,
        studentSpec,
        numbers[numberIdx++]!,
        `${classSpec.key}-${studentSpec.rollNumber}`,
      );
      const login = studentSpec.withLogin ? ` [login: ${studentSpec.username}]` : '';
      console.log(`     student ${studentSpec.name} (roll ${studentSpec.rollNumber})${login}`);
    }

    await ensureTeacher(branch.id, academicYear.id, group.id, classSpec.teacher);
    const assignDesc =
      classSpec.teacher.subjectCodes?.length
        ? classSpec.teacher.subjectCodes.join(', ')
        : 'ALL subjects';
    console.log(
      `     teacher ${classSpec.teacher.username} → ${assignDesc}${classSpec.teacher.isClassTeacher ? ' (class teacher)' : ''}`,
    );
  }

  console.log('\n[5/8] Summary');
  const groupCount = await prisma.group.count({ where: { academicYearId: academicYear.id, isActive: true } });
  const studentCount = await prisma.student.count({ where: { academicYearId: academicYear.id } });
  const loginCount = await prisma.student.count({
    where: { academicYearId: academicYear.id, userId: { not: null } },
  });
  const teacherCount = await prisma.teacherAssignment.groupBy({
    by: ['teacherId'],
    where: { academicYearId: academicYear.id },
  });
  console.log(`  Groups: ${groupCount} | Students: ${studentCount} | Portal students: ${loginCount} | Teachers: ${teacherCount.length}`);

  console.log('\n[6/8] Chat — school announcement room + admin memberships');
  await getOrCreateBranchChatSettings(branch.id);
  await ensureSchoolAnnouncementRoom(branch.id, academicYear.id);
  await syncSchoolAnnouncementMembers(branch.id, academicYear.id);
  console.log('  ✓ School announcement room ready (teachers read-only until appointed)');

  console.log('\n[7/8] Portal credentials');
  console.log('  CEO:      demo_ceo / DemoCeo@123  (web only)');
  console.log('  Admin:    demo_admin / DemoAdmin@123');
  console.log('  Teachers: demo_teacher_* / DemoTeacher@123');
  console.log('  Students: demo_* / DemoStudent@123');

  console.log('\n[8/8] Done — branch code MCS-DEMO\n');
}

main()
  .catch((err) => {
    console.error('Demo seed failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
