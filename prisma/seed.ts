/**
 * Database Seed Script — MCS-App v2.0
 *
 * Creates: branch, calendar, AY, groups, CEO, admin,
 * subjects, section-subject links, teachers, timetable, 345+ students, student portal
 * test logins, full AY attendance, teacher attendance, and fee heads.
 *
 * Does NOT seed: fee structures, student fees, payments.
 *
 * Usage:
 *   npx ts-node prisma/seed.ts
 */

import { PrismaClient, AcademicYearStatus } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { SEED_TEACHER_PORTAL_LOGINS } from './seed-teacher-logins.config';
import { seedTeacherPortalLogins } from './seed-teacher-logins.lib';
import { SEED_STUDENT_PORTAL_LOGINS } from './seed-student-logins.config';
import { seedStudentPortalLogins } from './seed-student-logins.lib';

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

const FEE_HEADS = [
  { name: 'Tuition',       category: 'MONTHLY', description: 'Monthly tuition fee' },
  { name: 'Transport',     category: 'MONTHLY', description: 'Transport/Conveyance', isOptional: true },
  { name: 'Lab Fee',       category: 'TERM',    description: 'Science lab charges (per term)' },
  { name: 'Sports',        category: 'TERM',    description: 'Sports & extracurricular (per term)' },
  { name: 'Library',       category: 'MONTHLY', description: 'Library & reading material' },
  { name: 'Annual Charges', category: 'ANNUAL', description: 'Annual registration & misc' },
  { name: 'Admission Fee',  category: 'ONE_TIME', description: 'One-time admission charge' },
];

// ─── Helper: Idempotent find-or-create ───────────────────────────────────

async function ensureBranch(name: string, code: string) {
  const existing = await prisma.branch.findUnique({ where: { code } });
  if (existing) { console.log(`  ✓ Branch "${name}" already exists`); return existing; }
  const branch = await prisma.branch.create({ data: { name, code } });
  console.log(`  ✓ Created Branch "${name}"`);
  return branch;
}

async function ensureCalendar(label: string, startDate: Date, endDate: Date) {
  const existing = await prisma.academicCalendar.findUnique({ where: { label } });
  if (existing) { console.log(`  ✓ AcademicCalendar "${label}" already exists`); return existing; }
  const count = await prisma.academicCalendar.count();
  const calendar = await prisma.academicCalendar.create({ data: { label, startDate, endDate, isCurrent: count === 0 } });
  console.log(`  ✓ Created AcademicCalendar "${label}"`);
  return calendar;
}

async function ensureAcademicYear(branchId: string, calendarId: string, status: AcademicYearStatus) {
  const existing = await prisma.academicYear.findFirst({ where: { branchId, calendarId } });
  if (existing) { console.log(`  ✓ AcademicYear (${status}) already exists`); return existing; }
  const ay = await prisma.academicYear.create({ data: { branchId, calendarId, status } });
  console.log(`  ✓ Created AcademicYear (${status})`);
  return ay;
}

async function ensureGroups(academicYearId: string) {
  let created = 0;
  for (const g of DEFAULT_GROUPS) {
    const existing = g.section
      ? await prisma.group.findFirst({ where: { academicYearId, name: g.name, section: { equals: g.section, mode: 'insensitive' } } })
      : await prisma.group.findFirst({ where: { academicYearId, name: g.name, section: null } });
    if (existing) continue;
    await prisma.group.create({ data: { academicYearId, name: g.name, section: (g as any).section || undefined, displayOrder: g.displayOrder, capacity: 30, onlyAdminCanSend: true, isActive: true } });
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
    if (!existing) { await prisma.subject.create({ data: { academicYearId, name: sub.name, code: sub.code } }); created++; }
  }
  console.log(`  ✓ ${created} subjects created (${DEFAULT_SUBJECTS.length - created} already exist)`);
}

async function ensureTimetable(academicYearId: string, name: string, type: string, slots: any[], activeDays: number[]) {
  let tt = await prisma.timetable.findUnique({ where: { academicYearId_name: { academicYearId, name } } });
  if (!tt) tt = await prisma.timetable.create({ data: { academicYearId, name, type } });
  for (const d of activeDays) {
    await prisma.timetableDayConfig.upsert({
      where: { timetableId_dayOfWeek: { timetableId: tt.id, dayOfWeek: d } },
      create: { timetableId: tt.id, dayOfWeek: d, isActive: true }, update: {},
    });
  }
  for (const s of slots) {
    await prisma.timetableSlot.upsert({
      where: { timetableId_lectureNumber: { timetableId: tt.id, lectureNumber: s.lecture } },
      update: { startTime: s.start, endTime: s.end },
      create: { timetableId: tt.id, lectureNumber: s.lecture, startTime: s.start, endTime: s.end, dayOfWeek: (s as any).day || null },
    });
  }
  const slotCount = await prisma.timetableSlot.count({ where: { timetableId: tt.id } });
  console.log(`  ✓ "${name}" (${type}): ${slotCount} slots, ${activeDays.length} active days`);
}

// ─── Demo Students + Full AY Attendance ──────────────────────────────────

async function seedDemoStudents(academicYearId: string, groupOrder: number, studentNames: string[], section?: string) {
  const where: any = { academicYearId, displayOrder: groupOrder, isActive: true };
  if (section) where.section = { equals: section, mode: 'insensitive' };
  const group = await prisma.group.findFirst({ where });
  if (!group) { console.log(`  ⚠ Group order ${groupOrder} not found — skipping`); return; }

  const existingCount = await prisma.student.count({ where: { groupId: group.id } });
  if (existingCount >= studentNames.length) {
    console.log(`  ✓ ${existingCount} students already exist in "${group.name}" — skipping`);
  } else {
    let maxSN = await prisma.student.findFirst({ orderBy: { studentNumber: 'desc' }, select: { studentNumber: true } });
    let nextSN = (maxSN?.studentNumber ?? 300) + 1;
    for (let i = 0; i < studentNames.length; i++) {
      await prisma.student.upsert({
        where: { admissionNumber: `ADM-${nextSN + i}` },
        update: {},
        create: {
          academicYearId, groupId: group.id,
          name: studentNames[i], rollNumber: String(i + 1), admissionNumber: `ADM-${nextSN + i}`,
          studentNumber: nextSN + i, isActive: true, status: 'ACTIVE',
          gender: (['male','female','male','female','male','female','male','female','male','female'] as any)[i],
        },
      });
    }
    console.log(`  ✓ ${studentNames.length} demo students created in "${group.name}"`);
  }

  // Full AY attendance
  const allIds = await prisma.student.findMany({ where: { groupId: group.id, isActive: true }, select: { id: true } });
  if (allIds.length === 0) return;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const startDate = new Date(CALENDAR_START); startDate.setHours(0, 0, 0, 0);
  const daysInAy = Math.ceil((today.getTime() - startDate.getTime()) / 86400000);
  const STATUSES = ['present', 'present', 'present', 'present', 'present', 'absent', 'late', 'leave', 'function'];
  const seededRandom = (seed: number) => { const x = Math.sin(seed * 9301 + 49297) * 49297; return x - Math.floor(x); };
  let totalAtt = 0;
  for (const student of allIds) {
    for (let dayOffset = daysInAy; dayOffset >= 0; dayOffset--) {
      const local = new Date(today); local.setDate(local.getDate() - dayOffset);
      const d = new Date(Date.UTC(local.getFullYear(), local.getMonth(), local.getDate()));
      const status = local.getDay() === 0 ? 'holiday' : STATUSES[Math.floor(seededRandom(student.id.charCodeAt(0) * 1000 + dayOffset * 7 + student.id.charCodeAt(student.id.length - 1)) * STATUSES.length)];
      await prisma.attendance.upsert({
        where: { studentId_date: { studentId: student.id, date: d } },
        update: { status },
        create: { studentId: student.id, academicYearId, date: d, status },
      });
      totalAtt++;
    }
  }
  console.log(`  ✓ ${totalAtt} attendance records for ${allIds.length} students over ${daysInAy + 1} AY days`);
}

async function seedTeacherAttendance(academicYearId: string) {
  const allTeachers = await prisma.user.findMany({ where: { role: 'teacher', status: 'active' }, select: { id: true } });
  if (allTeachers.length === 0) return;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const ayStart = new Date(CALENDAR_START); ayStart.setHours(0, 0, 0, 0);
  const days = Math.ceil((today.getTime() - ayStart.getTime()) / 86400000);
  let count = 0;
  for (const t of allTeachers) {
    for (let d = days; d >= 0; d--) {
      const dt = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate() - d));
      const isSun = new Date(today.getTime() - d * 86400000).getDay() === 0;
      const status = isSun ? 'holiday' : (['present','present','present','present','absent','late','leave','function'] as const)[Math.floor(Math.random() * 8)];
      await prisma.teacherAttendance.upsert({
        where: { teacherId_date: { teacherId: t.id, date: dt } },
        update: { status },
        create: { teacherId: t.id, academicYearId, date: dt, status },
      });
      count++;
    }
  }
  console.log(`  ✓ ${count} teacher attendance records for ${allTeachers.length} teachers over ${days + 1} AY days`);
}

// ─── Exam Sessions + Results ─────────────────────────────────────────────

async function seedExamsAndResults(academicYearId: string, adminUserId: string) {
  // Clean old exam data for idempotency
  await prisma.reportCard.deleteMany({ where: { examSession: { academicYearId } } });
  await prisma.subjectResult.deleteMany({ where: { examSession: { academicYearId } } });
  const oldEcsIds = (await prisma.examClassSubject.findMany({ where: { examClass: { exam: { examSession: { academicYearId } } } }, select: { id: true } })).map(e => e.id);
  await prisma.marksEntry.deleteMany({ where: { examClassSubjectId: { in: oldEcsIds } } });
  await prisma.examClassSubject.deleteMany({ where: { examClass: { exam: { examSession: { academicYearId } } } } });
  await prisma.examClass.deleteMany({ where: { exam: { examSession: { academicYearId } } } });
  await prisma.exam.deleteMany({ where: { examSession: { academicYearId } } });
  await prisma.examType.deleteMany({ where: { examSession: { academicYearId } } });
  await prisma.examSession.deleteMany({ where: { academicYearId } });
  console.log('  ✓ Cleared old exam data');

  // 1. Default Grade Scale
  let gradeScale = await prisma.gradeScale.findFirst({ where: { isDefault: true } });
  if (!gradeScale) {
    gradeScale = await prisma.gradeScale.create({ data: { name: 'Standard', isDefault: true } });
  }
  const bands = [
    { label: 'A+', minPercent: 90, maxPercent: 100, gpa: 4.0 },
    { label: 'A',  minPercent: 80, maxPercent: 89.99, gpa: 3.7 },
    { label: 'B+', minPercent: 70, maxPercent: 79.99, gpa: 3.3 },
    { label: 'B',  minPercent: 60, maxPercent: 69.99, gpa: 3.0 },
    { label: 'C',  minPercent: 50, maxPercent: 59.99, gpa: 2.5 },
    { label: 'D',  minPercent: 40, maxPercent: 49.99, gpa: 2.0 },
    { label: 'F',  minPercent: 0,  maxPercent: 39.99, gpa: 0.0 },
  ];
  let bandCount = 0;
  for (const b of bands) {
    const existingBand = await prisma.gradeBand.findFirst({ where: { gradeScaleId: gradeScale.id, label: b.label } });
    if (!existingBand) {
      await prisma.gradeBand.create({ data: { gradeScaleId: gradeScale.id, ...b } });
      bandCount++;
    }
  }
  console.log(`  ✓ Grade scale "${gradeScale.name}" (${bandCount || 'existing'} bands)`);

  // 2. Three terms
  const terms = [
    { name: '1st Term 2026', startDate: new Date('2026-01-01'), endDate: new Date('2026-04-30') },
    { name: '2nd Term 2026', startDate: new Date('2026-05-01'), endDate: new Date('2026-08-31') },
    { name: '3rd Term 2026', startDate: new Date('2026-09-01'), endDate: new Date('2026-12-31') },
  ];

  // Subject codes we'll assign marks for
  const coreSubjects = ['MATH', 'ENG', 'URD', 'SCI', 'ISL', 'QRN'];

  const allGroups = await prisma.group.findMany({ where: { academicYearId, isActive: true }, orderBy: { displayOrder: 'asc' } });
  const allSubjects = await prisma.subject.findMany({ where: { academicYearId } });
  const allStudents = await prisma.student.findMany({ where: { academicYearId, isActive: true }, select: { id: true, groupId: true } });
  const studentCount = allStudents.length;

  const seededRandom = (seed: number) => { const x = Math.sin(seed * 7919 + 6271) * 6271; return x - Math.floor(x); };

  for (const term of terms) {
    console.log(`\n  ── ${term.name} ──`);

    // Session
    const session = await prisma.examSession.create({
      data: {
        name: term.name, academicYearId,
        startDate: term.startDate, endDate: term.endDate,
        createdById: adminUserId,
      },
    });

    // Exam types inside this session
    const examTypesData = ['Quiz', 'Mid Term', 'Final Term'];
    const examTypes: { id: string; name: string }[] = [];
    for (const etName of examTypesData) {
      const et = await prisma.examType.create({
        data: { name: etName, examSessionId: session.id, defaultWeight: 10, createdById: adminUserId },
      });
      examTypes.push(et);
    }

    // For each exam type, create an exam for each group
    for (const et of examTypes) {
      const exam = await prisma.exam.create({
        data: {
          examSessionId: session.id, examTypeId: et.id,
          name: `${et.name} (${term.name})`,
          startDate: term.startDate, endDate: term.endDate,
          status: 'ACTIVE', createdById: adminUserId,
        },
      });

      // Link exam to all groups
      for (const group of allGroups) {
        const ec = await prisma.examClass.create({
          data: { examId: exam.id, classId: group.id, createdById: adminUserId },
        });

        // Link each core subject to this exam class
        for (const subCode of coreSubjects) {
          const subject = allSubjects.find(s => s.code === subCode);
          if (!subject) continue;

          const ecs = await prisma.examClassSubject.create({
            data: {
              examClassId: ec.id, subjectId: subject.id,
              totalMarks: et.name === 'Quiz' ? 25 : et.name === 'Mid Term' ? 50 : 100,
              passingMarks: et.name === 'Quiz' ? 10 : et.name === 'Mid Term' ? 20 : 33,
              createdById: adminUserId,
            },
          });

          // Marks for each student in this group
          const groupStudents = allStudents.filter(st => st.groupId === group.id);
          for (const st of groupStudents) {
            const hash = st.id.charCodeAt(0) * 1000 + st.id.charCodeAt(st.id.length - 1) * (1 + examTypes.indexOf(et));
            const r = seededRandom(hash + coreSubjects.indexOf(subCode) * 7);

            // 2-3% absent
            const isAbsent = r < 0.025;
            const rawMarks = isAbsent ? 0 : Math.round(r * (ecs.totalMarks || 100) * 0.95 + (ecs.totalMarks || 100) * 0.02);

            await prisma.marksEntry.create({
              data: {
                examClassSubjectId: ecs.id, studentId: st.id,
                marksObtained: isAbsent ? null : Math.min(rawMarks, ecs.totalMarks || 100),
                isAbsent,
                enteredBy: adminUserId,
              },
            });
          }
        }
      }
    }

    // Compute subject results (summary per student per subject per session)
    for (const group of allGroups) {
      for (const subCode of coreSubjects) {
        const subject = allSubjects.find(s => s.code === subCode);
        if (!subject) continue;

        const groupStudents = allStudents.filter(st => st.groupId === group.id);
        for (const st of groupStudents) {
          // Find all marks entries for this student + subject across all exams in this session
          const examClassIds = (await prisma.examClass.findMany({
            where: { classId: group.id, exam: { examSessionId: session.id } },
            select: { id: true },
          })).map(ec => ec.id);

          const ecsIds = (await prisma.examClassSubject.findMany({
            where: { examClassId: { in: examClassIds }, subjectId: subject.id },
            select: { id: true, totalMarks: true },
          }));

          let totalObtained = 0;
          let totalMax = 0;
          for (const ecs of ecsIds) {
            const entry = await prisma.marksEntry.findFirst({
              where: { examClassSubjectId: ecs.id, studentId: st.id },
            });
            if (entry && !entry.isAbsent && entry.marksObtained != null) {
              totalObtained += entry.marksObtained;
              totalMax += ecs.totalMarks || 100;
            }
          }

          const pct = totalMax > 0 ? Math.round((totalObtained / totalMax) * 100) : 0;
          const grade = bands.find(b => pct >= b.minPercent && pct <= b.maxPercent)?.label || 'F';

          await prisma.subjectResult.create({
            data: {
              studentId: st.id, examSessionId: session.id, subjectId: subject.id,
              percentage: pct, grade,
              computedAt: new Date(), createdById: adminUserId,
            },
          });
        }
      }
    }

    // Compute report cards
    for (const group of allGroups) {
      const groupStudents = allStudents.filter(st => st.groupId === group.id);
      for (const st of groupStudents) {
        const results = await prisma.subjectResult.findMany({
          where: { studentId: st.id, examSessionId: session.id },
        });
        const avg = results.length > 0
          ? Math.round(results.reduce((s, r) => s + r.percentage, 0) / results.length)
          : 0;
        const overallGrade = bands.find(b => avg >= b.minPercent && avg <= b.maxPercent)?.label || 'F';

        await prisma.reportCard.upsert({
          where: { studentId_examSessionId: { studentId: st.id, examSessionId: session.id } },
          update: {},
          create: {
            studentId: st.id, examSessionId: session.id,
            overallPercentage: avg, overallGrade,
            status: 'PUBLISHED',
          },
        });
      }
    }

    console.log(`  ✓ ${examTypes.length} exam types, ${allGroups.length} classes, ${studentCount} students`);
  }
}

// ─── Main ────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n🚀 MCS-App Database Seed (Heads-only)\n');

  console.log('[1/6] Branch');
  const branch = await ensureBranch(DEFAULT_BRANCH_NAME, DEFAULT_BRANCH_CODE);

  console.log('\n[2/6] AcademicCalendar');
  const calendar = await ensureCalendar(CALENDAR_LABEL, CALENDAR_START, CALENDAR_END);

  console.log('\n[3/6] AcademicYear');
  const academicYear = await ensureAcademicYear(branch.id, calendar.id, 'ACTIVE');

  console.log('\n[4/6] Default Groups');
  await ensureGroups(academicYear.id);

  console.log('\n[5/6] CEO Super Admin');
  const ceoHash = await bcrypt.hash('Ceo@098765', 12);
  const ceoUser = await prisma.user.upsert({
    where: { email: 'ceo@mothercareschool.com' },
    update: {},
    create: { name: 'CEO', email: 'ceo@mothercareschool.com', username: 'ceo', passwordHash: ceoHash, role: 'super_admin', status: 'active' },
  });
  console.log(`  ✓ CEO: ceo@mothercareschool.com / Ceo@098765`);

  await prisma.branchMember.upsert({
    where: { branchId_userId: { branchId: branch.id, userId: ceoUser.id } },
    update: { role: 'branch_admin' },
    create: { branchId: branch.id, userId: ceoUser.id, role: 'branch_admin' },
  });
  console.log(`  ✓ CEO assigned as branch_admin`);

  // Publishable API key
  const devPrefix = 'pk_mcs_global_dev';
  if (!await prisma.apiKey.findFirst({ where: { prefix: devPrefix } })) {
    const { hash } = await import('bcryptjs');
    await prisma.apiKey.create({ data: { name: 'Default Frontend Key', type: 'publishable', keyHash: await hash('pk_mcs_global_dev_a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6', 12), prefix: devPrefix, createdBy: 'system' } });
    console.log(`  ✓ Publishable API key created`);
  } else { console.log(`  ✓ Publishable API key already exists`); }

  // Secret API key
  const devSecretPrefix = 'sk_mcs_global_dev';
  if (!await prisma.apiKey.findFirst({ where: { prefix: devSecretPrefix } })) {
    const { hash } = await import('bcryptjs');
    await prisma.apiKey.create({ data: { name: 'Default Secret Key', type: 'secret', keyHash: await hash('sk_mcs_global_dev_a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6', 12), prefix: devSecretPrefix, createdBy: 'system' } });
    console.log(`  ✓ Secret API key created`);
  } else { console.log(`  ✓ Secret API key already exists`); }

  console.log('\n[6/6] Branch Admin');
  const adminHash = await bcrypt.hash('admin123', 12);
  const adminUser = await prisma.user.upsert({
    where: { username: 'admin' },
    update: {},
    create: { name: 'Mother Care Admin', username: 'admin', passwordHash: adminHash, role: 'management', status: 'active' },
  });
  console.log(`  ✓ Branch admin: admin / admin123`);

  await prisma.branchMember.upsert({
    where: { branchId_userId: { branchId: branch.id, userId: adminUser.id } },
    update: { role: 'branch_admin' },
    create: { branchId: branch.id, userId: adminUser.id, role: 'branch_admin' },
  });
  console.log(`  ✓ Admin assigned as branch_admin`);

  // ─── Staff Members ────────────────────────────────
  console.log('\n[Staff Members]');
  const staffData = [
    { name: 'Fee Manager', username: 'fee_manager', employeeId: 'STF-001', password: 'fee@123', modules: ['FEES'] as const },
    { name: 'Exam Manager', username: 'exam_manager', employeeId: 'STF-002', password: 'exam@123', modules: ['RESULT'] as const },
    { name: 'Timetable Manager', username: 'tt_manager', employeeId: 'STF-003', password: 'tt@123', modules: ['TIMETABLE', 'ATTENDANCE'] as const },
  ];
  for (const sd of staffData) {
    const existing = await prisma.user.findUnique({ where: { username: sd.username } });
    if (existing) { console.log(`  ✓ "${sd.name}" already exists`); continue; }
    const hash = await bcrypt.hash(sd.password, 12);
    const user = await prisma.user.create({
      data: { name: sd.name, username: sd.username, passwordHash: hash, role: 'management', status: 'active' },
    });
    const member = await prisma.branchMember.create({
      data: { branchId: branch.id, userId: user.id, role: 'management', assignedById: adminUser.id },
    });
    await prisma.staffProfile.create({
      data: { userId: user.id, employeeId: sd.employeeId, joiningDate: new Date('2025-08-01') },
    });
    for (const module of sd.modules) {
      await prisma.staffModulePermission.create({
        data: { branchMemberId: member.id, module, canCreate: true, canRead: true, canUpdate: true, canDelete: true },
      });
    }
    console.log(`  ✓ "${sd.name}" (${sd.username} / ${sd.password}) — ${sd.modules.join(', ')}`);
  }
  // Sync the student number sequence
  try { await prisma.$executeRawUnsafe(`SELECT setval('students_number_seq', (SELECT COALESCE(MAX("studentNumber"), 0) + 1 FROM students), false)`); } catch {}

  // ─── Subjects ──────────────────────────────────────
  console.log('\n[Subjects]');
  await ensureSubjects(academicYear.id);

  // ─── Timetable ─────────────────────────────────────
  console.log('\n[Timetable]');
  await ensureTimetable(academicYear.id, 'Regular Timetable', 'timetable', TIMETABLE_SLOTS, [1,2,3,4,5,6]);

  // ─── Section Subjects ──────────────────────────────
  console.log('\n[Section Subjects]');
  const groups = await prisma.group.findMany({ where: { academicYearId: academicYear.id, isActive: true } });
  const subjects = await prisma.subject.findMany({ where: { academicYearId: academicYear.id } });
  let links = 0;
  for (const group of groups) {
    const orderNum = group.displayOrder;
    const sec = (group.section || '').toUpperCase();
    const gs = subjects.filter(s => {
      const c = s.code || '';
      if (['MATH','ENG','URD','ISL','QRN'].includes(c)) return true;
      if (orderNum >= 11 && sec === 'BIO' && ['BIO','PHY','CHEM'].includes(c)) return true;
      if (orderNum >= 11 && sec === 'ARTS' && ['ART','SCI'].includes(c)) return true;
      if (orderNum >= 11 && sec === 'CS' && ['CSC','SCI'].includes(c)) return true;
      if (orderNum <= 10) {
        if (orderNum <= 8 && ['SCI','ART'].includes(c)) return true;
        if (orderNum >= 9 && ['PHY','CHEM','BIO','CSC'].includes(c)) return true;
      }
      return false;
    });
    if (group.section && orderNum >= 11) await prisma.groupSubject.deleteMany({ where: { groupId: group.id } });
    for (const sub of gs) {
      await prisma.groupSubject.upsert({
        where: { groupId_subjectId: { groupId: group.id, subjectId: sub.id } },
        update: {}, create: { groupId: group.id, subjectId: sub.id },
      });
      links++;
    }
  }
  console.log(`  ✓ ${links} subject-group links`);

  // ─── Teachers (portal logins + assignments) ────────
  console.log('\n[Teachers]');
  const teacherLoginResult = await seedTeacherPortalLogins(prisma, { verbose: true });
  console.log(`  ✓ ${teacherLoginResult.teachers.length} teacher portal logins ensured`);

  // ─── Students + Attendance ─────────────────────────
  console.log('\n[Students & Attendance]');
  const STUDENT_GROUPS: { order: number; names: string[]; section?: string }[] = [
    { order: 1, names: ['Ahmed','Ali','Sara','Fatima','Hassan','Ayesha','Usman','Zainab','Omar','Hira','Bilal','Mariam','Hamza','Sana','Taha','Noor','Ibrahim','Khadija','Rayan','Amina'] },
    { order: 2, names: ['Zara','Hania','Ehsan','Mahnoor','Rohan','Iqra','Shayan','Laiba','Rayan','Anaya','Sufyan','Eman','Taha','Aleena','Hamza'] },
    { order: 3, names: ['Areeba','Faizan','Mehwish','Rohaan','Sabeen','Talha','Umaima','Zayan','Aizal','Daniyal','Hareem','Junaid','Kashaf','Muneeb','Nimra','Owais','Rameen','Saim'] },
    { order: 4, names: ['Arham','Bisma','Haroon','Izza','Kabir','Lubna','Muzamil','Nashit','Pari','Rizwan','Shumaila','Tayyab','Uzair','Wajiha','Yasir','Zunaira','Anas','Esha','Faisal','Ghazala','Husnain','Insha','Javed','Komal','Luqman'] },
    { order: 5, names: ['Aiman','Burhan','Dua','Farhan','Hina','Javeria','Kashif','Madiha','Nabeel','Osheen','Qadir','Rubab','Shahzad','Tahira','Umer','Warda','Yumna','Ahsan','Benish','Danish','Fariha','Habib'] },
    { order: 6, names: ['Amna','Basit','Chand','Durr','Elaf','Fawad','Gul','Humaira','Irfan','Jamil','Kiran','Laraib','Mansoor','Najaf','Omar','Pakeeza','Qasim','Riffat','Sameer','Tuba','Vivian','Waqas','Zain'] },
    { order: 7, names: ['Adil','Bushra','Celina','Dawood','Erum','Fahad','Gohar','Haleema','Ijaz','Jamshaid','Kainat','Latif','Mubarak','Nasir','Parveen','Raees','Sadia','Tanveer','Umair','Wasim','Yasmin','Zafar'] },
    { order: 8, names: ['Asif','Beenish','Chandni','Danish','Ehsan','Fizza','Ghulam','Hassan','Iqra','Jamshed','Kausar','Liaqat','Mehmood','Nargis','Paras','Rahat','Sajid','Talat','Urooj','Waqar','Yousaf','Zahid'] },
    { order: 9, names: ['Abrar','Bilquees','Chaudhry','Dilshad','Ejaz','Firdous','Gulshan','Hameed','Ishrat','Javed','Khalid','Lubna','Maqsood','Naveed','Parveen','Rashid','Shabnam','Tariq','Ulfat','Wilayat','Zareen'] },
    { order: 10, names: ['Afshan','Babar','Chan','Dildar','Ehtisham','Fareeha','Ghani','Hamid','Iffat','Jahangir','Kamil','Leena','Masood','Nazish','Pir','Ramzan','Shafi','Tahir','Uzma','Wazir','Yar','Zia'] },
    { order: 11, names: ['Azeem','Benazir','Dostain','Falak','Gulab','Hidayat','Jahan','Kaleem','Muneer','Najma','Parveen','Rasool','Sakina','Taj','Wali'], section: 'BIO' },
    { order: 11, names: ['Aamna','Babrak','Daulat','Farah','Gulshan','Hina','Jalil','Kareena','Mansoora','Najiba','Rafi','Shakeel','Tania','Wafaq','Zamurd'], section: 'ARTS' },
    { order: 11, names: ['Adnan','Bakht','Daniyal','Feroz','Gohar','Irshad','Junaid','Kamal','Mehmooda','Nadeem','Rashid','Shahid','Tahir','Wahid','Zamir'], section: 'CS' },
    { order: 12, names: ['Akram','Bano','Chaman','Dawar','Fakhra','Ghazala','Hayat','Jabeen','Karam','Lal','Mukhtar','Nazia','Riaz','Shamim','Zafar'], section: 'BIO' },
    { order: 12, names: ['Anjum','Bashir','Chandni','Dilawar','Farkhanda','Ghulam','Huma','Javed','Khalid','Mahnoor','Nasreen','Rahat','Shahzadi','Tariq','Zeeshan'], section: 'ARTS' },
    { order: 12, names: ['Aftab','Bilal','Daud','Faisal','Gulshan','Habib','Jamila','Kashif','Mehreen','Naeem','Parveen','Riaz','Sultana','Waseem','Yasmin'], section: 'CS' },
    { order: 13, names: ['Arif','Bushra','Dhani','Farzana','Hakim','Iqbal','Jameel','Khusboo','Mazhar','Nighat','Qaiser','Shafiq','Tanveer','Wajid','Zulfiqar'], section: 'BIO' },
    { order: 13, names: ['Aqeel','Batool','Durdana','Faryal','Hamza','Ismail','Jahanara','Khalil','Mubeen','Nayyar','Qadir','Shaista','Tasneem','Warda','Zahoor'], section: 'ARTS' },
    { order: 13, names: ['Arslan','Bakhtawar','Danish','Farhat','Hafsa','Imtiaz','Jan','Khawar','Mehmood','Nasreen','Qudrat','Shafqat','Tayyab','Waheed','Zareen'], section: 'CS' },
  ];
  for (const g of STUDENT_GROUPS) await seedDemoStudents(academicYear.id, g.order, g.names, g.section);

  console.log('\n[Student Portal Logins]');
  const studentLoginResult = await seedStudentPortalLogins(prisma, { verbose: true });
  console.log(`  ✓ ${studentLoginResult.students.length} student portal logins ensured`);

  console.log('\n[Teacher Attendance]');
  await seedTeacherAttendance(academicYear.id);

  // ─── Exams & Results ─────────────────────────────
  console.log('\n[Exams & Results]');
  await seedExamsAndResults(academicYear.id, adminUser.id);

  // ─── Fee Heads Only (no structures, no generation, no payments) ──
  console.log('\n[Fee] Fee Heads');
  let headCount = 0;
  for (const f of FEE_HEADS) {
    const existing = await prisma.feeHead.findFirst({ where: { name: f.name } });
    if (existing) continue;
    await prisma.feeHead.create({ data: f });
    headCount++;
  }
  console.log(`  ✓ ${headCount} new fee heads created (${await prisma.feeHead.count()} total)`);
  console.log('  ⚠ Skipped: fee structures, student fees, and payments');

  // ─── Summary ─────────────────────────────────
  const groupCount = await prisma.group.count({ where: { academicYearId: academicYear.id } });
  console.log('\n─── Seed Summary ───────────────────────────────');
  console.log(`  Branch:           ${branch.name} (${branch.code})`);
  console.log(`  Calendar:         ${calendar.label}`);
  console.log(`  AcademicYear:     ${academicYear.status}`);
  console.log(`  Groups created:   ${groupCount}`);
  console.log('');
  console.log('  ── User Credentials ──');
  console.log('  CEO:    ceo@mothercareschool.com / Ceo@098765');
  console.log('  Admin:  admin / admin123');
  for (const t of SEED_TEACHER_PORTAL_LOGINS) {
    console.log(`  Teacher: ${t.username} / ${t.password}  (${t.name})`);
  }
  for (const s of SEED_STUDENT_PORTAL_LOGINS) {
    console.log(`  Student: ${s.username} / ${s.password}  (${s.label})`);
  }
  console.log('───────────────────────────────────────────────\n');
}

main()
  .catch((e) => { console.error('\n❌ Seed failed:', e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
