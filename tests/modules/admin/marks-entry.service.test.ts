import { prismaMock } from '../../mocks/prisma';
import { marksEntryService } from '../../../src/modules/admin/services/marks-entry.service';

describe('MarksEntryService', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  const mockECS = {
    id: 'ecs-1',
    examClassId: 'ec-1',
    subjectId: 'sub-1',
    isActive: true,
    totalMarks: null,
    passingMarks: null,
    subject: { id: 'sub-1', name: 'English', code: 'ENG' },
    examClass: {
      classId: 'g-1',
      class: { id: 'g-1', name: 'Class 1', section: 'A' },
      exam: { id: 'exam-1', name: 'Quiz 1', status: 'DRAFT' as const },
    },
  };

  describe('getMarksGrid', () => {
    test('returns grid with all students when no ceiling set', async () => {
      prismaMock.examClassSubject.findUnique.mockResolvedValue(mockECS as any);
      prismaMock.student.findMany.mockResolvedValue([
        { id: 's1', name: 'Ahmed', rollNumber: '1', admissionNumber: 'ADM1', examMarks: [] },
        { id: 's2', name: 'Hira', rollNumber: '2', admissionNumber: 'ADM2', examMarks: [] },
      ] as any);

      const result = await marksEntryService.getMarksGrid('ecs-1');

      expect(result.totalMarks).toBeNull();
      expect(result.students).toHaveLength(2);
      expect(result.examStatus).toBe('DRAFT');
      expect(result.students[0].marksObtained).toBeNull();
    });

    test('returns grid with existing marks when present', async () => {
      prismaMock.examClassSubject.findUnique.mockResolvedValue({
        ...mockECS, totalMarks: 100, passingMarks: 40,
      } as any);
      prismaMock.student.findMany.mockResolvedValue([
        {
          id: 's1', name: 'Ahmed', rollNumber: '1', admissionNumber: 'ADM1',
          examMarks: [{ id: 'me-1', marksObtained: 85, isAbsent: false }],
        },
      ] as any);

      const result = await marksEntryService.getMarksGrid('ecs-1');

      expect(result.totalMarks).toBe(100);
      expect(result.students[0].marksObtained).toBe(85);
      expect(result.students[0].entryId).toBe('me-1');
    });

    test('throws 404 when ECS not found', async () => {
      prismaMock.examClassSubject.findUnique.mockResolvedValue(null);

      await expect(marksEntryService.getMarksGrid('missing'))
        .rejects.toMatchObject({ status: 404 });
    });
  });

  describe('saveMarks', () => {
    const ceilingECS = { ...mockECS, totalMarks: 100, passingMarks: 40 };
    const activeECS = { ...mockECS, totalMarks: 100, isActive: true };

    test('sets ceiling and saves marks for multiple students', async () => {
      prismaMock.examClassSubject.findUnique.mockResolvedValue(mockECS as any);
      (prismaMock as any).$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
      prismaMock.examClassSubject.update.mockResolvedValue({} as any);
      prismaMock.marksEntry.upsert.mockResolvedValue({} as any);
      prismaMock.examClassSubject.findMany.mockResolvedValue([ceilingECS] as any);
      prismaMock.student.findMany.mockResolvedValue([]);

      await marksEntryService.saveMarks('ecs-1', {
        totalMarks: 100,
        passingMarks: 40,
        entries: [
          { studentId: 's1', marksObtained: 85 },
          { studentId: 's2', marksObtained: 92 },
        ],
      }, 'teacher-id');

      expect(prismaMock.examClassSubject.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { totalMarks: 100, passingMarks: 40 } }),
      );
      expect(prismaMock.marksEntry.upsert).toHaveBeenCalledTimes(2);
    });

    test('rejects marksObtained exceeding totalMarks', async () => {
      prismaMock.examClassSubject.findUnique.mockResolvedValue(ceilingECS as any);

      await expect(marksEntryService.saveMarks('ecs-1', {
        entries: [{ studentId: 's1', marksObtained: 150 }],
      }, 'teacher-id'))
        .rejects.toMatchObject({
          status: 400,
          message: 'Validation failed',
          errors: expect.arrayContaining([
            expect.objectContaining({ field: 'marksObtained' }),
          ]),
        });
    });

    test('rejects absent student with marks', async () => {
      prismaMock.examClassSubject.findUnique.mockResolvedValue(ceilingECS as any);

      await expect(marksEntryService.saveMarks('ecs-1', {
        entries: [{ studentId: 's1', marksObtained: 50, isAbsent: true }],
      }, 'teacher-id'))
        .rejects.toMatchObject({
          status: 400,
          errors: expect.arrayContaining([
            expect.objectContaining({ field: 'marksObtained', message: expect.stringContaining('absent') }),
          ]),
        });
    });

    test('rejects negative marks', async () => {
      prismaMock.examClassSubject.findUnique.mockResolvedValue(ceilingECS as any);

      await expect(marksEntryService.saveMarks('ecs-1', {
        entries: [{ studentId: 's1', marksObtained: -5 }],
      }, 'teacher-id'))
        .rejects.toMatchObject({ status: 400 });
    });

    test('rejects save when exam is ACTIVE', async () => {
      prismaMock.examClassSubject.findUnique.mockResolvedValue({
        ...mockECS, totalMarks: 100,
        examClass: { ...mockECS.examClass, exam: { id: 'exam-1', name: 'Quiz 1', status: 'ACTIVE' as const } },
      } as any);

      await expect(marksEntryService.saveMarks('ecs-1', {
        entries: [{ studentId: 's1', marksObtained: 80 }],
      }, 'teacher-id'))
        .rejects.toMatchObject({ status: 400, message: expect.stringContaining('ACTIVE') });
    });

    test('rejects save when subject is disabled', async () => {
      prismaMock.examClassSubject.findUnique.mockResolvedValue({
        ...mockECS, totalMarks: 100, isActive: false,
      } as any);

      await expect(marksEntryService.saveMarks('ecs-1', {
        entries: [{ studentId: 's1', marksObtained: 80 }],
      }, 'teacher-id'))
        .rejects.toMatchObject({ status: 400, message: expect.stringContaining('disabled') });
    });

    test('requires totalMarks to be set on first save if not provided', async () => {
      prismaMock.examClassSubject.findUnique.mockResolvedValue(mockECS as any);

      await expect(marksEntryService.saveMarks('ecs-1', {
        entries: [{ studentId: 's1', marksObtained: 80 }],
      }, 'teacher-id'))
        .rejects.toMatchObject({ status: 400, message: expect.stringContaining('not set') });
    });

    test('allows absent students (marks set to null)', async () => {
      prismaMock.examClassSubject.findUnique.mockResolvedValue(ceilingECS as any);
      (prismaMock as any).$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
      prismaMock.marksEntry.upsert.mockResolvedValue({} as any);
      prismaMock.examClassSubject.findMany.mockResolvedValue([ceilingECS] as any);
      prismaMock.student.findMany.mockResolvedValue([]);

      await marksEntryService.saveMarks('ecs-1', {
        entries: [{ studentId: 's1', isAbsent: true }],
      }, 'teacher-id');

      expect(prismaMock.marksEntry.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ marksObtained: null, isAbsent: true }),
        }),
      );
    });

    test('throws 404 when ECS not found', async () => {
      prismaMock.examClassSubject.findUnique.mockResolvedValue(null);

      await expect(marksEntryService.saveMarks('missing', { entries: [] as any }, 'id'))
        .rejects.toMatchObject({ status: 404 });
    });
  });

  describe('deleteMarksEntry', () => {
    test('deletes a marks entry in DRAFT exam', async () => {
      prismaMock.marksEntry.findUnique.mockResolvedValue({
        id: 'me-1', studentId: 's1', marksObtained: 85, examClassSubjectId: 'ecs-1',
        examClassSubject: {
          isActive: true,
          examClass: { exam: { id: 'exam-1', name: 'Quiz 1', status: 'DRAFT' as const } },
        },
      } as any);
      prismaMock.marksEntry.delete.mockResolvedValue({} as any);

      const result = await marksEntryService.deleteMarksEntry('me-1');

      expect(result.message).toContain('deleted');
    });

    test('blocks delete when exam is ACTIVE', async () => {
      prismaMock.marksEntry.findUnique.mockResolvedValue({
        id: 'me-1', marksObtained: 85,
        examClassSubject: {
          isActive: true,
          examClass: { exam: { id: 'exam-1', name: 'Quiz 1', status: 'ACTIVE' as const } },
        },
      } as any);

      await expect(marksEntryService.deleteMarksEntry('me-1'))
        .rejects.toMatchObject({ status: 400 });
    });

    test('throws 404 when entry not found', async () => {
      prismaMock.marksEntry.findUnique.mockResolvedValue(null);

      await expect(marksEntryService.deleteMarksEntry('missing'))
        .rejects.toMatchObject({ status: 404 });
    });
  });
});
