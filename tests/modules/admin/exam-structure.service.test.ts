import { prismaMock } from '../../mocks/prisma';
import { examStructureService } from '../../../src/modules/admin/services/exam-structure.service';

describe('ExamStructureService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prismaMock.examClassSubject.findUnique.mockReset();
    prismaMock.examClassSubject.update.mockReset();
  });

  const mockExam = { id: 'exam-1', examSessionId: 's1' };
  const mockSession = { academicYearId: 'ay-1' };
  const mockGroups = [
    { id: 'g1', name: 'Class 1', groupSubjects: [{ subject: { id: 'sub1', name: 'English', code: 'ENG' } }] },
    { id: 'g2', name: 'Class 2', groupSubjects: [
      { subject: { id: 'sub2', name: 'Math', code: 'MATH' } },
      { subject: { id: 'sub3', name: 'Science', code: 'SCI' } },
    ] },
  ];

  describe('generateStructure', () => {
    test('creates ExamClass + ExamClassSubject rows for all groups and subjects', async () => {
      prismaMock.exam.findUnique.mockResolvedValue({ ...mockExam, examSession: mockSession } as any);
      prismaMock.group.findMany.mockResolvedValue(mockGroups as any);
      (prismaMock as any).$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
      prismaMock.examClass.findUnique.mockResolvedValue(null); // no existing
      prismaMock.examClass.create.mockResolvedValue({ id: 'new-ec' } as any);
      prismaMock.examClassSubject.findUnique.mockResolvedValue(null);
      prismaMock.examClassSubject.create.mockResolvedValue({} as any);
      prismaMock.examClass.count.mockResolvedValue(2);
      prismaMock.examClassSubject.count.mockResolvedValue(3);
      // getStructure call inside generateStructure
      prismaMock.examClass.findMany.mockResolvedValue([]);

      const result = await examStructureService.generateStructure('exam-1', 'admin-id');

      expect(prismaMock.examClass.create).toHaveBeenCalledTimes(2);
      expect(prismaMock.examClassSubject.create).toHaveBeenCalledTimes(3);
      expect(result).toBeDefined();
    });

    test('syncs missing subjects on already-existing ExamClass rows', async () => {
      prismaMock.exam.findUnique.mockResolvedValue({ ...mockExam, examSession: mockSession } as any);
      prismaMock.group.findMany.mockResolvedValue(mockGroups as any);
      (prismaMock as any).$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
      prismaMock.examClass.findUnique
        .mockResolvedValueOnce({ id: 'existing-ec' } as any)
        .mockResolvedValueOnce(null);
      prismaMock.examClass.create.mockResolvedValue({ id: 'new-ec' } as any);
      prismaMock.examClassSubject.findUnique
        .mockResolvedValueOnce({ id: 'ecs-existing' } as any)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);
      prismaMock.examClassSubject.create.mockResolvedValue({} as any);
      prismaMock.examClass.count.mockResolvedValue(2);
      prismaMock.examClassSubject.count.mockResolvedValue(4);
      prismaMock.examClass.findMany.mockResolvedValue([]);

      await examStructureService.generateStructure('exam-1', 'admin-id');

      expect(prismaMock.examClass.create).toHaveBeenCalledTimes(1);
      // g1: 0 new subjects (1 exists), g2: 2 new subjects
      expect(prismaMock.examClassSubject.create).toHaveBeenCalledTimes(2);
    });

    test('throws 404 when exam not found', async () => {
      prismaMock.exam.findUnique.mockResolvedValue(null);

      await expect(examStructureService.generateStructure('missing', 'admin-id'))
        .rejects.toMatchObject({ status: 404 });
    });

    test('throws 400 when no classes found for AY', async () => {
      prismaMock.exam.findUnique.mockResolvedValue({ ...mockExam, examSession: mockSession } as any);
      prismaMock.group.findMany.mockResolvedValue([]);

      await expect(examStructureService.generateStructure('exam-1', 'admin-id'))
        .rejects.toMatchObject({ status: 400, message: expect.stringContaining('No classes found') });
    });
  });

  describe('toggleClass', () => {
    test('toggles class off and cascades to subjects', async () => {
      prismaMock.examClass.findUnique.mockResolvedValue({
        id: 'ec-1', examId: 'exam-1',
        subjects: [
          { id: 'ecs-1', _count: { marksEntries: 0 } },
          { id: 'ecs-2', _count: { marksEntries: 0 } },
        ],
      } as any);
      prismaMock.examClass.update.mockResolvedValue({ id: 'ec-1', isActive: false } as any);
      prismaMock.examClassSubject.updateMany.mockResolvedValue({ count: 2 } as any);

      const result = await examStructureService.toggleClass('ec-1', false);

      expect(result.isActive).toBe(false);
      expect(prismaMock.examClassSubject.updateMany).toHaveBeenCalledWith({
        where: { examClassId: 'ec-1' },
        data: { isActive: false },
      });
    });

    test('blocks toggle off when marks exist', async () => {
      prismaMock.examClass.findUnique.mockResolvedValue({
        id: 'ec-1',
        subjects: [
          { id: 'ecs-1', _count: { marksEntries: 0 } },
          { id: 'ecs-2', _count: { marksEntries: 3 } }, // has marks
        ],
      } as any);

      await expect(examStructureService.toggleClass('ec-1', false))
        .rejects.toMatchObject({ status: 409, message: expect.stringContaining('marks') });
    });

    test('throws 404 when class not found', async () => {
      prismaMock.examClass.findUnique.mockResolvedValue(null);

      await expect(examStructureService.toggleClass('missing', false))
        .rejects.toMatchObject({ status: 404 });
    });

    test('allows toggling back on even when marks exist', async () => {
      prismaMock.examClass.findUnique.mockResolvedValue({
        id: 'ec-1',
        subjects: [
          { id: 'ecs-1', _count: { marksEntries: 3 } },
        ],
      } as any);
      prismaMock.examClass.update.mockResolvedValue({ id: 'ec-1', isActive: true } as any);
      prismaMock.examClassSubject.updateMany.mockResolvedValue({ count: 1 } as any);

      const result = await examStructureService.toggleClass('ec-1', true);

      expect(result.isActive).toBe(true);
    });
  });

  describe('toggleSubject', () => {
    test('toggles subject off when no marks exist', async () => {
      prismaMock.examClassSubject.findUnique.mockResolvedValue({
        id: 'ecs-1', _count: { marksEntries: 0 },
      } as any);
      prismaMock.examClassSubject.update.mockResolvedValue({ id: 'ecs-1', isActive: false } as any);

      const result = await examStructureService.toggleSubject('ecs-1', false);

      expect(result.isActive).toBe(false);
    });

    test('blocks toggle off when marks exist', async () => {
      prismaMock.examClassSubject.findUnique.mockResolvedValue({
        id: 'ecs-1', _count: { marksEntries: 5 },
      } as any);

      await expect(examStructureService.toggleSubject('ecs-1', false))
        .rejects.toMatchObject({ status: 409 });
    });

    test('throws 404 when subject not found', async () => {
      prismaMock.examClassSubject.findUnique.mockResolvedValue(null);

      await expect(examStructureService.toggleSubject('missing', false))
        .rejects.toMatchObject({ status: 404 });
    });
  });

  describe('getStructure', () => {
    test('returns nested tree with hasMarks booleans', async () => {
      prismaMock.examClass.findMany.mockResolvedValue([
        {
          id: 'ec-1', examId: 'exam-1', classId: 'g1', isActive: true,
          class: { id: 'g1', name: 'Class 1', section: 'A' },
          subjects: [
            { id: 'ecs-1', isActive: true, totalMarks: null, passingMarks: null,
              subject: { id: 'sub1', name: 'English', code: 'ENG' },
              _count: { marksEntries: 0 } },
            { id: 'ecs-2', isActive: true, totalMarks: null, passingMarks: null,
              subject: { id: 'sub2', name: 'Math', code: 'MATH' },
              _count: { marksEntries: 2 } },
          ],
        } as any,
      ]);

      const result = await examStructureService.getStructure('exam-1');

      expect(result).toHaveLength(1);
      expect(result[0].class.name).toBe('Class 1');
      expect(result[0].hasMarks).toBe(true); // at least one subject has marks
      expect(result[0].subjects).toHaveLength(2);
      expect(result[0].subjects[0].hasMarks).toBe(false);
      expect(result[0].subjects[1].hasMarks).toBe(true);
    });

    test('returns empty array when exam has no structure', async () => {
      prismaMock.examClass.findMany.mockResolvedValue([]);

      const result = await examStructureService.getStructure('exam-empty');

      expect(result).toEqual([]);
    });
  });
});
