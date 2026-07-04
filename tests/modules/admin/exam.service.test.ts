import { prismaMock } from '../../mocks/prisma';
import { examService } from '../../../src/modules/admin/services/exam.service';
// MockExam is defined inline (no factory added yet — will be added to
// factories.ts when the need arises across multiple test files)
type MockExam = {
  id: string;
  examSessionId: string;
  examTypeId: string;
  name: string;
  weightOverride: number | null;
  startDate: Date;
  endDate: Date | null;
  status: 'DRAFT' | 'ACTIVE';
  createdAt: Date;
  updatedAt: Date;
  createdById: string | null;
  updatedById: string | null;
};

function mockExam(overrides: Partial<MockExam> = {}): MockExam {
  return {
    id: 'exam-1',
    examSessionId: 'session-1',
    examTypeId: 'type-1',
    name: 'Midterm Exam',
    weightOverride: null,
    startDate: new Date('2026-05-15'),
    endDate: null,
    status: 'DRAFT',
    createdAt: new Date(),
    updatedAt: new Date(),
    createdById: 'admin-id',
    updatedById: 'admin-id',
    ...overrides,
  };
}

describe('ExamService', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  describe('findAllBySession', () => {
    test('returns exams scoped to a session with examType and counts', async () => {
      const exams = [mockExam({ examSessionId: 'session-1' })];
      prismaMock.exam.findMany.mockResolvedValue(exams as any);

      const result = await examService.findAllBySession('session-1');

      expect(prismaMock.exam.findMany).toHaveBeenCalledWith({
        where: { examSessionId: 'session-1' },
        orderBy: { startDate: 'desc' },
        include: {
          examType: { select: { id: true, name: true, defaultWeight: true } },
          _count: { select: { examClasses: true } },
        },
      });
      expect(result).toHaveLength(1);
    });

    test('returns empty array when session has no exams', async () => {
      prismaMock.exam.findMany.mockResolvedValue([]);

      const result = await examService.findAllBySession('empty-session');

      expect(result).toEqual([]);
    });
  });

  describe('findAllByAcademicYear', () => {
    test('returns exams across all sessions in an academic year', async () => {
      const exams = [
        mockExam({ id: 'exam-1', examSessionId: 's1', name: 'Midterm' }),
        mockExam({ id: 'exam-2', examSessionId: 's2', name: 'Final' }),
      ];
      prismaMock.exam.findMany.mockResolvedValue(exams as any);

      const result = await examService.findAllByAcademicYear('ay-2026');

      expect(prismaMock.exam.findMany).toHaveBeenCalledWith({
        where: { examSession: { academicYearId: 'ay-2026' } },
        orderBy: [{ examSession: { startDate: 'desc' } }, { startDate: 'desc' }],
        include: expect.objectContaining({
          examSession: { select: { id: true, name: true } },
        }),
      });
      expect(result).toHaveLength(2);
    });
  });

  describe('findById', () => {
    test('returns exam with full includes', async () => {
      const exam = mockExam({ id: 'exam-1' });
      prismaMock.exam.findUnique.mockResolvedValue(exam as any);

      const result = await examService.findById('exam-1');

      expect(result.id).toBe('exam-1');
    });

    test('throws 404 when not found', async () => {
      prismaMock.exam.findUnique.mockResolvedValue(null);

      await expect(examService.findById('missing'))
        .rejects.toMatchObject({ status: 404, message: 'Exam not found' });
    });
  });

  describe('create', () => {
    test('creates exam when examType belongs to same session', async () => {
      const examType = { id: 'type-1', examSessionId: 'session-1', name: 'Midterm', defaultWeight: 30 };
      const created = mockExam({ examSessionId: 'session-1', examTypeId: 'type-1' });
      prismaMock.examType.findUnique.mockResolvedValue(examType as any);
      prismaMock.exam.create.mockResolvedValue(created as any);

      const result = await examService.create('session-1', {
        name: 'Midterm Exam',
        examTypeId: 'type-1',
        startDate: new Date('2026-05-15'),
      }, 'admin-id');

      expect(result.name).toBe('Midterm Exam');
      expect(result.status).toBe('DRAFT');
    });

    test('throws 400 when examType belongs to different session', async () => {
      const examType = { id: 'type-1', examSessionId: 'session-2', name: 'Midterm' };
      prismaMock.examType.findUnique.mockResolvedValue(examType as any);

      await expect(examService.create('session-1', {
        name: 'Bad Exam',
        examTypeId: 'type-1',
        startDate: new Date('2026-05-15'),
      }, 'admin-id'))
        .rejects.toMatchObject({ status: 400, message: 'Exam type does not belong to this session' });
    });

    test('throws 404 when examType not found', async () => {
      prismaMock.examType.findUnique.mockResolvedValue(null);

      await expect(examService.create('session-1', {
        name: 'Exam',
        examTypeId: 'nonexistent',
        startDate: new Date('2026-05-15'),
      }, 'admin-id'))
        .rejects.toMatchObject({ status: 404, message: 'Exam type not found' });
    });

    test('creates a single-day exam when endDate omitted', async () => {
      const examType = { id: 'type-1', examSessionId: 'session-1' };
      const created = mockExam({ endDate: null });
      prismaMock.examType.findUnique.mockResolvedValue(examType as any);
      prismaMock.exam.create.mockResolvedValue(created as any);

      await examService.create('session-1', {
        name: 'Single Day',
        examTypeId: 'type-1',
        startDate: new Date('2026-05-15'),
      }, 'admin-id');

      expect(prismaMock.exam.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ endDate: undefined }),
        }),
      );
    });
  });

  describe('update', () => {
    test('updates exam name', async () => {
      const existing = mockExam({ id: 'exam-1', name: 'Old Name' });
      const updated = { ...existing, name: 'New Name' };
      prismaMock.exam.findUnique.mockResolvedValue(existing as any);
      prismaMock.exam.update.mockResolvedValue(updated as any);

      const result = await examService.update('exam-1', { name: 'New Name' });

      expect(result.name).toBe('New Name');
    });

    test('blocks DRAFT→ACTIVE when no examClasses exist', async () => {
      const existing = mockExam({ id: 'exam-1', status: 'DRAFT' });
      prismaMock.exam.findUnique.mockResolvedValue(existing as any);
      prismaMock.examClass.count.mockResolvedValue(0);

      await expect(examService.update('exam-1', { status: 'ACTIVE' }))
        .rejects.toMatchObject({ status: 400, message: expect.stringContaining('no classes') });
    });

    test('allows DRAFT→ACTIVE when examClasses exist', async () => {
      const existing = mockExam({ id: 'exam-1', status: 'DRAFT' });
      const updated = { ...existing, status: 'ACTIVE' as const };
      prismaMock.exam.findUnique.mockResolvedValue(existing as any);
      prismaMock.examClass.count.mockResolvedValue(2);
      prismaMock.exam.update.mockResolvedValue(updated as any);

      const result = await examService.update('exam-1', { status: 'ACTIVE' });

      expect(result.status).toBe('ACTIVE');
    });

    test('throws 404 when updating nonexistent exam', async () => {
      prismaMock.exam.findUnique.mockResolvedValue(null);

      await expect(examService.update('missing', { name: 'X' }))
        .rejects.toMatchObject({ status: 404 });
    });
  });

  describe('delete', () => {
    test('deletes an exam with no examClasses', async () => {
      const exam = mockExam({ id: 'exam-1', name: 'Midterm' });
      prismaMock.exam.findUnique.mockResolvedValue({ ...exam, _count: { examClasses: 0 } } as any);
      prismaMock.exam.delete.mockResolvedValue(exam as any);

      const result = await examService.delete('exam-1');

      expect(result.message).toContain('Midterm');
    });

    test('throws 409 when exam has classes', async () => {
      prismaMock.exam.findUnique.mockResolvedValue({
        id: 'exam-1', name: 'Midterm', _count: { examClasses: 2 },
      } as any);

      await expect(examService.delete('exam-1'))
        .rejects.toMatchObject({ status: 409, message: expect.stringContaining('2 class(es)') });
    });

    test('throws 404 when deleting nonexistent exam', async () => {
      prismaMock.exam.findUnique.mockResolvedValue(null);

      await expect(examService.delete('missing'))
        .rejects.toMatchObject({ status: 404 });
    });
  });
});
