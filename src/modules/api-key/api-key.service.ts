import { PrismaClient, ApiKeyType } from '@prisma/client';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

const prisma = new PrismaClient();

function generateKey(type: 'publishable' | 'secret'): string {
  const prefix = type === 'publishable' ? 'pk_mcs_' : 'sk_mcs_';
  return prefix + crypto.randomBytes(32).toString('hex');
}

function generatePrefix(type: 'publishable' | 'secret'): string {
  const prefix = type === 'publishable' ? 'pk_mcs_' : 'sk_mcs_';
  return prefix + crypto.randomBytes(4).toString('hex').substring(0, 4);
}

class ApiKeyService {
  // ─── Create key (publishable or secret) ─────────────────────────
  async createApiKey(name: string, type: ApiKeyType, createdBy: string) {
    const plaintext = generateKey(type);
    const prefix = generatePrefix(type);
    const keyHash = await bcrypt.hash(plaintext, 12);

    const apiKey = await prisma.apiKey.create({
      data: { name, type, keyHash, prefix, createdBy },
    });

    return {
      key: {
        id: apiKey.id,
        name: apiKey.name,
        type: apiKey.type,
        prefix: apiKey.prefix,
        key: plaintext,
        createdAt: apiKey.createdAt,
      },
      message: 'Store this key safely. It will not be shown again.',
    };
  }

  // ─── List all keys (no keyHash) ────────────────────────────────
  async listApiKeys() {
    return prisma.apiKey.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, name: true, type: true, prefix: true,
        createdBy: true, lastUsedAt: true,
        expiresAt: true, revokedAt: true, createdAt: true,
      },
    });
  }

  // ─── Revoke key ────────────────────────────────────────────────
  async revokeApiKey(id: string) {
    const key = await prisma.apiKey.findUnique({ where: { id } });
    if (!key) throw { status: 404, message: 'API key not found' };
    if (key.revokedAt) throw { status: 400, message: 'API key already revoked' };
    await prisma.apiKey.update({ where: { id }, data: { revokedAt: new Date() } });
    return { message: 'API key revoked successfully' };
  }

  // ─── Verify by key string ──────────────────────────────────────
  async verifyByKey(key: string): Promise<{ id: string; name: string; type: ApiKeyType } | null> {
    const allKeys = await prisma.apiKey.findMany({ where: { revokedAt: null } });
    for (const ak of allKeys) {
      if (await bcrypt.compare(key, ak.keyHash)) {
        await prisma.apiKey.update({ where: { id: ak.id }, data: { lastUsedAt: new Date() } });
        return { id: ak.id, name: ak.name, type: ak.type };
      }
    }
    return null;
  }

  // ─── Verify key ID (for secret token auth) ─────────────────────
  async getById(id: string) {
    return prisma.apiKey.findUnique({ where: { id, revokedAt: null }, select: { id: true, name: true, type: true } });
  }
}

export default new ApiKeyService();
