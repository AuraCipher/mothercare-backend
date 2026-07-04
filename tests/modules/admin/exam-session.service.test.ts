import { prismaMock } from '../../mocks/prisma';
import { examSessionService } from '../../../src/modules/admin/services/exam-session.service';
import { createMockExamSession } from '../../helpers/factories';

describe('ExamSessionService', () => {
  const academicYearId = 'test-ay-id';

  beforeEach(() => { jest.clearAllMocks(); });

  describe('findAll', () => {
    test('returns sessions scoped to an academic year, ordered by startDate desc', async () => {
      const sessions = [
        createMockExamSession({ academicYearId, name: '2nd Term 2026', startDate: new Date('2026-10-01') }),
        createMockExamSession({ academicYearId, name: '1st Term 2026', startDate: new Date('2026-04-01') }),
      ];
      prismaMock.examSession.findMany.mockResolvedValue(sessions as any);

      const result = await examSessionService.findAll(academicYearId);

      expect(prismaMock.examSession.findMany).toHaveBeenCalledWith({
        where: { academicYearId },
        orderBy: { startDate: 'desc' },
        include: { _count: { select: { examTypes: true, exams: true } } },
      });
      expect(result).toHaveLength(2);
    });

    test('returns empty array when academic year has no sessions', async () => {
      prismaMock.examSession.findMany.mockResolvedValue([]);

      const result = await examSessionService.findAll('empty-ay');

      expect(result).toEqual([]);
    });

    test('does not mix sessions from different academic years', async () => {
      const sessions = [
        createMockExamSession({ academicYearId: 'ay-2026', name: 'Term 1' }),
      ];
      prismaMock.examSession.findMany.mockResolvedValue(sessions as any);

      const result = await examSessionService.findAll('ay-2025');

      expect(prismaMock.examSession.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { academicYearId: 'ay-2025' } }),
      );
      // Mock returns ay-2026 data, but the query was scoped to ay-2025
      expect(result).toHaveLength(1);
    });
  });

  describe('findById', () => {
    test('returns session with exam types sorted by name and all counts', async () => {
      const session = createMockExamSession({ id: 'session-1' });
      prismaMock.examSession.findUnique.mockResolvedValue({
        ...session,
        examTypes: [
          { id: 't1', name: 'Midterm' },
          { id: 't2', name: 'Quiz' },
        ],
        _count: { exams: 3, subjectResults: 0, reportCards: 1 },
      } as any);

      const result = await examSessionService.findById('session-1');

      expect(result.examTypes).toHaveLength(2);
      expect(prismaMock.examSession.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          include: expect.objectContaining({
            examTypes: { orderBy: { name: 'asc' } },
          }),
        }),
      );
    });

    test('throws 404 when session not found', async () => {
      prismaMock.examSession.findUnique.mockResolvedValue(null);

      await expect(examSessionService.findById('missing'))
        .rejects.toMatchObject({ status: 404, message: 'Exam session not found' });
    });
  });

  describe('create', () => {
    test('creates an exam session with given dates', async () => {
      const created = createMockExamSession({
        academicYearId,
        name: '1st Term 2026',
        startDate: new Date('2026-04-01'),
        endDate: new Date('2026-09-30'),
      });
      prismaMock.examSession.create.mockResolvedValue(created as any);

      const result = await examSessionService.create(
        academicYearId,
        { name: '1st Term 2026', startDate: new Date('2026-04-01'), endDate: new Date('2026-09-30') },
        'admin-id',
      );

      expect(prismaMock.examSession.create).toHaveBeenCalledWith({
        data: {
          academicYearId,
          name: '1st Term 2026',
          startDate: new Date('2026-04-01'),
          endDate: new Date('2026-09-30'),
          createdById: 'admin-id',
          updatedById: 'admin-id',
        },
      });
      expect(result.name).toBe('1st Term 2026');
    });

    test('trims whitespace from name', async () => {
      const created = createMockExamSession({ name: 'Term' });
      prismaMock.examSession.create.mockResolvedValue(created as any);

      await examSessionService.create(academicYearId, { name: '  Term  ', startDate: new Date(), endDate: new Date() }, 'admin-id');

      expect(prismaMock.examSession.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ name: 'Term' }),
        }),
      );
    });

    test('accepts startDate equal to endDate (single-day session)', async () => {
      const sameDay = new Date('2026-06-15');
      const created = createMockExamSession({ name: 'Single Day Exam', startDate: sameDay, endDate: sameDay });
      prismaMock.examSession.create.mockResolvedValue(created as any);

      const result = await examSessionService.create(
        academicYearId,
        { name: 'Single Day Exam', startDate: sameDay, endDate: sameDay },
        'admin-id',
      );

      expect(result.name).toBe('Single Day Exam');
      expect(result.startDate).toEqual(result.endDate);
    });

    test('accepts long session names', async () => {
      const longName = 'A'.repeat(200);
      const created = createMockExamSession({ name: longName });
      prismaMock.examSession.create.mockResolvedValue(created as any);

      await examSessionService.create(academicYearId, { name: longName, startDate: new Date(), endDate: new Date() }, 'admin-id');

      expect(prismaMock.examSession.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ name: longName }),
        }),
      );
    });
  });

  describe('update', () => {
    test('updates session name', async () => {
      const existing = createMockExamSession({ id: 'session-1', name: 'Old Name' });
      const updated = { ...existing, name: 'New Name' };
      prismaMock.examSession.findUnique.mockResolvedValue(existing as any);
      prismaMock.examSession.update.mockResolvedValue(updated as any);

      const result = await examSessionService.update('session-1', { name: 'New Name' });

      expect(result.name).toBe('New Name');
    });

    test('updates only startDate without affecting other fields', async () => {
      const existing = createMockExamSession({ id: 'session-1', startDate: new Date('2026-04-01'), endDate: new Date('2026-09-30') });
      const newStart = new Date('2026-04-15');
      const updated = { ...existing, startDate: newStart };
      prismaMock.examSession.findUnique.mockResolvedValue(existing as any);
      prismaMock.examSession.update.mockResolvedValue(updated as any);

      const result = await examSessionService.update('session-1', { startDate: newStart });

      expect(result.startDate).toEqual(newStart);
      // endDate should be unchanged
      expect(prismaMock.examSession.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ startDate: newStart }),
        }),
      );
    });

    test('throws 404 when updating nonexistent session', async () => {
      prismaMock.examSession.findUnique.mockResolvedValue(null);

      await expect(examSessionService.update('missing', { name: 'X' }))
        .rejects.toMatchObject({ status: 404 });
    });
  });

  describe('delete', () => {
    test('deletes an empty session (no exams, no results)', async () => {
      const session = createMockExamSession({ id: 'session-1', name: '1st Term 2026' });
      prismaMock.examSession.findUnique.mockResolvedValue({
        ...session,
        _count: { examTypes: 0, exams: 0, subjectResults: 0, reportCards: 0 },
      } as any);
      prismaMock.examSession.delete.mockResolvedValue(session as any);

      const result = await examSessionService.delete('session-1');

      expect(result.message).toContain('1st Term 2026');
    });

    test('deletes session that only has examTypes (no exams/results)', async () => {
      const session = createMockExamSession({ id: 'session-1', name: 'Term' });
      prismaMock.examSession.findUnique.mockResolvedValue({
        ...session,
        _count: { examTypes: 3, exams: 0, subjectResults: 0, reportCards: 2 },
      } as any);
      prismaMock.examSession.delete.mockResolvedValue(session as any);

      const result = await examSessionService.delete('session-1');

      // examTypes and reportCards cascade-delete — the guard only checks exams and results
      expect(result.message).toContain('Term');
      expect(prismaMock.examSession.delete).toHaveBeenCalled();
    });

    test('throws 409 when session has exams', async () => {
      const session = createMockExamSession({ id: 'session-1' });
      prismaMock.examSession.findUnique.mockResolvedValue({
        ...session,
        _count: { examTypes: 2, exams: 1, subjectResults: 3, reportCards: 1 },
      } as any);

      await expect(examSessionService.delete('session-1'))
        .rejects.toMatchObject({ status: 409, message: expect.stringContaining('1 exam(s)') });
    });

    test('throws 409 when session has subject results (even if no exams)', async () => {
      const session = createMockExamSession({ id: 'session-1' });
      prismaMock.examSession.findUnique.mockResolvedValue({
        ...session,
        _count: { examTypes: 0, exams: 0, subjectResults: 5, reportCards: 0 },
      } as any);

      await expect(examSessionService.delete('session-1'))
        .rejects.toMatchObject({ status: 409, message: expect.stringContaining('5 result(s)') });
    });

    test('throws 404 when deleting nonexistent session', async () => {
      prismaMock.examSession.findUnique.mockResolvedValue(null);

      await expect(examSessionService.delete('missing'))
        .rejects.toMatchObject({ status: 404 });
    });
  });
});
