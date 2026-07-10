import crypto from 'crypto';
import env from '../../../config/env';
import { prisma } from '../../../lib/prisma';

const MOBILE_PUSH_ROLES = new Set([
  'student',
  'teacher',
  'parent',
  'branch_admin',
  'sub_admin',
  'management',
]);

export type PushCryptoMaterial = {
  algorithm: 'AES-256-GCM';
  keyVersion: number;
  key: string;
};

export function isMobilePushRole(role: string): boolean {
  return MOBILE_PUSH_ROLES.has(role);
}

function masterSecret(): Buffer {
  const raw = env.PUSH_MASTER_SECRET || env.JWT_SECRET;
  return crypto.createHash('sha256').update(raw).digest();
}

/** Derive per-user AES-256 key (delivered at login over HTTPS). */
export function deriveUserPushKey(userId: string, keyVersion: number): Buffer {
  return Buffer.from(
    crypto.hkdfSync('sha256', masterSecret(), Buffer.from(userId, 'utf8'), `mcs-push-v${keyVersion}`, 32),
  );
}

export async function issuePushCryptoMaterial(userId: string): Promise<PushCryptoMaterial> {
  const latest = await prisma.userPushCryptoKey.findFirst({
    where: { userId },
    orderBy: { keyVersion: 'desc' },
  });
  const keyVersion = latest?.keyVersion ?? 1;
  const key = deriveUserPushKey(userId, keyVersion);
  const keyHash = crypto.createHash('sha256').update(key).digest('hex');

  if (!latest) {
    await prisma.userPushCryptoKey.create({
      data: { userId, keyVersion, keyHash },
    });
  } else if (latest.keyHash !== keyHash) {
    await prisma.userPushCryptoKey.update({
      where: { id: latest.id },
      data: { keyHash, rotatedAt: new Date() },
    });
  }

  return {
    algorithm: 'AES-256-GCM',
    keyVersion,
    key: key.toString('base64'),
  };
}

export function encryptPushPayload(keyBase64: string, payload: Record<string, unknown>) {
  const key = Buffer.from(keyBase64, 'base64');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plaintext = JSON.stringify(payload);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    iv: iv.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
    tag: tag.toString('base64'),
  };
}
