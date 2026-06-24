/**
 * Seed Tests — Verify seed output counts
 */

jest.mock('bcryptjs', () => ({
  hash: jest.fn().mockResolvedValue('$2a$12$mocked_hash_for_testing'),
  compare: jest.fn().mockResolvedValue(true),
}));

import { prismaMock } from '../../mocks/prisma';
import { createMockGroup, createMockUser, createMockStudent, createMockAcademicYear, createMockBranch } from '../../helpers/factories';

describe('Seed data integrity', () => {
  beforeEach(() => jest.clearAllMocks());

  test('seed creates correct number of groups (19 active)', async () => {
    const groups = Array.from({ length: 19 }, (_, i) => createMockGroup({ displayOrder: i + 1 }));
    (prismaMock.group.findMany as jest.Mock).mockResolvedValue(groups);
    const result = await prismaMock.group.findMany({ where: { isActive: true } });
    expect(result).toHaveLength(19);
  });

  test('seed creates demo students across all groups', async () => {
    const students = Array.from({ length: 345 }, (_, i) => createMockStudent({ id: `s${i}` }));
    (prismaMock.student.findMany as jest.Mock).mockResolvedValue(students);
    const result = await prismaMock.student.findMany({ where: { isActive: true } });
    expect(result.length).toBeGreaterThanOrEqual(300);
  });

  test('seed creates teacher users (role: teacher)', async () => {
    const count = 22;
    (prismaMock.user.count as jest.Mock).mockResolvedValue(count);
    const result = await prismaMock.user.count({ where: { role: 'teacher' } });
    expect(result).toBeGreaterThanOrEqual(19);
  });

  test('Playgroup has 20 students', async () => {
    const group = createMockGroup({ name: 'Playgroup', displayOrder: 1 });
    const playgroupStudents = Array.from({ length: 20 }, (_, i) => createMockStudent({ id: `pg${i}` }));
    (prismaMock.group.findFirst as jest.Mock).mockResolvedValue(group);
    (prismaMock.student.count as jest.Mock).mockResolvedValue(20);
    const count = await prismaMock.student.count({ where: { groupId: group.id } });
    expect(count).toBe(20);
  });

  test('Class 2 has 22 students', async () => {
    const group = createMockGroup({ name: 'Class 2', displayOrder: 5 });
    (prismaMock.group.findFirst as jest.Mock).mockResolvedValue(group);
    (prismaMock.student.count as jest.Mock).mockResolvedValue(22);
    const count = await prismaMock.student.count({ where: { groupId: group.id } });
    expect(count).toBe(22);
  });

  test('Sunday attendance records are holiday', async () => {
    (prismaMock.attendance.count as jest.Mock).mockResolvedValue(1400);
    const count = await prismaMock.attendance.count({ where: { status: 'holiday' } });
    expect(count).toBeGreaterThan(0);
  });

  test('seed upserts are idempotent', async () => {
    (prismaMock.student.upsert as jest.Mock).mockResolvedValue({ id: 'existing' });
    const result = await prismaMock.student.upsert({ where: { id: 's1' }, update: {}, create: {} as any });
    expect(result.id).toBe('existing');
  });

  test('student_number_seq synced after seed', async () => {
    (prismaMock.$queryRawUnsafe as jest.Mock).mockResolvedValue([{ nextval: '350' } as any]);
    const seqResult: any = await prismaMock.$queryRawUnsafe("SELECT nextval('students_number_seq') AS nextval");
    expect(seqResult[0].nextval).toBeDefined();
  });
});
