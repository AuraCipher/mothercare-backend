import { PrismaClient, ApiKeyType } from '@prisma/client';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

const prisma = new PrismaClient();

/**
 * Generate a key with branch code embedded in the string.
 *
 * Format: {prefix}_{branchCode}_{randomHex}
 *   Global:  pk_mcs_global_a1b2c3d4...
 *   Scoped:  pk_mcs_MCS-SOHAN_a1b2c3d4...
 *   Secret:  sk_mcs_MCS-SOHAN_a1b2c3d4...
 *
 * The branch code allows FAST string-level branch matching
 * before any bcrypt compare — if the branch code in the key
 * doesn't match the target branch, reject immediately.
 */
function generateKey(type: 'publishable' | 'secret', branchCode?: string): string {
  const typePrefix = type === 'publishable' ? 'pk_mcs_' : 'sk_mcs_';
  const scope = branchCode || 'global';
  return `${typePrefix}${scope}_${crypto.randomBytes(32).toString('hex')}`;
}

function generatePrefix(type: 'publishable' | 'secret', branchCode?: string): string {
  const typePrefix = type === 'publishable' ? 'pk_mcs_' : 'sk_mcs_';
  const scope = branchCode || 'global';
  const shortHash = crypto.randomBytes(4).toString('hex').substring(0, 4);
  return `${typePrefix}${scope}_${shortHash}`;
}

/**
 * Extract the branch code from a key string.
 * Key format: pk_mcs_{branchCode}_{randomHex}
 * Returns: "MCS-SOHAN" or "global"
 */
function extractBranchCode(key: string): string | null {
  const parts = key.split('_');
  // parts[0] = "pk" or "sk"
  // parts[1] = "mcs"
  // parts[2] = branchCode
  // parts[3+] = random hex
  if (parts.length < 4) return null;
  return parts[2];
}

class ApiKeyService {
  // ─── Create key (publishable or secret) ─────────────────────────
  async createApiKey(name: string, type: ApiKeyType, createdBy: string, branchCode?: string, branchId?: string) {
    const plaintext = generateKey(type, branchCode);
    const prefix = generatePrefix(type, branchCode);
    const keyHash = await bcrypt.hash(plaintext, 12);

    const data: any = { name, type, keyHash, prefix, createdBy };
    if (branchId) data.branchId = branchId;

    const apiKey = await prisma.apiKey.create({ data });

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

  // ─── Verify by key string (three-phase: branch code → prefix → bcrypt) ──
  async verifyByKey(
    key: string,
    targetBranchCode?: string,
  ): Promise<{ id: string; name: string; type: ApiKeyType; branchId: string | null } | null> {
    // Phase 1: Extract branch code from key string
    const keyBranchCode = extractBranchCode(key);
    if (!keyBranchCode) return null;

    // Phase 2: Fast string-level branch check — NO DB, NO bcrypt
    if (keyBranchCode !== 'global' && targetBranchCode && keyBranchCode !== targetBranchCode) {
      // Key is scoped to a different branch → reject immediately
      return null;
    }

    // Phase 3: Look up by prefix (indexed, O(1))
    const prefix = key.substring(0, key.lastIndexOf('_'));
    const candidates = await prisma.apiKey.findMany({
      where: { prefix, revokedAt: null },
    });

    // Phase 4: bcrypt compare on the single matching key
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
