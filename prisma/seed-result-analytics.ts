/**
 * Result & Grade analytics demo seed
 *
 * Creates exam sessions, exams, marks, subject results & report cards
 * so the Result Analytics dashboard has real data to display.
 *
 * Prerequisites: run main seed first (`npm run prisma:seed`)
 *
 * Usage:
 *   npm run prisma:seed:result
 */

import { PrismaClient, ExamStatus, ReportCardStatus } from '@prisma/client';
import { seedDefaultGradeScale } from '../src/modules/admin/services/grade-scale.seed';
import { subjectResultService } from '../src/modules/admin/services/subject-result.service';
import { reportCardService } from '../src/modules/admin/services/report-card.service';

const prisma = new PrismaClient();

const SESSION_DEFS = [
  { name: 'Mid Term — Analytics Demo', start: '2026-01-15', end: '2026-02-28', exams: ['Mid Term Written', 'Mid Term Oral'] },
  { name: 'Final Term — Analytics Demo', start: '2026-04-01', end: '2026-05-30', exams: ['Final Written', 'Final Practical'] },
  { name: 'Monthly Test — Analytics Demo', start: '2026-03-01', end: '2026-03-15', exams: ['March Assessment'] },
];

const TARGET_GROUP_ORDERS = [8, 9, 10]; // Class 5, 6, 7

function seededPct(studentId: string, subjectId: string, examIdx: number): number {
  const seed = [...studentId, ...subjectId].reduce((s, c) => s + c.charCodeAt(0), 0) + examIdx * 17;
  const r = Math.abs(Math.sin(seed * 0.013)) * 100;
  return Math.round(r * 10) / 10;
}

async function main() {
  console.log('\n═══ Result Analytics Seed ═══\n');

  await seedDefaultGradeScale();

  const academicYear = await prisma.academicYear.findFirst({
    where: { status: 'ACTIVE' },
    include: { branch: true },
    orderBy: { createdAt: 'desc' },
  });
  if (!academicYear) {
    throw new Error('No ACTIVE academic year found. Run `npm run prisma:seed` first.');
  }

  const adminUser = await prisma.user.findFirst({
    where: { username: 'admin' },
    select: { id: true },
  });
  if (!adminUser) {
    throw new Error('Admin user not found. Run `npm run prisma:seed` first.');
  }

  const scope = { academicYearId: academicYear.id, branchId: academicYear.branchId };
  const groups = await prisma.group.findMany({
    where: {
      academicYearId: academicYear.id,
      isActive: true,
      displayOrder: { in: TARGET_GROUP_ORDERS },
    },
    include: {
      groupSubjects: { include: { subject: true } },
    },
    orderBy: { displayOrder: 'asc' },
  });

  if (groups.length === 0) {
    throw new Error('No Class 5–7 groups found. Run main seed first.');
  }

  let totalMarks = 0;
  let totalResults = 0;
  let totalCards = 0;

  for (const sessDef of SESSION_DEFS) {
    console.log(`\n── ${sessDef.name} ──`);

    let session = await prisma.examSession.findFirst({
      where: { academicYearId: academicYear.id, name: sessDef.name },
    });
    if (!session) {
      session = await prisma.examSession.create({
        data: {
          academicYearId: academicYear.id,
          name: sessDef.name,
          startDate: new Date(sessDef.start),
          endDate: new Date(sessDef.end),
        },
      });
      console.log(`  ✓ Created exam session`);
    } else {
      console.log(`  ✓ Exam session exists`);
    }

    let examType = await prisma.examType.findFirst({
      where: { examSessionId: session.id, name: 'Written' },
    });
    if (!examType) {
      examType = await prisma.examType.create({
        data: { examSessionId: session.id, name: 'Written', defaultWeight: 1 },
      });
    }

    let examIdx = 0;
    for (const examName of sessDef.exams) {
      let exam = await prisma.exam.findFirst({
        where: { examSessionId: session.id, name: examName },
      });
      if (!exam) {
        exam = await prisma.exam.create({
          data: {
            examSessionId: session.id,
            examTypeId: examType.id,
            name: examName,
            startDate: new Date(sessDef.start),
            endDate: new Date(sessDef.end),
            status: ExamStatus.DRAFT,
          },
        });
        console.log(`  ✓ Created exam "${examName}"`);
      }

      for (const group of groups) {
        let examClass = await prisma.examClass.findUnique({
          where: { examId_classId: { examId: exam.id, classId: group.id } },
        });
        if (!examClass) {
          examClass = await prisma.examClass.create({
            data: { examId: exam.id, classId: group.id, isActive: true },
          });
        }

        const students = await prisma.student.findMany({
          where: { groupId: group.id, isActive: true, academicYearId: academicYear.id },
          select: { id: true },
        });

        for (const gs of group.groupSubjects) {
          let ecs = await prisma.examClassSubject.findUnique({
            where: { examClassId_subjectId: { examClassId: examClass.id, subjectId: gs.subjectId } },
          });
          if (!ecs) {
            ecs = await prisma.examClassSubject.create({
              data: {
                examClassId: examClass.id,
                subjectId: gs.subjectId,
                isActive: true,
                totalMarks: 100,
                passingMarks: 40,
              },
            });
          }

          for (const student of students) {
            const pct = seededPct(student.id, gs.subjectId, examIdx);
            const marksObtained = Math.round(pct);
            const isAbsent = pct < 3;

            await prisma.marksEntry.upsert({
              where: {
                examClassSubjectId_studentId: {
                  examClassSubjectId: ecs.id,
                  studentId: student.id,
                },
              },
              create: {
                examClassSubjectId: ecs.id,
                studentId: student.id,
                marksObtained: isAbsent ? 0 : marksObtained,
                isAbsent,
                enteredBy: adminUser.id,
              },
              update: {
                marksObtained: isAbsent ? 0 : marksObtained,
                isAbsent,
              },
            });
            totalMarks++;
          }
        }
      }
      examIdx++;

      if (exam.status !== ExamStatus.ACTIVE) {
        await prisma.exam.update({
          where: { id: exam.id },
          data: { status: ExamStatus.ACTIVE },
        });
      }
    }

    const computeRes = await subjectResultService.computeForSession(session.id, scope);
    totalResults += computeRes.studentCount;
    console.log(`  ✓ Computed ${computeRes.studentCount} subject results`);

    const cardRes = await reportCardService.computeForSession(session.id, scope);
    totalCards += cardRes.reportCardCount;
    console.log(`  ✓ Generated ${cardRes.reportCardCount} report cards`);

    const cards = await prisma.reportCard.findMany({
      where: { examSessionId: session.id },
      select: { id: true },
    });
    for (const card of cards) {
      await prisma.reportCard.update({
        where: { id: card.id },
        data: { status: ReportCardStatus.PUBLISHED },
      });
    }
    console.log(`  ✓ Published ${cards.length} report cards`);
  }

  console.log('\n─── Result Analytics Seed Summary ───');
  console.log(`  Academic year:    ${academicYear.id}`);
  console.log(`  Branch:           ${academicYear.branch.name}`);
  console.log(`  Classes seeded:   ${groups.map((g) => g.name).join(', ')}`);
  console.log(`  Exam sessions:    ${SESSION_DEFS.length}`);
  console.log(`  Marks entries:    ${totalMarks}`);
  console.log(`  Subject results:  ${totalResults}`);
  console.log(`  Report cards:     ${totalCards}`);
  console.log('\n  Open Result & Grade → Analytics to view charts.');
  console.log('────────────────────────────────────\n');
}

main()
  .catch((e) => {
    console.error('\n❌ Result analytics seed failed:', e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
