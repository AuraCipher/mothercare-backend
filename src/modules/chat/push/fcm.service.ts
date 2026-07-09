import admin from 'firebase-admin';
import fs from 'fs';
import env from '../../../config/env';
import logger from '../../../lib/logger';
import { prisma } from '../../../lib/prisma';
import { encryptPushPayload, deriveUserPushKey } from './push-crypto.service';
import { listDeviceTokensForUsers } from './device-token.service';

let initialized = false;

function initFirebase(): boolean {
  if (initialized) return true;
  if (env.FCM_ENABLED !== 'true') return false;

  try {
    if (admin.apps.length) {
      initialized = true;
      return true;
    }
    if (env.FIREBASE_SERVICE_ACCOUNT_PATH && fs.existsSync(env.FIREBASE_SERVICE_ACCOUNT_PATH)) {
      const raw = fs.readFileSync(env.FIREBASE_SERVICE_ACCOUNT_PATH, 'utf8');
      admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) });
    } else if (env.FIREBASE_SERVICE_ACCOUNT_JSON) {
      admin.initializeApp({
        credential: admin.credential.cert(JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON)),
      });
    } else {
      logger.warn('FCM enabled but no service account configured');
      return false;
    }
    initialized = true;
    return true;
  } catch (err: unknown) {
    logger.error('FCM init failed', { error: err instanceof Error ? err.message : String(err) });
    return false;
  }
}

export function isFcmEnabled(): boolean {
  return env.FCM_ENABLED === 'true' && initFirebase();
}

/** WhatsApp-style: FCM carries only encrypted blob; app decrypts and shows local notification. */
export async function sendEncryptedPushToUsers(
  userIds: string[],
  _fallbackKeyVersion: number,
  payload: Record<string, unknown>,
) {
  if (!isFcmEnabled() || !userIds.length) return { sent: 0, skipped: userIds.length };

  let sent = 0;
  for (const userId of userIds) {
    const userTokens = await listDeviceTokensForUsers([userId]);
    if (!userTokens.length) continue;

    const keyRow = await prisma.userPushCryptoKey.findFirst({
      where: { userId },
      orderBy: { keyVersion: 'desc' },
    });
    const keyVersion = keyRow?.keyVersion ?? _fallbackKeyVersion ?? 1;
    const key = deriveUserPushKey(userId, keyVersion);
    const encrypted = encryptPushPayload(key.toString('base64'), payload);

    try {
      const res = await admin.messaging().sendEachForMulticast({
        tokens: userTokens,
        data: {
          v: String(keyVersion),
          iv: encrypted.iv,
          ct: encrypted.ciphertext,
          tag: encrypted.tag,
          alg: 'AES-256-GCM',
        },
        android: { priority: 'high' },
        apns: {
          headers: { 'apns-priority': '10' },
          payload: { aps: { contentAvailable: true } },
        },
      });
      sent += res.successCount;
    } catch (err: unknown) {
      logger.error('FCM send failed', { userId, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return { sent, skipped: userIds.length - sent };
}
