jest.mock('../../../src/services/audit.service', () => ({
  logAudit: jest.fn().mockResolvedValue(undefined),
}));

import { prismaMock } from '../../mocks/prisma';
import { computeOverallPercentage, reportCardService } from '../../../src/modules/admin/services/report-card.service';
import { logAudit } from '../../../src/services/audit.service';

const scope = { academicYearId: 'ay1', branchId: 'b1', academicYearStatus: 'ACTIVE' as const, isArchived: false };

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
  (prismaMock.student.findFirst as jest.Mock).mockResolvedValue({
    id: 's1',
    name: 'Ali',
    rollNumber: '1',
  });
}

describe('computeOverallPercentage', () => {
  test('averages subject percentages equally', () => {
    expect(computeOverallPercentage([
      { percentage: 80 },
      { percentage: 90 },
      { percentage: 70 },
    ])).toBeCloseTo(80, 5);
  });

  test('returns 0 for empty list', () => {
    expect(computeOverallPercentage([])).toBe(0);
  });

  test('handles single subject', () => {
    expect(computeOverallPercentage([{ percentage: 85.5 }])).toBe(85.5);
  });
});

describe('ReportCardService — compute pipeline', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockScopeChain();
    prismaMock.gradeScale.findFirst.mockResolvedValue(null);
    (prismaMock as any).$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
  });

  test('computeForStudent aggregates subject results and upserts DRAFT card', async () => {
    prismaMock.subjectResult.findMany.mockResolvedValue([
      { subjectId: 'sub1', percentage: 80, grade: 'A', subject: { id: 'sub1', name: 'Math', code: 'M' } },
      { subjectId: 'sub2', percentage: 90, grade: 'A+', subject: { id: 'sub2', name: 'Eng', code: 'E' } },
    ] as any);
    prismaMock.reportCard.upsert.mockResolvedValue({
      id: 'rc1',
      studentId: 's1',
      examSessionId: 'sess1',
      overallPercentage: 85,
      overallGrade: 'A',
      classRank: null,
      status: 'DRAFT',
    } as any);

    const result = await reportCardService.computeForStudent('s1', 'sess1', scope);

    expect(result.overallPercentage).toBe(85);
    expect(result.subjectResults).toHaveLength(2);
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: 'ReportCard', metadata: expect.objectContaining({ action: 'student_compute' }) }),
    );
  });

  test('computeForClass assigns competition class ranks', async () => {
    prismaMock.student.findMany.mockResolvedValue([
      { id: 's1', name: 'Ali', rollNumber: '1' },
      { id: 's2', name: 'Sara', rollNumber: '2' },
      { id: 's3', name: 'Omar', rollNumber: '3' },
    ] as any);

    prismaMock.subjectResult.findMany
      .mockResolvedValueOnce([{ subjectId: 'sub1', percentage: 90, grade: 'A+', subject: { id: 'sub1', name: 'M', code: 'M' } }] as any)
      .mockResolvedValueOnce([{ subjectId: 'sub1', percentage: 90, grade: 'A+', subject: { id: 'sub1', name: 'M', code: 'M' } }] as any)
      .mockResolvedValueOnce([{ subjectId: 'sub1', percentage: 70, grade: 'B+', subject: { id: 'sub1', name: 'M', code: 'M' } }] as any);

    prismaMock.reportCard.upsert
      .mockResolvedValueOnce({ id: 'rc1', overallPercentage: 90, overallGrade: 'A+', classRank: null } as any)
      .mockResolvedValueOnce({ id: 'rc2', overallPercentage: 90, overallGrade: 'A+', classRank: null } as any)
      .mockResolvedValueOnce({ id: 'rc3', overallPercentage: 70, overallGrade: 'B+', classRank: null } as any);

    prismaMock.reportCard.update.mockResolvedValue({} as any);

    const results = await reportCardService.computeForClass('class1', 'sess1', scope);
    expect(results.map((r) => r.classRank)).toEqual([1, 1, 3]);
  });

  test('publish blocks when subject results are stale', async () => {
    prismaMock.reportCard.findUnique.mockResolvedValue({
      id: 'rc1',
      studentId: 's1',
      examSessionId: 'sess1',
      status: 'DRAFT',
      updatedAt: new Date('2026-06-01'),
      student: { id: 's1', groupId: 'class1', academicYearId: 'ay1', academicYear: { branchId: 'b1' } },
    } as any);
    prismaMock.subjectResult.findMany.mockResolvedValue([
      { subjectId: 'sub1', computedAt: new Date('2026-06-15') },
    ] as any);
    prismaMock.examClassSubject.findMany.mockResolvedValue([{ subjectId: 'sub1' }] as any);

    await expect(reportCardService.publish('rc1', scope)).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining('stale'),
    });
  });

  test('publish succeeds when results are current', async () => {
    const ts = new Date('2026-06-15');
    prismaMock.reportCard.findUnique.mockResolvedValue({
      id: 'rc1',
      studentId: 's1',
      examSessionId: 'sess1',
      status: 'DRAFT',
      updatedAt: ts,
      student: { id: 's1', groupId: 'class1', academicYearId: 'ay1', academicYear: { branchId: 'b1' } },
    } as any);
    prismaMock.subjectResult.findMany.mockResolvedValue([
      { subjectId: 'sub1', computedAt: new Date('2026-06-10') },
    ] as any);
    prismaMock.examClassSubject.findMany.mockResolvedValue([{ subjectId: 'sub1' }] as any);
    prismaMock.reportCard.update.mockResolvedValue({ id: 'rc1', status: 'PUBLISHED' } as any);

    const result = await reportCardService.publish('rc1', scope);
    expect(result.status).toBe('PUBLISHED');
  });

  test('getReportCard returns card with subject breakdown', async () => {
    prismaMock.reportCard.findUnique.mockResolvedValue({
      id: 'rc1',
      studentId: 's1',
      examSessionId: 'sess1',
      overallPercentage: 85,
      overallGrade: 'A',
      status: 'DRAFT',
      student: { id: 's1', name: 'Ali', rollNumber: '1', groupId: 'class1' },
      examSession: { id: 'sess1', name: 'Term 1' },
    } as any);
    prismaMock.subjectResult.findMany.mockResolvedValue([
      { subjectId: 'sub1', percentage: 85, grade: 'A', subject: { id: 'sub1', name: 'Math', code: 'M' } },
    ] as any);

    const result = await reportCardService.getReportCard('s1', 'sess1', scope);
    expect(result.subjectResults).toHaveLength(1);
  });
});
