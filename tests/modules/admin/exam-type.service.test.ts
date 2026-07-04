import { prismaMock } from '../../mocks/prisma';
import { examTypeService } from '../../../src/modules/admin/services/exam-type.service';
import { createMockExamType, createMockExamSession } from '../../helpers/factories';

describe('ExamTypeService', () => {
  const mockSession = createMockExamSession();
  const sessionId = mockSession.id;

  beforeEach(() => { jest.clearAllMocks(); });

  describe('findAll', () => {
    test('returns exam types scoped to a session', async () => {
      const types = [
        createMockExamType({ examSessionId: sessionId, name: 'Final', defaultWeight: 50 }),
        createMockExamType({ examSessionId: sessionId, name: 'Midterm', defaultWeight: 30 }),
      ];
      prismaMock.examType.findMany.mockResolvedValue(types as any);

      const result = await examTypeService.findAll(sessionId);

      expect(prismaMock.examType.findMany).toHaveBeenCalledWith({
        where: { examSessionId: sessionId },
        orderBy: { name: 'asc' },
      });
      expect(result).toHaveLength(2);
    });

    test('returns empty array when session has no types', async () => {
      prismaMock.examType.findMany.mockResolvedValue([]);

      const result = await examTypeService.findAll('nonexistent-session');

      expect(result).toEqual([]);
    });

    test('returns types alphabetically sorted by name', async () => {
      const types = [
        createMockExamType({ examSessionId: sessionId, name: 'Quiz' }),
        createMockExamType({ examSessionId: sessionId, name: 'Final' }),
        createMockExamType({ examSessionId: sessionId, name: 'Midterm' }),
      ];
      prismaMock.examType.findMany.mockResolvedValue(types as any);

      const result = await examTypeService.findAll(sessionId);

      expect(prismaMock.examType.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { name: 'asc' } }),
      );
      expect(result).toHaveLength(3);
    });

    test('scopes to a single session — types from other sessions are excluded', async () => {
      const sessionA = createMockExamType({ examSessionId: 'session-a', name: 'Quiz' });
      prismaMock.examType.findMany.mockResolvedValue([sessionA] as any);

      const result = await examTypeService.findAll('session-a');

      expect(prismaMock.examType.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { examSessionId: 'session-a' } }),
      );
      expect(result).toHaveLength(1);
    });
  });

  describe('findById', () => {
    test('returns exam type when found', async () => {
      const type = createMockExamType({ id: 'type-1' });
      prismaMock.examType.findUnique.mockResolvedValue(type as any);

      const result = await examTypeService.findById('type-1');

      expect(result.id).toBe('type-1');
    });

    test('throws 404 when not found', async () => {
      prismaMock.examType.findUnique.mockResolvedValue(null);

      await expect(examTypeService.findById('missing-id'))
        .rejects.toMatchObject({ status: 404, message: 'Exam type not found' });
    });
  });

  describe('create', () => {
    test('creates an exam type with examSessionId', async () => {
      const created = createMockExamType({ examSessionId: sessionId, name: 'Quiz', defaultWeight: 10 });
      prismaMock.examType.create.mockResolvedValue(created as any);

      const result = await examTypeService.create(sessionId, { name: 'Quiz', defaultWeight: 10 }, 'admin-id');

      expect(prismaMock.examType.create).toHaveBeenCalledWith({
        data: {
          examSessionId: sessionId,
          name: 'Quiz',
          defaultWeight: 10,
          createdById: 'admin-id',
          updatedById: 'admin-id',
        },
      });
      expect(result.name).toBe('Quiz');
      expect(result.defaultWeight).toBe(10);
    });

    test('creates without defaultWeight when not provided', async () => {
      const created = createMockExamType({ examSessionId: sessionId, name: 'Quiz', defaultWeight: null });
      prismaMock.examType.create.mockResolvedValue(created as any);

      const result = await examTypeService.create(sessionId, { name: 'Quiz' }, 'admin-id');

      expect(prismaMock.examType.create).toHaveBeenCalled();
      expect(result.name).toBe('Quiz');
    });

    test('trims whitespace from name', async () => {
      const created = createMockExamType({ name: 'Quiz' });
      prismaMock.examType.create.mockResolvedValue(created as any);

      await examTypeService.create(sessionId, { name: '  Quiz  ' }, 'admin-id');

      expect(prismaMock.examType.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ name: 'Quiz' }),
        }),
      );
    });

    test('accepts defaultWeight = 0 as valid lower boundary', async () => {
      const created = createMockExamType({ name: 'Quiz', defaultWeight: 0 });
      prismaMock.examType.create.mockResolvedValue(created as any);

      const result = await examTypeService.create(sessionId, { name: 'Quiz', defaultWeight: 0 }, 'admin-id');

      expect(result.defaultWeight).toBe(0);
      expect(prismaMock.examType.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ defaultWeight: 0 }),
        }),
      );
    });

    test('accepts defaultWeight = 100 as valid upper boundary', async () => {
      const created = createMockExamType({ name: 'Final', defaultWeight: 100 });
      prismaMock.examType.create.mockResolvedValue(created as any);

      const result = await examTypeService.create(sessionId, { name: 'Final', defaultWeight: 100 }, 'admin-id');

      expect(result.defaultWeight).toBe(100);
    });

    test('accepts special characters in name', async () => {
      const created = createMockExamType({ name: 'Quiz/Midterm (2026)' });
      prismaMock.examType.create.mockResolvedValue(created as any);

      await examTypeService.create(sessionId, { name: 'Quiz/Midterm (2026)' }, 'admin-id');

      expect(prismaMock.examType.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ name: 'Quiz/Midterm (2026)' }),
        }),
      );
    });
  });

  describe('update', () => {
    test('updates defaultWeight and returns updated type', async () => {
      const existing = createMockExamType({ id: 'type-1', name: 'Quiz', defaultWeight: 10 });
      const updated = { ...existing, defaultWeight: 20 };
      prismaMock.examType.findUnique.mockResolvedValue(existing as any);
      prismaMock.examType.update.mockResolvedValue(updated as any);

      const result = await examTypeService.update('type-1', { defaultWeight: 20 });

      expect(result.defaultWeight).toBe(20);
    });

    test('throws 404 when updating nonexistent type', async () => {
      prismaMock.examType.findUnique.mockResolvedValue(null);

      await expect(examTypeService.update('missing', { name: 'New' }))
        .rejects.toMatchObject({ status: 404 });
    });

    test('updates both name and weight simultaneously', async () => {
      const existing = createMockExamType({ id: 'type-1', name: 'Quiz', defaultWeight: 10 });
      const updated = { ...existing, name: 'Final Exam', defaultWeight: 40 };
      prismaMock.examType.findUnique.mockResolvedValue(existing as any);
      prismaMock.examType.update.mockResolvedValue(updated as any);

      const result = await examTypeService.update('type-1', { name: 'Final Exam', defaultWeight: 40 });

      expect(result.name).toBe('Final Exam');
      expect(result.defaultWeight).toBe(40);
    });

    test('clears defaultWeight when explicitly set to null', async () => {
      const existing = createMockExamType({ id: 'type-1', name: 'Quiz', defaultWeight: 50 });
      const updated = { ...existing, defaultWeight: null };
      prismaMock.examType.findUnique.mockResolvedValue(existing as any);
      prismaMock.examType.update.mockResolvedValue(updated as any);

      const result = await examTypeService.update('type-1', { defaultWeight: null });

      expect(result.defaultWeight).toBeNull();
    });
  });

  describe('delete', () => {
    test('deletes an unused exam type', async () => {
      const type = createMockExamType({ id: 'type-1', name: 'Quiz', defaultWeight: 10 });
      prismaMock.examType.findUnique.mockResolvedValue({
        ...type,
        _count: { exams: 0 },
      } as any);
      prismaMock.examType.delete.mockResolvedValue(type as any);

      const result = await examTypeService.delete('type-1');

      expect(result.message).toContain('Quiz');
      expect(prismaMock.examType.delete).toHaveBeenCalledWith({ where: { id: 'type-1' } });
    });

    test('throws 409 when type is linked to exams', async () => {
      const type = createMockExamType({ id: 'type-1', name: 'Quiz' });
      prismaMock.examType.findUnique.mockResolvedValue({
        ...type,
        _count: { exams: 3 },
      } as any);

      await expect(examTypeService.delete('type-1'))
        .rejects.toMatchObject({ status: 409, message: expect.stringContaining('3 exam(s)') });
    });

    test('throws 404 when deleting nonexistent type', async () => {
      prismaMock.examType.findUnique.mockResolvedValue(null);

      await expect(examTypeService.delete('missing'))
        .rejects.toMatchObject({ status: 404 });
    });

    test('delete message includes the type name', async () => {
      const type = createMockExamType({ id: 'type-1', name: 'Practical' });
      prismaMock.examType.findUnique.mockResolvedValue({ ...type, _count: { exams: 0 } } as any);
      prismaMock.examType.delete.mockResolvedValue(type as any);

      const result = await examTypeService.delete('type-1');

      expect(result.message).toContain('Practical');
    });

    test('uses _count to pre-query exams before deleting', async () => {
      const type = createMockExamType({ id: 'type-1', name: 'Quiz' });
      prismaMock.examType.findUnique.mockResolvedValue({ ...type, _count: { exams: 0 } } as any);
      prismaMock.examType.delete.mockResolvedValue(type as any);

      await examTypeService.delete('type-1');

      // Verify the pre-query happens with _count.exams
      expect(prismaMock.examType.findUnique).toHaveBeenCalledWith({
        where: { id: 'type-1' },
        include: { _count: { select: { exams: true } } },
      });
    });
  });
});
