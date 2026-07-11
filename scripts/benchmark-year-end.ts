#!/usr/bin/env npx ts-node
/**
 * Year-end batch promotion benchmark (2000+ students).
 *
 * Usage:
 *   npx ts-node scripts/benchmark-year-end.ts --mode simulate --students 2500
 *   npx ts-node scripts/benchmark-year-end.ts --mode live --branchId <id> --sourceAyId <id>
 *
 * Live mode counts ACTIVE students in the source AY and times snapshot preparation work
 * without mutating production data unless --execute-snapshot is passed.
 */
import 'dotenv/config';

type Args = {
  mode: 'simulate' | 'live';
  students: number;
  branchId?: string;
  sourceAyId?: string;
  executeSnapshot: boolean;
};

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  return {
    mode: (get('--mode') as Args['mode']) || 'simulate',
    students: parseInt(get('--students') || '2000', 10),
    branchId: get('--branchId'),
    sourceAyId: get('--sourceAyId'),
    executeSnapshot: argv.includes('--execute-snapshot'),
  };
}

function hrMs(start: bigint, end: bigint) {
  return Number(end - start) / 1_000_000;
}

/** Mirrors snapshot student serialization cost for N students across G groups. */
function simulateSnapshotWork(studentCount: number) {
  const groupCount = Math.max(1, Math.ceil(studentCount / 40));
  const perGroup = Math.ceil(studentCount / groupCount);
  const groups = Array.from({ length: groupCount }, (_, gi) => {
    const students = Array.from({ length: perGroup }, (_, si) => ({
      id: `stu-${gi}-${si}`,
      name: `Student ${gi}-${si}`,
      rollNumber: String(si + 1),
      status: 'ACTIVE',
    }));
    const teachersData = Array.from({ length: 8 }, (_, ti) => ({
      teacherId: `t-${ti}`,
      teacherName: `Teacher ${ti}`,
      subjectId: `sub-${ti}`,
      subjectName: `Subject ${ti}`,
      isClassTeacher: ti === 0,
      validFrom: new Date().toISOString(),
    }));
    return {
      groupId: `g-${gi}`,
      groupName: `Class ${gi + 1}`,
      section: 'A',
      displayOrder: gi,
      studentCount: students.length,
      studentsData: students,
      teachersData,
    };
  });

  const payloadBytes = JSON.stringify(groups).length;
  return { groupCount, payloadBytes, groups };
}

async function runSimulate(studentCount: number) {
  const iterations = 3;
  const times: number[] = [];

  for (let i = 0; i < iterations; i++) {
    const start = process.hrtime.bigint();
    const result = simulateSnapshotWork(studentCount);
    const serialized = JSON.stringify(result.groups);
    if (serialized.length !== result.payloadBytes) throw new Error('serialization mismatch');
    times.push(hrMs(start, process.hrtime.bigint()));
  }

  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  const result = simulateSnapshotWork(studentCount);

  console.log('\n=== Year-end benchmark (simulate) ===');
  console.log(`Students:        ${studentCount}`);
  console.log(`Groups:          ${result.groupCount}`);
  console.log(`Payload size:    ${(result.payloadBytes / 1024 / 1024).toFixed(2)} MB`);
  console.log(`Avg CPU time:    ${avg.toFixed(1)} ms (${iterations} runs)`);
  console.log(`Throughput est:  ${Math.round(studentCount / (avg / 1000))} students/sec (in-process only)`);
  console.log('\nNote: simulate mode measures serialization CPU — run --mode live against a DB for real timings.');
}

async function runLive(args: Args) {
  if (!args.branchId || !args.sourceAyId) {
    console.error('live mode requires --branchId and --sourceAyId');
    process.exit(1);
  }

  const { prisma } = await import('../src/lib/prisma');
  const { batchPromotionService } = await import('../src/modules/admin/services/batch-promotion.service');

  const [studentCount, groupCount] = await Promise.all([
    prisma.student.count({
      where: { academicYearId: args.sourceAyId, status: 'ACTIVE', isActive: true },
    }),
    prisma.group.count({ where: { academicYearId: args.sourceAyId, isActive: true } }),
  ]);

  console.log('\n=== Year-end benchmark (live read) ===');
  console.log(`Branch:          ${args.branchId}`);
  console.log(`Source AY:       ${args.sourceAyId}`);
  console.log(`Active students: ${studentCount}`);
  console.log(`Active classes:  ${groupCount}`);

  const preStart = process.hrtime.bigint();
  const pre = await batchPromotionService.getPreconditions(args.branchId, args.sourceAyId);
  const preMs = hrMs(preStart, process.hrtime.bigint());
  console.log(`Preconditions:   ${preMs.toFixed(0)} ms`);
  console.log(`In-progress run: ${pre.inProgressRun?.id ?? 'none'}`);

  if (args.executeSnapshot && pre.inProgressRun?.id) {
    const snapStart = process.hrtime.bigint();
    await batchPromotionService.snapshotRun(pre.inProgressRun.id, args.branchId, 'benchmark-bot');
    const snapMs = hrMs(snapStart, process.hrtime.bigint());
    console.log(`Snapshot run:    ${snapMs.toFixed(0)} ms`);
    console.log(`Throughput:      ${Math.round(studentCount / (snapMs / 1000))} students/sec`);
  } else if (args.executeSnapshot) {
    console.log('No in-progress run found — start a BUILD_STAGE promotion run first.');
  } else {
    console.log('\nDry run only. Pass --execute-snapshot to time a real snapshot on the in-progress run.');
  }

  await prisma.$disconnect();
}

async function main() {
  const args = parseArgs();
  if (args.mode === 'simulate') {
    await runSimulate(args.students);
    return;
  }
  await runLive(args);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
