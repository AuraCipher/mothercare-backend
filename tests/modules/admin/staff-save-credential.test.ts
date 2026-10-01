/**
 * M22 — staffService.saveCredential tests (manual handoff save).
 * Branch-member gate, designation gate, audit-based existing detection,
 * idempotency, admin auth, history, commit shape, zero provider involvement.
 */

jest.mock('bcryptjs', () => ({
  hash: jest.fn().mockResolvedValue('$2a$12$mocked_hash_for_testing'),
  compare: jest.fn().mockResolvedValue(true),
}));

jest.mock('../../../src/config/env', () => ({
  __esModule: true,
  default: { FRONTEND_URL: 'https://school.test', SCHOOL_NAME: 'Test School', APP_DOWNLOAD_URL: 'https://school.test/app' },
}));

import { prismaMock } from '../../mocks/prisma';
import { staffService } from '../../../src/modules/admin/services/staff.service';

const baseMember = {
  id: 'm1',
  role: 'management',
  user: { id: 'u1', name: 'Ahmed', username: 'ahmed_s', phone: '03001234567' },
};

const baseProfile = { workRole: 'Accountant', phone: null };

const input = {
  password: 'NewPass123!x',
  adminPassword: 'AdminPass123!',
  replaceExisting: true,
  idempotencyKey: 'key-m1',
};

beforeEach(() => {
  jest.clearAllMocks();
  (prismaMock.branchMember.findUnique as jest.Mock).mockResolvedValue(baseMember);
  (prismaMock.staffProfile.findUnique as jest.Mock).mockResolvedValue(baseProfile);
  (prismaMock.user.findUnique as jest.Mock).mockResolvedValue({ id: 'admin1', passwordHash: '$2a$12$admin' });
  (prismaMock.auditLog.findFirst as jest.Mock).mockResolvedValue(null);
  (prismaMock.auditLog.findMany as jest.Mock).mockResolvedValue([]);
  (prismaMock.$transaction as jest.Mock).mockResolvedValue([{}, {}]);
});

describe('staff saveCredential — preconditions', () => {
  test('404 when member not found in branch', async () => {
    (prismaMock.branchMember.findUnique as jest.Mock).mockResolvedValue(null);
    await expect(staffService.saveCredential('b1', 'u1', input, 'admin1')).rejects.toMatchObject({ status: 404 });
  });

  test('400 NO_DESIGNATION when workRole and role missing', async () => {
    (prismaMock.staffProfile.findUnique as jest.Mock).mockResolvedValue({ workRole: null, phone: null });
    (prismaMock.branchMember.findUnique as jest.Mock).mockResolvedValue({ ...baseMember, role: '' });
    await expect(staffService.saveCredential('b1', 'u1', input, 'admin1')).rejects.toMatchObject({ status: 400, code: 'NO_DESIGNATION' });
  });

  test('falls back to branch role as designation', async () => {
    (prismaMock.staffProfile.findUnique as jest.Mock).mockResolvedValue({ workRole: null, phone: null });
    const res: any = await staffService.saveCredential('b1', 'u1', input, 'admin1');
    expect(res.success).toBe(true);
  });

  test('400 NO_PHONE when both phones missing', async () => {
    (prismaMock.branchMember.findUnique as jest.Mock).mockResolvedValue({
      ...baseMember, user: { ...baseMember.user, phone: null },
    });
    (prismaMock.staffProfile.findUnique as jest.Mock).mockResolvedValue({ workRole: 'Accountant', phone: null });
    await expect(staffService.saveCredential('b1', 'u1', input, 'admin1')).rejects.toMatchObject({ status: 400, code: 'NO_PHONE' });
  });

  test('400 WEAK_PASSWORD on weak input', async () => {
    await expect(
      staffService.saveCredential('b1', 'u1', { ...input, password: 'weak' }, 'admin1'),
    ).rejects.toMatchObject({ status: 400, code: 'WEAK_PASSWORD' });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });
});

describe('staff saveCredential — replacement + idempotency', () => {
  test('409 PASSWORD_REPLACEMENT_REQUIRED on prior audit, zero mutations', async () => {
    (prismaMock.auditLog.findMany as jest.Mock).mockResolvedValue([{ id: 'a1' }]);
    await expect(
      staffService.saveCredential('b1', 'u1', { ...input, replaceExisting: false }, 'admin1'),
    ).rejects.toMatchObject({ status: 409, code: 'PASSWORD_REPLACEMENT_REQUIRED' });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
  });

  test('first save proceeds without confirmation', async () => {
    const res: any = await staffService.saveCredential('b1', 'u1', { ...input, replaceExisting: false }, 'admin1');
    expect(res.success).toBe(true);
  });

  test('idempotent replay returns stored result without mutation', async () => {
    (prismaMock.auditLog.findFirst as jest.Mock).mockResolvedValue({
      newValue: { website: 'https://school.test', credentialSentAt: '2026-09-30T00:00:01.000Z' },
    });
    const res: any = await staffService.saveCredential('b1', 'u1', input, 'admin1');
    expect(res.idempotent).toBe(true);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  test('commit writes hash + audit with designation, returns website without password', async () => {
    const res: any = await staffService.saveCredential('b1', 'u1', input, 'admin1', '127.0.0.1');
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect((prismaMock.user.update as jest.Mock).mock.calls[0][0]).toMatchObject({
      where: { id: 'u1' }, data: { passwordHash: '$2a$12$mocked_hash_for_testing' },
    });
    expect((prismaMock.auditLog.create as jest.Mock).mock.calls[0][0].data).toMatchObject({
      action: 'credential_save', entity: 'StaffMember', entityId: 'm1',
    });
    expect(res).toMatchObject({ success: true, website: 'https://school.test', schoolName: 'Test School', appUrl: 'https://school.test/app' });
    expect(JSON.stringify(res)).not.toContain('NewPass123!x');
  });

  test('403 on wrong admin password', async () => {
    const bcrypt = require('bcryptjs');
    bcrypt.compare.mockResolvedValueOnce(false);
    await expect(staffService.saveCredential('b1', 'u1', input, 'admin1')).rejects.toMatchObject({ status: 403 });
  });
});
