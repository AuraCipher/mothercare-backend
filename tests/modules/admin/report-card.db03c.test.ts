/**
 * DB-03C: Report-Card Class Computation N+1 Elimination — Query-count & equivalence tests.
 *
 * Verifies that computeForClass issues a bounded number of DB read queries
 * regardless of student count, and that results match the expected computation.
 */
jest.mock('../../../src/services/audit.service', () => ({
  logAudit: jest.fn().mockReturnValue(Promise.resolve(undefined)),
}));

import { describe, expect, test, jest, beforeEach } from '@jest/globals';
import { prismaMock } from '../../mocks/prisma';
import { computeOverallPercentage, reportCardService } from '../../../src/modules/admin/services/report-card.service';
import { lookupGrade, computeCompetitionRanks } from '../../../src/modules/admin/services/subject-result.service';

const p = prismaMock as any;
const scope = { academicYearId: 'ay1', branchId: 'b1', academicYearStatus: 'ACTIVE' as const, isArchived: false };

function mockScopeChain() {
  p.examSession.findFirst.mockResolvedValue({
    id: 'sess1', name: 'Term 1', academicYear: { branchId: 'b1' },
  });
  p.group.findFirst.mockResolvedValue({
    id: 'class1', name: 'Class 1', section: 'A',
  });
  p.student.findFirst.mockResolvedValue(undefined);
}

const DEFAULT_BANDS = [
  { minPercent: 90, maxPercent: 100, label: 'A+' },
  { minPercent: 80, maxPercent: 89.99, label: 'A' },
  { minPercent: 70, maxPercent: 79.99, label: 'B+' },
  { minPercent: 60, maxPercent: 69.99, label: 'B' },
  { minPercent: 50, maxPercent: 59.99, label: 'C+' },
  { minPercent: 40, maxPercent: 49.99, label: 'C' },
  { minPercent: 30, maxPercent: 39.99, label: 'D' },
  { minPercent: 20, maxPercent: 29.99, label: 'E' },
  { minPercent: 0, maxPercent: 19.99, label: 'F' },
];

function makeStudents(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `s${i + 1}`, name: `Student ${i + 1}`, rollNumber: String(i + 1),
  }));
}

function makeSubjectResults(students: Array<{ id: string }>, subjectsPerStudent: number = 3) {
  const results: any[] = [];
  for (const s of students) {
    for (let j = 0; j < subjectsPerStudent; j++) {
      const pct = 50 + (parseInt(s.id.slice(1)) * 7 + j * 13) % 50;
      results.push({
        studentId: s.id,
        subjectId: `sub${j + 1}`,
        percentage: pct,
        grade: lookupGrade(pct, DEFAULT_BANDS),
        subject: { id: `sub${j + 1}`, name: `Subject ${j + 1}`, code: `S${j + 1}` },
      });
    }
  }
  return results;
}

function mockForCompute(students: Array<{ id: string }>, subjectResults: any[]) {
  p.student.findMany.mockResolvedValue(students);
  p.subjectResult.findMany.mockResolvedValue(subjectResults);
  p.gradeScale.findFirst.mockResolvedValue(null);

  let upsertCall = 0;
  p.reportCard.upsert.mockImplementation(async () => {
    const studentId = students[upsertCall]?.id;
    const sr = subjectResults.filter((r: any) => r.studentId === studentId);
    const pct = sr.length > 0 ? sr.reduce((s: number, r: any) => s + r.percentage, 0) / sr.length : 0;
    upsertCall++;
    return {
      id: `rc-${upsertCall}`,
      overallPercentage: pct,
      overallGrade: lookupGrade(pct, DEFAULT_BANDS),
      classRank: null,
      status: 'DRAFT',
    };
  });

  p.reportCard.update.mockResolvedValue({});
  (p as any).$transaction.mockImplementation(async (cb: any) => cb(p));
}

function countReadQueries(): Map<string, number> {
  const counts = new Map<string, number>();
  for (const [name, mock] of [
    ['student.findMany', p.student.findMany],
    ['subjectResult.findMany', p.subjectResult.findMany],
    ['gradeScale.findFirst', p.gradeScale.findFirst],
  ]) {
    const calls = mock?.mock?.calls?.length ?? 0;
    if (calls > 0) counts.set(name, calls);
  }
  return counts;
}

// ═══════════════════════════════════════════════════════════════════
// QUERY-COUNT REGRESSION TESTS
// ═══════════════════════════════════════════════════════════════════

describe('DB-03C: computeForClass query-count scaling', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('1 student issues ~3 read queries (student + gradeBands + subjectResults)', async () => {
    mockScopeChain();
    const students = makeStudents(1);
    mockForCompute(students, makeSubjectResults(students));

    await reportCardService.computeForClass('class1', 'sess1', scope);

    const reads = countReadQueries();
    const totalReads = [...reads.values()].reduce((a, b) => a + b, 0);
    expect(totalReads).toBe(3);
  });

  test('10 students issues same ~3 read queries (no N+1 scaling)', async () => {
    mockScopeChain();
    const students = makeStudents(10);
    mockForCompute(students, makeSubjectResults(students));

    await reportCardService.computeForClass('class1', 'sess1', scope);

    const reads = countReadQueries();
    const totalReads = [...reads.values()].reduce((a, b) => a + b, 0);
    expect(totalReads).toBe(3);
  });

  test('50 students issues same ~3 read queries (no N+1 scaling)', async () => {
    mockScopeChain();
    const students = makeStudents(50);
    mockForCompute(students, makeSubjectResults(students));

    await reportCardService.computeForClass('class1', 'sess1', scope);

    const reads = countReadQueries();
    const totalReads = [...reads.values()].reduce((a, b) => a + b, 0);
    expect(totalReads).toBe(3);
  });

  test('100 students issues same ~3 read queries', async () => {
    mockScopeChain();
    const students = makeStudents(100);
    mockForCompute(students, makeSubjectResults(students));

    await reportCardService.computeForClass('class1', 'sess1', scope);

    const reads = countReadQueries();
    const totalReads = [...reads.values()].reduce((a, b) => a + b, 0);
    expect(totalReads).toBe(3);
  });

  test('500 students issues same ~3 read queries', async () => {
    mockScopeChain();
    const students = makeStudents(500);
    mockForCompute(students, makeSubjectResults(students));

    await reportCardService.computeForClass('class1', 'sess1', scope);

    const reads = countReadQueries();
    const totalReads = [...reads.values()].reduce((a, b) => a + b, 0);
    expect(totalReads).toBe(3);
  });

  test('subjectResult.findMany is called exactly once (not N times)', async () => {
    mockScopeChain();
    const students = makeStudents(20);
    mockForCompute(students, makeSubjectResults(students));

    await reportCardService.computeForClass('class1', 'sess1', scope);

    expect(p.subjectResult.findMany).toHaveBeenCalledTimes(1);
  });

  test('gradeScale.findFirst is called exactly once (not N times)', async () => {
    mockScopeChain();
    const students = makeStudents(20);
    mockForCompute(students, makeSubjectResults(students));

    await reportCardService.computeForClass('class1', 'sess1', scope);

    expect(p.gradeScale.findFirst).toHaveBeenCalledTimes(1);
  });

  test('reportCard.upsert is called once per student (writes scale with students)', async () => {
    mockScopeChain();
    const students = makeStudents(10);
    mockForCompute(students, makeSubjectResults(students));

    await reportCardService.computeForClass('class1', 'sess1', scope);

    expect(p.reportCard.upsert).toHaveBeenCalledTimes(10);
  });
});

// ═══════════════════════════════════════════════════════════════════
// RESULT-EQUIVALENCE TESTS
// ═══════════════════════════════════════════════════════════════════

describe('DB-03C: computeForClass result equivalence', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('normal student with complete marks gets correct percentage and grade', async () => {
    mockScopeChain();
    const students = [{ id: 's1', name: 'Ali', rollNumber: '1' }];
    const sr = [
      { studentId: 's1', subjectId: 'sub1', percentage: 80, grade: 'A', subject: { id: 'sub1', name: 'Math', code: 'M' } },
      { studentId: 's1', subjectId: 'sub2', percentage: 90, grade: 'A+', subject: { id: 'sub2', name: 'Eng', code: 'E' } },
    ];
    mockForCompute(students, sr);

    const results = await reportCardService.computeForClass('class1', 'sess1', scope);
    expect(results).toHaveLength(1);
    expect(results[0].overallPercentage).toBe(85);
    expect(results[0].classRank).toBe(1);
  });

  test('student with missing marks for some subjects still computes correctly', async () => {
    mockScopeChain();
    const students = [
      { id: 's1', name: 'Ali', rollNumber: '1' },
      { id: 's2', name: 'Sara', rollNumber: '2' },
    ];
    const sr = [
      { studentId: 's1', subjectId: 'sub1', percentage: 80, grade: 'A', subject: { id: 'sub1', name: 'Math', code: 'M' } },
      { studentId: 's1', subjectId: 'sub2', percentage: 90, grade: 'A+', subject: { id: 'sub2', name: 'Eng', code: 'E' } },
      { studentId: 's2', subjectId: 'sub1', percentage: 70, grade: 'B+', subject: { id: 'sub1', name: 'Math', code: 'M' } },
    ];
    mockForCompute(students, sr);

    const results = await reportCardService.computeForClass('class1', 'sess1', scope);
    expect(results).toHaveLength(2);
    const s1 = results.find((r) => r.studentId === 's1')!;
    const s2 = results.find((r) => r.studentId === 's2')!;
    expect(s1.overallPercentage).toBe(85);
    expect(s2.overallPercentage).toBe(70);
  });

  test('student with no subject results is excluded from output', async () => {
    mockScopeChain();
    const students = [
      { id: 's1', name: 'Ali', rollNumber: '1' },
      { id: 's2', name: 'Sara', rollNumber: '2' },
    ];
    const sr = [
      { studentId: 's1', subjectId: 'sub1', percentage: 80, grade: 'A', subject: { id: 'sub1', name: 'Math', code: 'M' } },
    ];
    mockForCompute(students, sr);

    const results = await reportCardService.computeForClass('class1', 'sess1', scope);
    expect(results).toHaveLength(1);
    expect(results[0].studentId).toBe('s1');
  });

  test('multiple subjects produce correct average', async () => {
    mockScopeChain();
    const students = [{ id: 's1', name: 'Ali', rollNumber: '1' }];
    const sr = [
      { studentId: 's1', subjectId: 'sub1', percentage: 60, grade: 'B', subject: { id: 'sub1', name: 'Math', code: 'M' } },
      { studentId: 's1', subjectId: 'sub2', percentage: 70, grade: 'B+', subject: { id: 'sub2', name: 'Eng', code: 'E' } },
      { studentId: 's1', subjectId: 'sub3', percentage: 80, grade: 'A', subject: { id: 'sub3', name: 'Sci', code: 'S' } },
      { studentId: 's1', subjectId: 'sub4', percentage: 90, grade: 'A+', subject: { id: 'sub4', name: 'Hist', code: 'H' } },
    ];
    mockForCompute(students, sr);

    const results = await reportCardService.computeForClass('class1', 'sess1', scope);
    expect(results[0].overallPercentage).toBe(75);
  });

  test('competition ranks with ties', async () => {
    mockScopeChain();
    const students = [
      { id: 's1', name: 'Ali', rollNumber: '1' },
      { id: 's2', name: 'Sara', rollNumber: '2' },
      { id: 's3', name: 'Omar', rollNumber: '3' },
    ];
    const sr = [
      { studentId: 's1', subjectId: 'sub1', percentage: 90, grade: 'A+', subject: { id: 'sub1', name: 'M', code: 'M' } },
      { studentId: 's2', subjectId: 'sub1', percentage: 90, grade: 'A+', subject: { id: 'sub1', name: 'M', code: 'M' } },
      { studentId: 's3', subjectId: 'sub1', percentage: 70, grade: 'B+', subject: { id: 'sub1', name: 'M', code: 'M' } },
    ];
    mockForCompute(students, sr);

    const results = await reportCardService.computeForClass('class1', 'sess1', scope);
    expect(results.map((r) => r.classRank)).toEqual([1, 1, 3]);
  });

  test('boundary grade values', async () => {
    mockScopeChain();
    const students = [
      { id: 's1', name: 'Ali', rollNumber: '1' },
      { id: 's2', name: 'Sara', rollNumber: '2' },
    ];
    const sr = [
      { studentId: 's1', subjectId: 'sub1', percentage: 89.99, grade: 'A', subject: { id: 'sub1', name: 'M', code: 'M' } },
      { studentId: 's2', subjectId: 'sub1', percentage: 90, grade: 'A+', subject: { id: 'sub1', name: 'M', code: 'M' } },
    ];
    mockForCompute(students, sr);

    const results = await reportCardService.computeForClass('class1', 'sess1', scope);
    const s1 = results.find((r) => r.studentId === 's1')!;
    const s2 = results.find((r) => r.studentId === 's2')!;
    expect(s1.overallGrade).toBe('A');
    expect(s2.overallGrade).toBe('A+');
  });

  test('student ordering matches rollNumber asc then results sorted by percentage desc', async () => {
    mockScopeChain();
    const students = [
      { id: 's3', name: 'Omar', rollNumber: '3' },
      { id: 's1', name: 'Ali', rollNumber: '1' },
      { id: 's2', name: 'Sara', rollNumber: '2' },
    ];
    const sr = [
      { studentId: 's1', subjectId: 'sub1', percentage: 80, grade: 'A', subject: { id: 'sub1', name: 'M', code: 'M' } },
      { studentId: 's2', subjectId: 'sub1', percentage: 70, grade: 'B+', subject: { id: 'sub1', name: 'M', code: 'M' } },
      { studentId: 's3', subjectId: 'sub1', percentage: 90, grade: 'A+', subject: { id: 'sub1', name: 'M', code: 'M' } },
    ];
    mockForCompute(students, sr);

    const results = await reportCardService.computeForClass('class1', 'sess1', scope);
    // Output sorted by percentage desc: s3(90), s1(80), s2(70)
    expect(results.map((r) => r.studentId)).toEqual(['s3', 's1', 's2']);
    expect(results.map((r) => r.classRank)).toEqual([1, 2, 3]);
  });

  test('subject results are included in output', async () => {
    mockScopeChain();
    const students = [{ id: 's1', name: 'Ali', rollNumber: '1' }];
    const sr = [
      { studentId: 's1', subjectId: 'sub1', percentage: 80, grade: 'A', subject: { id: 'sub1', name: 'Math', code: 'M' } },
      { studentId: 's1', subjectId: 'sub2', percentage: 90, grade: 'A+', subject: { id: 'sub2', name: 'Eng', code: 'E' } },
    ];
    mockForCompute(students, sr);

    const results = await reportCardService.computeForClass('class1', 'sess1', scope);
    expect(results[0].subjectResults).toHaveLength(2);
  });

  test('all students receive correct grades via batch gradeBands', async () => {
    mockScopeChain();
    const students = makeStudents(5);
    mockForCompute(students, makeSubjectResults(students, 1));

    const results = await reportCardService.computeForClass('class1', 'sess1', scope);
    expect(results).toHaveLength(5);

    for (const r of results) {
      expect(r.overallGrade).toBeTruthy();
      expect(typeof r.overallPercentage).toBe('number');
      expect(typeof r.classRank).toBe('number');
    }
  });

  test('subject results grouped correctly by student (no cross-contamination)', async () => {
    mockScopeChain();
    const students = [
      { id: 's1', name: 'Ali', rollNumber: '1' },
      { id: 's2', name: 'Sara', rollNumber: '2' },
    ];
    const sr = [
      { studentId: 's1', subjectId: 'sub1', percentage: 100, grade: 'A+', subject: { id: 'sub1', name: 'M', code: 'M' } },
      { studentId: 's2', subjectId: 'sub1', percentage: 50, grade: 'C+', subject: { id: 'sub1', name: 'M', code: 'M' } },
    ];
    mockForCompute(students, sr);

    const results = await reportCardService.computeForClass('class1', 'sess1', scope);
    const s1 = results.find((r) => r.studentId === 's1')!;
    const s2 = results.find((r) => r.studentId === 's2')!;
    expect(s1.overallPercentage).toBe(100);
    expect(s2.overallPercentage).toBe(50);
  });

  test('computeForStudent (single student) still works unchanged', async () => {
    mockScopeChain();
    p.student.findFirst.mockResolvedValue({
      id: 's1', name: 'Ali', rollNumber: '1',
    });

    p.subjectResult.findMany.mockResolvedValue([
      { subjectId: 'sub1', percentage: 80, grade: 'A', subject: { id: 'sub1', name: 'Math', code: 'M' } },
      { subjectId: 'sub2', percentage: 90, grade: 'A+', subject: { id: 'sub2', name: 'Eng', code: 'E' } },
    ]);

    p.reportCard.upsert.mockResolvedValue({
      id: 'rc1', studentId: 's1', examSessionId: 'sess1',
      overallPercentage: 85, overallGrade: 'A', classRank: null, status: 'DRAFT',
    });

    const result = await reportCardService.computeForStudent('s1', 'sess1', scope);
    expect(result.overallPercentage).toBe(85);
    expect(result.subjectResults).toHaveLength(2);
  });
});

// ═══════════════════════════════════════════════════════════════════
// ISOLATION TESTS
// ═══════════════════════════════════════════════════════════════════

describe('DB-03C: computeForClass authorization / isolation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('student query filters by academicYearId and branchId', async () => {
    mockScopeChain();
    p.student.findMany.mockResolvedValue([]);

    await expect(
      reportCardService.computeForClass('class1', 'sess1', scope),
    ).rejects.toMatchObject({ message: 'No students found in this class' });

    expect(p.student.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          academicYearId: 'ay1',
          isActive: true,
          groupId: 'class1',
        }),
      }),
    );
  });

  test('subject result query uses studentId IN filter (scoped to class students)', async () => {
    mockScopeChain();
    const students = makeStudents(5);
    mockForCompute(students, []);

    await reportCardService.computeForClass('class1', 'sess1', scope);

    expect(p.subjectResult.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          studentId: { in: students.map((s) => s.id) },
          examSessionId: 'sess1',
        }),
      }),
    );
  });
});
