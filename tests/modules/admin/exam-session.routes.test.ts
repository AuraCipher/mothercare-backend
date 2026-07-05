jest.mock('bcryptjs', () => ({
  hash: jest.fn().mockResolvedValue('$2a$12$mocked_hash_for_testing'),
  compare: jest.fn().mockResolvedValue(true),
}));

jest.mock('../../../src/services/audit.service', () => ({
  logAudit: jest.fn().mockResolvedValue(undefined),
}));

import { prismaMock } from '../../mocks/prisma';
import request from 'supertest';
import app from '../../../src/app';
import { generateTestToken, getAuthHeader } from '../../helpers/auth';

const adminToken = getAuthHeader(generateTestToken('admin-1', 'super_admin'));
const SCOPE_QS = 'academicYearId=ay1&branchId=b1';

function mockScope() {
  (prismaMock.academicYear.findUnique as jest.Mock).mockResolvedValue({ id: 'ay1', branchId: 'b1' });
}

describe('Exam session routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockScope();
  });

  test('GET /admin/exam-sessions requires scope', async () => {
    (prismaMock.academicYear.findFirst as jest.Mock).mockResolvedValue(null);
    const res = await request(app).get('/admin/exam-sessions').set(adminToken);
    expect(res.status).toBe(400);
  });

  test('GET /admin/exam-sessions lists sessions when scoped', async () => {
    (prismaMock.examSession.findMany as jest.Mock).mockResolvedValue([
      { id: 'sess1', name: 'Mid Term', _count: { examTypes: 2, exams: 3 } },
    ]);

    const res = await request(app)
      .get(`/admin/exam-sessions?${SCOPE_QS}`)
      .set(adminToken);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(prismaMock.examSession.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { academicYearId: 'ay1' },
    }));
  });

  test('GET /admin/result/sessions/:id/summary requires scope', async () => {
    const res = await request(app)
      .get('/admin/result/sessions/sess1/summary')
      .set(adminToken);
    expect(res.status).toBe(400);
  });

  test('GET /admin/result/sessions/:id/summary returns progress when scoped', async () => {
    (prismaMock.examSession.findFirst as jest.Mock).mockResolvedValue({
      id: 'sess1',
      academicYear: { branchId: 'b1' },
    });
    (prismaMock.examSession.findUnique as jest.Mock).mockResolvedValue({
      id: 'sess1',
      name: 'Mid Term',
      startDate: new Date('2026-01-01'),
      endDate: new Date('2026-03-01'),
      academicYearId: 'ay1',
      _count: { examTypes: 1, exams: 1, subjectResults: 0, reportCards: 0 },
    });
    (prismaMock.exam.findMany as jest.Mock).mockResolvedValue([]);

    const res = await request(app)
      .get(`/admin/result/sessions/sess1/summary?${SCOPE_QS}`)
      .set(adminToken);

    expect(res.status).toBe(200);
    expect(res.body.data.session.id).toBe('sess1');
    expect(res.body.data.marksProgress).toEqual({ total: 0, filled: 0, percent: 0 });
  });
});
