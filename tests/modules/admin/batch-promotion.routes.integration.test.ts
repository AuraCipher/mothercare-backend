/**
 * Batch promotion wizard — HTTP routes.
 */
import { prismaMock } from '../../mocks/prisma';
import request from 'supertest';
import app from '../../../src/app';
import { generateTestToken, getAuthHeader } from '../../helpers/auth';
import { TEST_AY_ID, TEST_BRANCH_ID } from '../../helpers/integration';

jest.mock('../../../src/modules/admin/services/batch-promotion.service', () => ({
  batchPromotionService: {
    getPreconditions: jest.fn(),
    listRuns: jest.fn(),
    startRun: jest.fn(),
    getRun: jest.fn(),
    snapshotRun: jest.fn(),
    applyCarry: jest.fn(),
    publish: jest.fn(),
  },
}));

jest.mock('../../../src/modules/admin/services/staff.service', () => ({
  staffService: {
    resolveUserAccess: jest.fn().mockResolvedValue({ isRestricted: false, isFullAdmin: true, permissions: [] }),
  },
}));

import { batchPromotionService } from '../../../src/modules/admin/services/batch-promotion.service';
import { staffService } from '../../../src/modules/admin/services/staff.service';

const adminToken = getAuthHeader(
  generateTestToken('admin-1', 'management', {
    name: 'Branch Admin',
    branchIds: [TEST_BRANCH_ID],
  }),
);

const teacherToken = getAuthHeader(
  generateTestToken('teacher-u1', 'teacher', {
    name: 'Ms. Sarah',
    branchIds: [TEST_BRANCH_ID],
  }),
);

const basePath = `/admin/branches/${TEST_BRANCH_ID}/academic-years/${TEST_AY_ID}/promotion`;

describe('Batch promotion — HTTP routes', () => {
  beforeEach(() => jest.clearAllMocks());

  test('GET /preconditions 401 without token', async () => {
    const res = await request(app).get(`${basePath}/preconditions`);
    expect(res.status).toBe(401);
  });

  test('GET /preconditions returns wizard data', async () => {
    (batchPromotionService.getPreconditions as jest.Mock).mockResolvedValue({
      source: { id: TEST_AY_ID, status: 'ACTIVE' },
      buildYears: [],
      inProgressRun: null,
      defaultCarryOptions: { classes: true, students: true },
      acknowledgements: ['ack'],
    });

    const res = await request(app).get(`${basePath}/preconditions`).set(adminToken);

    expect(res.status).toBe(200);
    expect(res.body.data.fixedStudentRules).toBeDefined();
    expect(res.body.data.source.id).toBe(TEST_AY_ID);
  });

  test('GET /preconditions 403 when staff access restricted', async () => {
    (staffService.resolveUserAccess as jest.Mock).mockResolvedValueOnce({
      isRestricted: true,
      isFullAdmin: false,
      permissions: [],
    });

    const res = await request(app).get(`${basePath}/preconditions`).set(adminToken);
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/branch admin access/i);
  });

  test('GET /runs lists promotion runs', async () => {
    (batchPromotionService.listRuns as jest.Mock).mockResolvedValue([
      { id: 'run-1', phase: 'DRAFT' },
    ]);

    const res = await request(app).get(`${basePath}/runs`).set(adminToken);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });

  test('POST /start creates promotion run', async () => {
    (batchPromotionService.startRun as jest.Mock).mockResolvedValue({
      id: 'run-1',
      phase: 'DRAFT',
      targetAcademicYearId: 'ay-build',
    });

    const res = await request(app)
      .post(`${basePath}/start`)
      .set(adminToken)
      .send({ calendarId: 'cal-next', carryOptions: { students: true } });

    expect(res.status).toBe(201);
    expect(res.body.data.id).toBe('run-1');
    expect(batchPromotionService.startRun).toHaveBeenCalledWith(
      expect.objectContaining({
        branchId: TEST_BRANCH_ID,
        sourceAcademicYearId: TEST_AY_ID,
        promotedById: 'admin-1',
      }),
    );
  });

  test('GET /runs/:runId returns run detail', async () => {
    (batchPromotionService.getRun as jest.Mock).mockResolvedValue({
      id: 'run-1',
      phase: 'DRAFT',
    });

    const res = await request(app).get(`${basePath}/runs/run-1`).set(adminToken);
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe('run-1');
  });

  test('POST /runs/:runId/snapshot advances run', async () => {
    (batchPromotionService.snapshotRun as jest.Mock).mockResolvedValue({
      id: 'run-1',
      phase: 'SNAPSHOT_DONE',
    });

    const res = await request(app)
      .post(`${basePath}/runs/run-1/snapshot`)
      .set(adminToken)
      .send({});

    expect(res.status).toBe(200);
    expect(batchPromotionService.snapshotRun).toHaveBeenCalledWith('run-1', TEST_BRANCH_ID, 'admin-1');
  });

  test('POST /runs/:runId/apply carries data forward', async () => {
    (batchPromotionService.applyCarry as jest.Mock).mockResolvedValue({
      id: 'run-1',
      phase: 'APPLIED',
    });

    const res = await request(app)
      .post(`${basePath}/runs/run-1/apply`)
      .set(adminToken)
      .send({});

    expect(res.status).toBe(200);
    expect(batchPromotionService.applyCarry).toHaveBeenCalledWith('run-1', TEST_BRANCH_ID);
  });

  test('POST /runs/:runId/publish completes wizard', async () => {
    (batchPromotionService.publish as jest.Mock).mockResolvedValue({
      id: 'run-1',
      phase: 'PUBLISHED',
    });

    const res = await request(app)
      .post(`${basePath}/runs/run-1/publish`)
      .set(adminToken)
      .send({});

    expect(res.status).toBe(200);
    expect(batchPromotionService.publish).toHaveBeenCalledWith('run-1', TEST_BRANCH_ID);
  });

  test('teacher cannot start promotion run', async () => {
    const res = await request(app)
      .post(`${basePath}/start`)
      .set(teacherToken)
      .send({ calendarId: 'cal-next' });

    expect(res.status).toBe(403);
  });
});
