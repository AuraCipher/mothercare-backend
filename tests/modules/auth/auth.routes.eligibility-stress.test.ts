jest.mock('bcryptjs', () => ({
  hash: jest.fn().mockResolvedValue('$2a$12$mocked_hash_for_testing'),
  compare: jest.fn().mockResolvedValue(true),
}));

import request from 'supertest';
import { prismaMock } from '../../mocks/prisma';
import app from '../../../src/app';
import { createMockUser } from '../../helpers/factories';
import { generateTestToken } from '../../helpers/auth';

type Scenario =
  | 'eligible_student'
  | 'no_enrollment_student'
  | 'graduated_student'
  | 'inactive_student'
  | 'unknown_user'
  | 'eligible_non_student';

const iterations = Array.from({ length: 15 }).map((_, i) => i + 1);
const scenarios: Scenario[] = [
  'eligible_student',
  'no_enrollment_student',
  'graduated_student',
  'inactive_student',
  'unknown_user',
  'eligible_non_student',
];

function setupLoginScenario(s: Scenario) {
  if (s === 'unknown_user') {
    prismaMock.user.findFirst.mockResolvedValue(null as any);
    return;
  }
  const role = s === 'eligible_non_student' ? 'teacher' : 'student';
  const status = s === 'inactive_student' ? 'inactive' : 'active';
  const user = createMockUser({ username: 'student01', role: role as any, status: status as any });
  prismaMock.user.findFirst.mockResolvedValue(user as any);
  prismaMock.user.update.mockResolvedValue(user as any);
  prismaMock.branchMember.findMany.mockResolvedValue([{ branchId: 'b-1' }] as any);

  if (s === 'eligible_student') {
    prismaMock.student.findFirst.mockResolvedValueOnce({ id: 'st-1' } as any);
  } else if (s === 'no_enrollment_student') {
    prismaMock.student.findFirst
      .mockResolvedValueOnce(null as any)
      .mockResolvedValueOnce(null as any);
  } else if (s === 'graduated_student') {
    prismaMock.student.findFirst
      .mockResolvedValueOnce(null as any)
      .mockResolvedValueOnce({ id: 'st-1' } as any);
  }
}

function setupRefreshScenario(s: Scenario) {
  if (s === 'unknown_user') {
    prismaMock.user.findUnique.mockResolvedValue(null as any);
    return { token: generateTestToken('u-missing', 'parent') };
  }
  const role = s === 'eligible_non_student' ? 'teacher' : 'student';
  const status = s === 'inactive_student' ? 'inactive' : 'active';
  const user = createMockUser({ id: 'u-refresh', role: role as any, status: status as any });
  prismaMock.user.findUnique.mockResolvedValue({
    id: user.id,
    name: user.name,
    username: user.username,
    email: user.email,
    phone: user.phone,
    role: user.role,
    status: user.status,
    schoolId: null,
  } as any);
  prismaMock.branchMember.findMany.mockResolvedValue([{ branchId: 'b-1' }] as any);

  if (s === 'eligible_student') {
    prismaMock.student.findFirst.mockResolvedValueOnce({ id: 'st-1' } as any);
  } else if (s === 'no_enrollment_student') {
    prismaMock.student.findFirst
      .mockResolvedValueOnce(null as any)
      .mockResolvedValueOnce(null as any);
  } else if (s === 'graduated_student') {
    prismaMock.student.findFirst
      .mockResolvedValueOnce(null as any)
      .mockResolvedValueOnce({ id: 'st-1' } as any);
  }
  return { token: generateTestToken(user.id, user.role as any, { name: user.name }) };
}

describe('Auth route eligibility stress matrix', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  for (const scenario of scenarios) {
    for (const i of iterations) {
      test(`login scenario=${scenario} run=${i}`, async () => {
        setupLoginScenario(scenario);
        const res = await request(app).post('/auth/login').send({
          identifier: 'student01',
          password: 'password123',
          rememberMe: false,
        });

        if (scenario === 'eligible_student' || scenario === 'eligible_non_student') {
          expect(res.status).toBe(200);
          expect(res.body.success).toBe(true);
        } else if (scenario === 'inactive_student') {
          expect(res.status).toBe(403);
          expect(res.body.message).toMatch(/not active/i);
        } else if (scenario === 'unknown_user') {
          expect(res.status).toBe(401);
        } else if (scenario === 'no_enrollment_student') {
          expect(res.status).toBe(403);
          expect(res.body.message).toMatch(/not enrolled/i);
        } else {
          expect(res.status).toBe(403);
          expect(res.body.message).toMatch(/graduation/i);
        }
      });
    }
  }

  for (const scenario of scenarios) {
    for (const i of iterations) {
      test(`refresh scenario=${scenario} run=${i}`, async () => {
        const { token } = setupRefreshScenario(scenario);
        const res = await request(app)
          .post('/auth/refresh')
          .set('Authorization', `Bearer ${token}`);

        if (scenario === 'eligible_student' || scenario === 'eligible_non_student') {
          expect(res.status).toBe(200);
          expect(res.body.success).toBe(true);
        } else if (scenario === 'inactive_student' || scenario === 'unknown_user') {
          expect(res.status).toBe(401);
        } else if (scenario === 'no_enrollment_student') {
          expect(res.status).toBe(403);
          expect(res.body.message).toMatch(/not enrolled/i);
        } else {
          expect(res.status).toBe(403);
          expect(res.body.message).toMatch(/graduation/i);
        }
      });
    }
  }
});
