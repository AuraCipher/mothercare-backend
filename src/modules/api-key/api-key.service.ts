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

  // ─── Verify by key string (two-phase: prefix index → bcrypt one) ──
  async verifyByKey(key: string): Promise<{ id: string; name: string; type: ApiKeyType; branchId: string | null } | null> {
    // Phase 1: Extract prefix from key (first 11 chars: "pk_mcs_xxxx")
    const prefix = key.substring(0, 11);

    // Phase 2: Look up by prefix (indexed, O(1))
    const candidates = await prisma.apiKey.findMany({
      where: { prefix, revokedAt: null },
    });

    // If multiple keys share the same prefix (rare), try each
    for (const candidate of candidates) {
      if (await bcrypt.compare(key, candidate.keyHash)) {
        await prisma.apiKey.update({ where: { id: candidate.id }, data: { lastUsedAt: new Date() } });
        return {
          id: candidate.id,
          name: candidate.name,
          type: candidate.type,
          branchId: (candidate as any).branchId || null,
        };
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
