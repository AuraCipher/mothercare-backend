import { prismaMock } from '../../mocks/prisma';
import authService from '../../../src/modules/auth/auth.service';
import { createMockUser } from '../../helpers/factories';

type MethodName = 'login' | 'refresh' | 'refreshRememberMe';
type StateName = 'eligible' | 'no_enrollment' | 'graduated' | 'inactive_user' | 'non_student';

async function callMethod(method: MethodName) {
  if (method === 'login') {
    return authService.login({ identifier: 'student01', password: 'password123', rememberMe: false });
  }
  if (method === 'refresh') {
    return authService.refresh('u-1');
  }
  return authService.refreshRememberMe('remember-token-1');
}

describe('Auth student eligibility matrix', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prismaMock.branchMember.findMany.mockResolvedValue([{ branchId: 'b-1' }] as any);
    prismaMock.user.update.mockResolvedValue({} as any);
  });

  const methods: MethodName[] = ['login', 'refresh', 'refreshRememberMe'];
  const states: StateName[] = ['eligible', 'no_enrollment', 'graduated', 'inactive_user', 'non_student'];
  const iterations = Array.from({ length: 3 }).map((_, i) => i + 1);

  for (const method of methods) {
    for (const state of states) {
      for (const n of iterations) {
        test(`${method} -> ${state} [run ${n}]`, async () => {
          const userRole = state === 'non_student' ? 'teacher' : 'student';
          const status = state === 'inactive_user' ? 'inactive' : 'active';
          const baseUser: any = createMockUser({ role: userRole as any, status: status as any, username: 'student01' });

          if (method === 'login') {
            prismaMock.user.findFirst.mockResolvedValue(baseUser);
          } else if (method === 'refresh') {
            prismaMock.user.findUnique.mockResolvedValue(baseUser);
          } else {
            prismaMock.user.findFirst.mockResolvedValue(baseUser);
          }

          if (state === 'eligible') {
            prismaMock.student.findFirst.mockResolvedValueOnce({ id: 'st-1' } as any);
            await expect(callMethod(method)).resolves.toBeDefined();
            return;
          }

          if (state === 'no_enrollment') {
            prismaMock.student.findFirst
              .mockResolvedValueOnce(null as any)
              .mockResolvedValueOnce(null as any);
            await expect(callMethod(method)).rejects.toMatchObject({
              status: 403,
              message: 'Student is not enrolled in any active academic year',
            });
            return;
          }

          if (state === 'graduated') {
            prismaMock.student.findFirst
              .mockResolvedValueOnce(null as any)
              .mockResolvedValueOnce({ id: 'st-1' } as any);
            await expect(callMethod(method)).rejects.toMatchObject({
              status: 403,
              message: 'Student login is disabled after graduation',
            });
            return;
          }

          if (state === 'inactive_user') {
            if (method === 'login') {
              await expect(callMethod(method)).rejects.toMatchObject({ status: 403, message: 'Account is not active' });
            } else {
              await expect(callMethod(method)).rejects.toMatchObject({ status: 401, message: 'User not found or inactive' });
            }
            return;
          }

          // non_student
          await expect(callMethod(method)).resolves.toBeDefined();
        });
      }
    }
  }
});
