/**
 * M21 — saveCredential (manual WhatsApp handoff save) tests.
 *
 * Covers: preconditions, branch isolation, replacement gate, admin auth,
 * history rule, hashing, audit, timestamps, idempotency, response shape.
 * No provider calls anywhere in this flow (asserted structurally).
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
import { studentService } from '../../../src/modules/admin/services/student.service';

const baseStudent = {
  id: 's1',
  name: 'Ali',
  username: 'ali_student',
  userId: 'u1',
  passwordSetAt: null,
  group: { id: 'g1' },
  studentWhatsapp: '03001234567',
  phone: null,
  academicYear: { branchId: 'b1' },
  user: { passwordHash: '$2a$12$old_hash' },
};

const input = {
  password: 'NewPass123!x',
  adminPassword: 'AdminPass123!',
  replaceExisting: true,
  idempotencyKey: 'key-1',
};

beforeEach(() => {
  jest.clearAllMocks();
  (prismaMock.student.findUnique as jest.Mock).mockResolvedValue(baseStudent);
  (prismaMock.user.findUnique as jest.Mock).mockResolvedValue({ id: 'admin1', passwordHash: '$2a$12$admin_hash' });
  (prismaMock.auditLog.findFirst as jest.Mock).mockResolvedValue(null);
  (prismaMock.auditLog.findMany as jest.Mock).mockResolvedValue([]);
  (prismaMock.$transaction as jest.Mock).mockResolvedValue([{}, {}, {}]);
});

describe('saveCredential — preconditions', () => {
  test('404 when student not found', async () => {
    (prismaMock.student.findUnique as jest.Mock).mockResolvedValue(null);
    await expect(
      studentService.saveCredential('missing', input, 'admin1'),
    ).rejects.toMatchObject({ status: 404 });
  });

  test('403 on cross-branch student', async () => {
    await expect(
      studentService.saveCredential('s1', input, 'admin1', undefined, 'other-branch'),
    ).rejects.toMatchObject({ status: 403 });
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  test('allows matching branch', async () => {
    const res = await studentService.saveCredential('s1', input, 'admin1', undefined, 'b1');
    expect(res.success).toBe(true);
  });

  test('400 NO_USERNAME when username missing', async () => {
    (prismaMock.student.findUnique as jest.Mock).mockResolvedValue({ ...baseStudent, username: null });
    await expect(
      studentService.saveCredential('s1', input, 'admin1'),
    ).rejects.toMatchObject({ status: 400, code: 'NO_USERNAME' });
  });

  test('400 NO_CLASS when group missing', async () => {
    (prismaMock.student.findUnique as jest.Mock).mockResolvedValue({ ...baseStudent, group: null });
    await expect(
      studentService.saveCredential('s1', input, 'admin1'),
    ).rejects.toMatchObject({ status: 400, code: 'NO_CLASS' });
  });

  test('400 NO_PHONE when both numbers missing', async () => {
    (prismaMock.student.findUnique as jest.Mock).mockResolvedValue({ ...baseStudent, studentWhatsapp: null, phone: null });
    await expect(
      studentService.saveCredential('s1', input, 'admin1'),
    ).rejects.toMatchObject({ status: 400, code: 'NO_PHONE' });
  });

  test('400 when student has no login user', async () => {
    (prismaMock.student.findUnique as jest.Mock).mockResolvedValue({ ...baseStudent, userId: null, user: null });
    await expect(
      studentService.saveCredential('s1', input, 'admin1'),
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe('saveCredential — replacement gate (M21 §18)', () => {
  const existing = { ...baseStudent, passwordSetAt: new Date('2026-01-01T00:00:00Z') };

  test('409 PASSWORD_REPLACEMENT_REQUIRED without confirmation, zero mutations', async () => {
    (prismaMock.student.findUnique as jest.Mock).mockResolvedValue(existing);
    await expect(
      studentService.saveCredential('s1', { ...input, replaceExisting: false }, 'admin1'),
    ).rejects.toMatchObject({ status: 409, code: 'PASSWORD_REPLACEMENT_REQUIRED' });
    expect(prismaMock.user.update).not.toHaveBeenCalled();
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  test('proceeds with replaceExisting:true and saves the exact password', async () => {
    const bcrypt = require('bcryptjs');
    (prismaMock.student.findUnique as jest.Mock).mockResolvedValue(existing);
    await studentService.saveCredential('s1', { ...input, replaceExisting: true }, 'admin1');
    expect(bcrypt.hash).toHaveBeenCalledWith('NewPass123!x', 12);
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
  });

  test('no existing password proceeds without confirmation', async () => {
    const res = await studentService.saveCredential('s1', { ...input, replaceExisting: false }, 'admin1');
    expect(res.success).toBe(true);
  });
});

describe('saveCredential — admin auth + history', () => {
  test('403 on wrong admin password, no mutation', async () => {
    const bcrypt = require('bcryptjs');
    bcrypt.compare.mockResolvedValueOnce(false);
    await expect(
      studentService.saveCredential('s1', input, 'admin1'),
    ).rejects.toMatchObject({ status: 403 });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  test('409 on recently used password, no mutation', async () => {
    const bcrypt = require('bcryptjs');
    (prismaMock.auditLog.findMany as jest.Mock).mockResolvedValue([
      { newValue: { passwordHash: '$2a$12$recent_hash' } },
    ]);
    // admin check passes, history comparison matches → reuse detected.
    // mockResolvedValueOnce (not mockImplementation) so nothing leaks to later tests.
    bcrypt.compare.mockResolvedValueOnce(true).mockResolvedValueOnce(true);
    await expect(
      studentService.saveCredential('s1', input, 'admin1'),
    ).rejects.toMatchObject({ status: 409 });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });
});

describe('saveCredential — commit + response shape', () => {
  test('commits hash + timestamps + audit in one transaction', async () => {
    await studentService.saveCredential('s1', input, 'admin1', '127.0.0.1');
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    const userArg = (prismaMock.user.update as jest.Mock).mock.calls[0][0];
    expect(userArg).toMatchObject({
      where: { id: 'u1' },
      data: { passwordHash: '$2a$12$mocked_hash_for_testing' },
    });
    const studentArg = (prismaMock.student.update as jest.Mock).mock.calls[0][0];
    expect(studentArg).toMatchObject({
      where: { id: 's1' },
      data: expect.objectContaining({ credentialStatus: 'sent' }),
    });
    expect(studentArg.data.passwordSetAt).toBeInstanceOf(Date);
    expect(studentArg.data.credentialSentAt).toBeInstanceOf(Date);
    expect(studentArg.data.credentialGeneratedAt).toBeInstanceOf(Date);
    const auditArg = (prismaMock.auditLog.create as jest.Mock).mock.calls[0][0];
    expect(auditArg).toMatchObject({
      data: expect.objectContaining({ action: 'credential_save', entity: 'Student', entityId: 's1' }),
    });
  });

  test('audit entry carries hash metadata, never plaintext', async () => {
    await studentService.saveCredential('s1', input, 'admin1');
    const auditArg = (prismaMock.auditLog.create as jest.Mock).mock.calls[0][0];
    const logged = JSON.stringify(auditArg);
    expect(logged).not.toContain('NewPass123!x');
    expect(auditArg.data.newValue.passwordHash).toBe('$2a$12$mocked_hash_for_testing');
    expect(auditArg.data.metadata).toEqual({ idempotencyKey: 'key-1' });
  });

  test('response has website + timestamps and NO password', async () => {
    const res: any = await studentService.saveCredential('s1', input, 'admin1');
    expect(res).toMatchObject({ success: true, website: 'https://school.test', schoolName: 'Test School', appUrl: 'https://school.test/app' });
    expect(res.credentialGeneratedAt).toBeDefined();
    expect(res.credentialSentAt).toBeDefined();
    expect(JSON.stringify(res)).not.toContain('NewPass123!x');
    expect(res.password).toBeUndefined();
  });
});

describe('saveCredential — idempotency (M21 §25)', () => {
  test('replay with same key returns stored result without mutation', async () => {
    (prismaMock.auditLog.findFirst as jest.Mock).mockResolvedValue({
      newValue: {
        website: 'https://school.test',
        credentialGeneratedAt: '2026-09-30T00:00:00.000Z',
        credentialSentAt: '2026-09-30T00:00:01.000Z',
      },
    });
    const res: any = await studentService.saveCredential('s1', input, 'admin1');
    expect(res.idempotent).toBe(true);
    expect(res.credentialSentAt).toBe('2026-09-30T00:00:01.000Z');
    expect(prismaMock.user.update).not.toHaveBeenCalled();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  test('unknown key proceeds to normal save', async () => {
    const res: any = await studentService.saveCredential('s1', input, 'admin1');
    expect(res.idempotent).toBeUndefined();
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
  });
});

describe('saveCredential — no provider involvement', () => {
  test('service module method performs zero fetch calls', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch');
    await studentService.saveCredential('s1', input, 'admin1');
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  test('source contains no provider/queue references in the save path', () => {
    const src = require('fs').readFileSync(
      require('path').resolve(__dirname, '../../../src/modules/admin/services/student.service.ts'),
      'utf8',
    );
    const method = src.slice(src.indexOf('async saveCredential('), src.indexOf('// ─── Send credentials via WhatsApp'));
    const stripped = method.replace(/NEVER[^\n]*/g, '');
    expect(stripped).not.toMatch(/ContentSid|sendTemplateMessage|deliverCredential|enqueueCredentialSend|notificationService/i);
  });
});
