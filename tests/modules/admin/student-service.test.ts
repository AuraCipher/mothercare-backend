/**
 * Student Service Tests
 *
 * Tests StudentService.findAll and StudentService.create methods.
 */

jest.mock('bcryptjs', () => ({
  hash: jest.fn().mockResolvedValue('$2a$12$mocked_hash_for_testing'),
  compare: jest.fn().mockResolvedValue(true),
}));

import { prismaMock } from '../../mocks/prisma';
import { studentService } from '../../../src/modules/admin/services/student.service';

describe('StudentService.findAll', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns all students when limit: -1 (no pagination)', async () => {
    (prismaMock.student.findMany as jest.Mock).mockResolvedValue([{ id: 's1' }, { id: 's2' }]);
    (prismaMock.student.count as jest.Mock).mockResolvedValue(2);

    const result = await studentService.findAll({ limit: -1 });
    const call = (prismaMock.student.findMany as jest.Mock).mock.calls[0][0];
    expect(call.take).toBeUndefined();
    expect(result.data).toHaveLength(2);
  });

  test('applies default pagination limit of 20', async () => {
    (prismaMock.student.findMany as jest.Mock).mockResolvedValue([]);
    (prismaMock.student.count as jest.Mock).mockResolvedValue(0);

    await studentService.findAll({});
    const call = (prismaMock.student.findMany as jest.Mock).mock.calls[0][0];
    expect(call.take).toBe(20);
    expect(call.skip).toBe(0);
  });

  test('orders by group displayOrder ascending', async () => {
    (prismaMock.student.findMany as jest.Mock).mockResolvedValue([]);
    (prismaMock.student.count as jest.Mock).mockResolvedValue(0);

    await studentService.findAll({ limit: -1 });
    const call = (prismaMock.student.findMany as jest.Mock).mock.calls[0][0];
    expect(call.orderBy).toEqual([{ group: { displayOrder: 'asc' } }, { rollNumber: 'asc' }]);
  });

  test('filters by groupId', async () => {
    (prismaMock.student.findMany as jest.Mock).mockResolvedValue([]);
    (prismaMock.student.count as jest.Mock).mockResolvedValue(0);

    await studentService.findAll({ groupId: 'g1', limit: -1 });
    const call = (prismaMock.student.findMany as jest.Mock).mock.calls[0][0];
    expect(call.where.groupId).toBe('g1');
  });

  test('searches by name', async () => {
    (prismaMock.student.findMany as jest.Mock).mockResolvedValue([]);
    (prismaMock.student.count as jest.Mock).mockResolvedValue(0);

    await studentService.findAll({ search: 'Ali', limit: -1 });
    const call = (prismaMock.student.findMany as jest.Mock).mock.calls[0][0];
    expect(call.where.OR).toBeDefined();
  });

  test('returns total count in meta', async () => {
    (prismaMock.student.findMany as jest.Mock).mockResolvedValue([{ id: 's1' }]);
    (prismaMock.student.count as jest.Mock).mockResolvedValue(1);

    const result = await studentService.findAll({ limit: -1 });
    expect(result.meta.total).toBe(1);
  });

  test('paginates correctly with page and limit', async () => {
    (prismaMock.student.findMany as jest.Mock).mockResolvedValue([]);
    (prismaMock.student.count as jest.Mock).mockResolvedValue(50);

    await studentService.findAll({ page: 2, limit: 10 });
    const call = (prismaMock.student.findMany as jest.Mock).mock.calls[0][0];
    expect(call.skip).toBe(10);
    expect(call.take).toBe(10);
  });
});

describe('StudentService.create — rollNumber auto-assignment', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (prismaMock.academicYear.findFirst as jest.Mock).mockResolvedValue({ id: 'ay1' });
  });

  test('auto-assigns rollNumber sequentially within group', async () => {
    (prismaMock.student.count as jest.Mock).mockResolvedValue(5);
    (prismaMock.student.findFirst as jest.Mock).mockResolvedValue({ studentNumber: 100 });
    (prismaMock.$queryRawUnsafe as jest.Mock).mockRejectedValue(new Error('no seq'));
    (prismaMock.student.create as jest.Mock).mockResolvedValue({ id: 's1', name: 'New Student', groupId: 'g1', rollNumber: '6' });

    await studentService.create({ name: 'New Student', groupId: 'g1' } as any);
    const call = (prismaMock.student.create as jest.Mock).mock.calls[0][0];
    expect(call.data.rollNumber).toBe('6');
  });

  test('uses count 0 for groups with no students', async () => {
    (prismaMock.student.count as jest.Mock).mockResolvedValue(0);
    (prismaMock.student.findFirst as jest.Mock).mockResolvedValue({ studentNumber: 200 });
    (prismaMock.$queryRawUnsafe as jest.Mock).mockRejectedValue(new Error('no seq'));
    (prismaMock.student.create as jest.Mock).mockResolvedValue({ id: 's1', name: 'New', groupId: 'g1', rollNumber: '1' });

    await studentService.create({ name: 'New', groupId: 'g1' } as any);
    const call = (prismaMock.student.create as jest.Mock).mock.calls[0][0];
    expect(call.data.rollNumber).toBe('1');
  });

  test('respects manual rollNumber override', async () => {
    (prismaMock.student.findFirst as jest.Mock).mockResolvedValue({ studentNumber: 300 });
    (prismaMock.$queryRawUnsafe as jest.Mock).mockRejectedValue(new Error('no seq'));
    (prismaMock.student.create as jest.Mock).mockResolvedValue({ id: 's1', rollNumber: '99' });

    await studentService.create({ name: 'Existing', groupId: 'g1', rollNumber: '99' } as any);
    const call = (prismaMock.student.create as jest.Mock).mock.calls[0][0];
    expect(call.data.rollNumber).toBe('99');
  });

  test('does not assign rollNumber if no groupId', async () => {
    (prismaMock.student.findFirst as jest.Mock).mockResolvedValue({ studentNumber: 400 });
    (prismaMock.$queryRawUnsafe as jest.Mock).mockRejectedValue(new Error('no seq'));
    (prismaMock.student.create as jest.Mock).mockResolvedValue({ id: 's1', name: 'No Group' });

    await studentService.create({ name: 'No Group' } as any);
    const call = (prismaMock.student.create as jest.Mock).mock.calls[0][0];
    expect(call.data.rollNumber).toBeUndefined();
  });

  test('generates admissionNumber when not provided', async () => {
    (prismaMock.student.findFirst as jest.Mock).mockResolvedValue({ studentNumber: 500 });
    (prismaMock.$queryRawUnsafe as jest.Mock).mockRejectedValue(new Error('no seq'));
    (prismaMock.student.create as jest.Mock).mockResolvedValue({ id: 's1' });

    await studentService.create({ name: 'Test' } as any);
    const call = (prismaMock.student.create as jest.Mock).mock.calls[0][0];
    expect(call.data.admissionNumber).toContain('MCS-');
  });

  test('generates username via utility', async () => {
    (prismaMock.student.findFirst as jest.Mock).mockResolvedValue({ studentNumber: 600 });
    (prismaMock.$queryRawUnsafe as jest.Mock).mockRejectedValue(new Error('no seq'));
    (prismaMock.student.create as jest.Mock).mockResolvedValue({ id: 's1' });

    await studentService.create({ name: 'Ali', groupId: 'g1' } as any);
    const call = (prismaMock.student.create as jest.Mock).mock.calls[0][0];
    expect(call.data.username).toBeDefined();
  });

  test('requires student name', async () => {
    await expect(studentService.create({} as any)).rejects.toBeDefined();
  });
});
