jest.mock('../../../src/services/audit.service', () => ({
  logAudit: jest.fn().mockResolvedValue(undefined),
}));

import { prismaMock } from '../../mocks/prisma';
import { subjectResultService } from '../../../src/modules/admin/services/subject-result.service';
import { logAudit } from '../../../src/services/audit.service';

const scope = { academicYearId: 'ay1', branchId: 'b1' };

const DEFAULT_BANDS_FALLBACK = null;

function mockScopeChain() {
  (prismaMock.examSession.findFirst as jest.Mock).mockResolvedValue({
    id: 'sess1',
    name: 'Term 1',
    academicYear: { branchId: 'b1' },
  });
  (prismaMock.group.findFirst as jest.Mock).mockResolvedValue({
    id: 'class1',
    name: 'Class 1',
    section: 'A',
  });
  (prismaMock.subject.findFirst as jest.Mock).mockResolvedValue({
    id: 'sub1',
    name: 'Mathematics',
    code: 'MATH',
  });
}

function activeEcs(id: string, examId: string, examName: string) {
  return {
    id,
    totalMarks: 100,
    examClass: {
      exam: {
        id: examId,
        name: examName,
        weightOverride: null,
        examType: { defaultWeight: 1 },
      },
    },
  };
}

function setupTransaction() {
  (prismaMock as any).$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
  prismaMock.subjectResult.upsert.mockResolvedValue({} as any);
}

describe('SubjectResultService — compute pipeline (mocked DB)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockScopeChain();
    setupTransaction();
    prismaMock.gradeScale.findFirst.mockResolvedValue(DEFAULT_BANDS_FALLBACK);
  });

  describe('computeForClass — tie-case ranking', () => {
    test('assigns shared competition ranks (1,1,3,4) and persists subjectRank', async () => {
      prismaMock.student.findMany.mockResolvedValue([
        { id: 's1', name: 'Ali', rollNumber: '1' },
        { id: 's2', name: 'Sara', rollNumber: '2' },
        { id: 's3', name: 'Omar', rollNumber: '3' },
        { id: 's4', name: 'Zara', rollNumber: '4' },
      ] as any);

      prismaMock.examClassSubject.findMany.mockResolvedValue([
        activeEcs('ecs1', 'exam-active-1', 'Quiz'),
        activeEcs('ecs2', 'exam-active-2', 'Term'),
      ] as any);

      prismaMock.marksEntry.findMany.mockResolvedValue([
        { studentId: 's1', examClassSubjectId: 'ecs1', marksObtained: 90, isAbsent: false },
        { studentId: 's1', examClassSubjectId: 'ecs2', marksObtained: 90, isAbsent: false },
        { studentId: 's2', examClassSubjectId: 'ecs1', marksObtained: 90, isAbsent: false },
        { studentId: 's2', examClassSubjectId: 'ecs2', marksObtained: 90, isAbsent: false },
        { studentId: 's3', examClassSubjectId: 'ecs1', marksObtained: 80, isAbsent: false },
        { studentId: 's3', examClassSubjectId: 'ecs2', marksObtained: 80, isAbsent: false },
        { studentId: 's4', examClassSubjectId: 'ecs1', marksObtained: 70, isAbsent: false },
        { studentId: 's4', examClassSubjectId: 'ecs2', marksObtained: 70, isAbsent: false },
      ] as any);

      const results = await subjectResultService.computeForClass('class1', 'sess1', 'sub1', scope);

      const rankById = Object.fromEntries(results.map((r) => [r.studentId, r.rank]));
      expect(rankById.s1).toBe(1);
      expect(rankById.s2).toBe(1);
      expect(rankById.s3).toBe(3);
      expect(rankById.s4).toBe(4);

      expect(prismaMock.subjectResult.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ studentId: 's1', subjectRank: 1, percentage: 90 }),
        }),
      );
      expect(prismaMock.subjectResult.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ studentId: 's2', subjectRank: 1, percentage: 90 }),
        }),
      );
      expect(logAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          module: 'exams',
          entityType: 'SubjectResult',
          metadata: expect.objectContaining({ action: 'class_compute', studentCount: 4 }),
        }),
      );
    });

    test('scopes students to academic year + branch', async () => {
      prismaMock.student.findMany.mockResolvedValue([]);
      prismaMock.examClassSubject.findMany.mockResolvedValue([activeEcs('ecs1', 'e1', 'Q')] as any);

      await expect(
        subjectResultService.computeForClass('class1', 'sess1', 'sub1', scope),
      ).rejects.toMatchObject({ status: 400, message: 'No students found in this class' });

      expect(prismaMock.student.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            academicYearId: 'ay1',
            academicYear: { branchId: 'b1' },
          }),
        }),
      );
    });
  });

  describe('computeForClass — absent-as-zero', () => {
    test('treats isAbsent entries as 0 in weighted average and persists percentage', async () => {
      prismaMock.student.findMany.mockResolvedValue([
        { id: 's-absent', name: 'Absent Kid', rollNumber: '5' },
      ] as any);

      prismaMock.examClassSubject.findMany.mockResolvedValue([
        activeEcs('ecs1', 'exam-active-1', 'Quiz'),
        activeEcs('ecs2', 'exam-active-2', 'Term'),
      ] as any);

      prismaMock.marksEntry.findMany.mockResolvedValue([
        { studentId: 's-absent', examClassSubjectId: 'ecs1', marksObtained: null, isAbsent: true },
        { studentId: 's-absent', examClassSubjectId: 'ecs2', marksObtained: 80, isAbsent: false },
      ] as any);

      const results = await subjectResultService.computeForClass('class1', 'sess1', 'sub1', scope);

      expect(results).toHaveLength(1);
      expect(results[0].percentage).toBeCloseTo(40, 5); // (0 + 80) / 2
      expect(prismaMock.subjectResult.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            studentId: 's-absent',
            percentage: expect.closeTo(40, 5),
          }),
        }),
      );
    });
  });

  describe('computeForClass — DRAFT exam exclusion', () => {
    test('only ACTIVE exam ECS rows are loaded; DRAFT exam marks ignored', async () => {
      prismaMock.student.findMany.mockResolvedValue([
        { id: 's1', name: 'Ali', rollNumber: '1' },
      ] as any);

      // _fetchData query returns only ACTIVE exams — DRAFT ecs3 is not included
      prismaMock.examClassSubject.findMany.mockResolvedValue([
        activeEcs('ecs-active', 'exam-active-1', 'Active Quiz'),
      ] as any);

      prismaMock.marksEntry.findMany.mockResolvedValue([
        { studentId: 's1', examClassSubjectId: 'ecs-active', marksObtained: 60, isAbsent: false },
        // Marks on DRAFT exam would have ecs-draft id — not in ecsList so ignored
        { studentId: 's1', examClassSubjectId: 'ecs-draft', marksObtained: 100, isAbsent: false },
      ] as any);

      const results = await subjectResultService.computeForClass('class1', 'sess1', 'sub1', scope);

      expect(results[0].percentage).toBe(60);
      expect(prismaMock.examClassSubject.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            examClass: expect.objectContaining({
              exam: expect.objectContaining({ status: 'ACTIVE' }),
            }),
          }),
        }),
      );
    });
  });

  describe('computeForSession — bulk dedup + summary', () => {
    test('dedupes class+subject combos and returns accurate counts', async () => {
      const computeSpy = jest.spyOn(subjectResultService, 'computeForClass')
        .mockResolvedValueOnce([
          { studentId: 's1', percentage: 90, grade: 'A', rank: 1, student: { id: 's1', name: 'A', rollNumber: '1' } },
          { studentId: 's2', percentage: 80, grade: 'A', rank: 2, student: { id: 's2', name: 'B', rollNumber: '2' } },
        ] as any);

      prismaMock.examClassSubject.findMany.mockResolvedValue([
        { examClass: { classId: 'class1' }, subjectId: 'sub1' },
        { examClass: { classId: 'class1' }, subjectId: 'sub1' }, // second ACTIVE exam, same combo
      ] as any);

      const result = await subjectResultService.computeForSession('sess1', scope);

      expect(computeSpy).toHaveBeenCalledTimes(1);
      expect(computeSpy).toHaveBeenCalledWith('class1', 'sess1', 'sub1', scope);
      expect(result.classSubjectCount).toBe(1);
      expect(result.classSubjectCombos).toBe(1);
      expect(result.studentCount).toBe(2);
      expect(result.totalStudents).toBe(2);
      expect(logAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({ action: 'bulk_compute', classSubjectCount: 1, studentCount: 2 }),
        }),
      );

      computeSpy.mockRestore();
    });

    test('filters combos to session AY scope', async () => {
      jest.spyOn(subjectResultService, 'computeForClass').mockResolvedValue([] as any);
      prismaMock.examClassSubject.findMany.mockResolvedValue([]);

      await subjectResultService.computeForSession('sess1', scope);

      expect(prismaMock.examClassSubject.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            examClass: expect.objectContaining({
              exam: expect.objectContaining({ examSessionId: 'sess1', status: 'ACTIVE' }),
              class: { academicYearId: 'ay1' },
            }),
          }),
        }),
      );
    });
  });
});
