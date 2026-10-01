/**
 * M22 — teacherProfileService.saveCredential tests (manual handoff save).
 * Gates, branch isolation, replacement gate, admin auth, history,
 * idempotency, response shape, zero provider involvement.
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
import { teacherProfileService } from '../../../src/modules/admin/services/teacher.service';

const baseProfile = {
  id: 't1',
  userId: 'u1',
  phone: '03001234567',
  passwordSetAt: null,
  user: { username: 'rubina_t', name: 'Rubina', phone: null, passwordHash: '$2a$12$old' },
};

const input = {
  password: 'NewPass123!x',
  adminPassword: 'AdminPass123!',
  replaceExisting: true,
  idempotencyKey: 'key-t1',
};

beforeEach(() => {
  jest.clearAllMocks();
  (prismaMock.teacherProfile.findUnique as jest.Mock).mockResolvedValue(baseProfile);
  (prismaMock.branchMember.findUnique as jest.Mock).mockResolvedValue({ id: 'm1' });
  (prismaMock.user.findUnique as jest.Mock).mockResolvedValue({ id: 'admin1', passwordHash: '$2a$12$admin' });
  (prismaMock.auditLog.findFirst as jest.Mock).mockResolvedValue(null);
  (prismaMock.auditLog.findMany as jest.Mock).mockResolvedValue([]);
  (prismaMock.$transaction as jest.Mock).mockResolvedValue([{}, {}, {}]);
});

describe('teacher saveCredential — preconditions', () => {
  test('404 when profile not found', async () => {
    (prismaMock.teacherProfile.findUnique as jest.Mock).mockResolvedValue(null);
    await expect(teacherProfileService.saveCredential('missing', input, 'admin1')).rejects.toMatchObject({ status: 404 });
  });

  test('403 on cross-branch teacher', async () => {
    (prismaMock.branchMember.findUnique as jest.Mock).mockResolvedValue(null);
    await expect(
      teacherProfileService.saveCredential('t1', input, 'admin1', undefined, 'other-branch'),
    ).rejects.toMatchObject({ status: 403 });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  test('400 NO_USERNAME when username and name missing', async () => {
    (prismaMock.teacherProfile.findUnique as jest.Mock).mockResolvedValue({
      ...baseProfile, user: { username: null, name: null, phone: null, passwordHash: 'x' },
    });
    await expect(teacherProfileService.saveCredential('t1', input, 'admin1')).rejects.toMatchObject({ status: 400, code: 'NO_USERNAME' });
  });

  test('400 NO_PHONE when profile and user phones missing', async () => {
    (prismaMock.teacherProfile.findUnique as jest.Mock).mockResolvedValue({
      ...baseProfile, phone: null, user: { ...baseProfile.user, phone: null },
    });
    await expect(teacherProfileService.saveCredential('t1', input, 'admin1')).rejects.toMatchObject({ status: 400, code: 'NO_PHONE' });
  });

  test('falls back to user phone when profile phone missing', async () => {
    (prismaMock.teacherProfile.findUnique as jest.Mock).mockResolvedValue({
      ...baseProfile, phone: null, user: { ...baseProfile.user, phone: '03009998877' },
    });
    const res: any = await teacherProfileService.saveCredential('t1', input, 'admin1');
    expect(res.success).toBe(true);
  });

  test.each([
    ['short', 'Sh0rt!x'],
    ['no uppercase', 'newpass123!x'],
    ['no digit', 'NewPassword!x'],
    ['no special', 'NewPass1234xy'],
  ])('400 WEAK_PASSWORD on %s', async (_label, pw) => {
    await expect(
      teacherProfileService.saveCredential('t1', { ...input, password: pw }, 'admin1'),
    ).rejects.toMatchObject({ status: 400, code: 'WEAK_PASSWORD' });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });
});

describe('teacher saveCredential — replacement + idempotency', () => {
  const existing = { ...baseProfile, passwordSetAt: new Date('2026-01-01T00:00:00Z') };

  test('409 PASSWORD_REPLACEMENT_REQUIRED with zero mutations', async () => {
    (prismaMock.teacherProfile.findUnique as jest.Mock).mockResolvedValue(existing);
    await expect(
      teacherProfileService.saveCredential('t1', { ...input, replaceExisting: false }, 'admin1'),
    ).rejects.toMatchObject({ status: 409, code: 'PASSWORD_REPLACEMENT_REQUIRED' });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
  });

  test('idempotent replay returns stored result without mutation', async () => {
    (prismaMock.auditLog.findFirst as jest.Mock).mockResolvedValue({
      newValue: {
        website: 'https://school.test',
        credentialGeneratedAt: '2026-09-30T00:00:00.000Z',
        credentialSentAt: '2026-09-30T00:00:01.000Z',
      },
    });
    const res: any = await teacherProfileService.saveCredential('t1', input, 'admin1');
    expect(res.idempotent).toBe(true);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  test('commit writes hash + teacher timestamps + audit, returns website without password', async () => {
    const res: any = await teacherProfileService.saveCredential('t1', input, 'admin1', '127.0.0.1');
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect((prismaMock.user.update as jest.Mock).mock.calls[0][0]).toMatchObject({
      where: { id: 'u1' }, data: { passwordHash: '$2a$12$mocked_hash_for_testing' },
    });
    expect((prismaMock.teacherProfile.update as jest.Mock).mock.calls[0][0].data).toMatchObject({ credentialStatus: 'sent' });
    expect(res).toMatchObject({ success: true, website: 'https://school.test', schoolName: 'Test School', appUrl: 'https://school.test/app' });
    expect(JSON.stringify(res)).not.toContain('NewPass123!x');
  });

  test('403 on wrong admin password', async () => {
    const bcrypt = require('bcryptjs');
    bcrypt.compare.mockResolvedValueOnce(false);
    await expect(teacherProfileService.saveCredential('t1', input, 'admin1')).rejects.toMatchObject({ status: 403 });
  });
});
