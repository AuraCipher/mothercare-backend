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

describe('Subject result routes — scope + compute', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockScope();
  });

  test('POST compute-results requires academic year scope', async () => {
    (prismaMock.academicYear.findFirst as jest.Mock).mockResolvedValue(null);
    const res = await request(app)
      .post('/admin/exam-sessions/sess1/compute-results')
      .set(adminToken);
    expect(res.status).toBe(400);
  });

  test('POST compute-results runs session compute when scoped', async () => {
    (prismaMock.examSession.findFirst as jest.Mock).mockResolvedValue({
      id: 'sess1',
      academicYear: { branchId: 'b1' },
    });
    (prismaMock.examClassSubject.findMany as jest.Mock).mockResolvedValue([]);

    const res = await request(app)
      .post(`/admin/exam-sessions/sess1/compute-results?${SCOPE_QS}`)
      .set(adminToken);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.classSubjectCount).toBe(0);
  });

  test('POST class compute validates session in scope', async () => {
    (prismaMock.examSession.findFirst as jest.Mock).mockResolvedValue(null);

    const res = await request(app)
      .post(`/admin/exam-sessions/sess1/classes/class1/subjects/sub1/compute?${SCOPE_QS}`)
      .set(adminToken);

    expect(res.status).toBe(404);
  });

  test('GET student result requires scope', async () => {
    const res = await request(app)
      .get('/admin/students/s1/exam-sessions/sess1/subjects/sub1/result')
      .set(adminToken);
    expect(res.status).toBe(400);
  });
});

describe('Marks entry routes — scope', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockScope();
  });

  test('GET marks-grid requires scope', async () => {
    const res = await request(app)
      .get('/admin/exam-class-subjects/ecs1/marks-grid')
      .set(adminToken);
    expect(res.status).toBe(400);
  });

  test('GET marks-grid validates ECS in scope', async () => {
    (prismaMock.examClassSubject.findFirst as jest.Mock).mockResolvedValue({
      id: 'ecs1',
      subjectId: 'sub1',
      examClass: { classId: 'class1', exam: { id: 'e1', examSessionId: 'sess1' } },
    });
    (prismaMock.examClassSubject.findUnique as jest.Mock).mockResolvedValue({
      id: 'ecs1',
      totalMarks: 100,
      passingMarks: 40,
      subject: { id: 'sub1', name: 'Math', code: 'M' },
      examClass: {
        class: { id: 'class1', name: 'C1', section: 'A' },
        exam: { id: 'e1', name: 'Quiz', status: 'DRAFT' },
      },
    });
    (prismaMock.student.findMany as jest.Mock).mockResolvedValue([]);

    const res = await request(app)
      .get(`/admin/exam-class-subjects/ecs1/marks-grid?${SCOPE_QS}`)
      .set(adminToken);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
