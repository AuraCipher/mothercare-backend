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

describe('Report card routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockScope();
  });

  test('POST compute-report-cards requires scope', async () => {
    (prismaMock.academicYear.findFirst as jest.Mock).mockResolvedValue(null);
    const res = await request(app)
      .post('/admin/result/sessions/sess1/compute-report-cards')
      .set(adminToken);
    expect(res.status).toBe(400);
  });

  test('POST compute-report-cards runs session bulk when scoped', async () => {
    (prismaMock.examSession.findFirst as jest.Mock).mockResolvedValue({
      id: 'sess1',
      academicYear: { branchId: 'b1' },
    });
    (prismaMock.student.findMany as jest.Mock).mockResolvedValue([]);

    const res = await request(app)
      .post(`/admin/result/sessions/sess1/compute-report-cards?${SCOPE_QS}`)
      .set(adminToken);

    expect(res.status).toBe(200);
    expect(res.body.data.reportCardCount).toBe(0);
  });

  test('GET report-card requires scope', async () => {
    const res = await request(app)
      .get('/admin/result/students/s1/sessions/sess1/report-card')
      .set(adminToken);
    expect(res.status).toBe(400);
  });

  test('POST publish requires scope', async () => {
    const res = await request(app)
      .post('/admin/result/report-cards/rc1/publish')
      .set(adminToken);
    expect(res.status).toBe(400);
  });

  test('GET class report-cards requires scope', async () => {
    const res = await request(app)
      .get('/admin/result/sessions/sess1/classes/class1/report-cards')
      .set(adminToken);
    expect(res.status).toBe(400);
  });
});
