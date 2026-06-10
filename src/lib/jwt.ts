import jwt from 'jsonwebtoken';
import env from '../config/env';
import { getUpstashRedis } from '../config/redis';

// ─── JWT Token Management ─────────────────────────────────────
// Uses Upstash KV for token blacklisting (logout/revocation).
// Falls back gracefully if Upstash is not configured.
// ──────────────────────────────────────────────────────────────

export function signToken(payload: {
  id: string;
  role: string;
  schoolId?: string;
  name: string;
  branchIds?: string[];
}): string {
  return jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRY as any,
    issuer: 'school-erp',
    audience: 'school-erp-clients',
  } as any);
}

export function verifyToken(token: string) {
  return jwt.verify(token, env.JWT_SECRET, {
    issuer: 'school-erp',
    audience: 'school-erp-clients',
  }) as any;
}

// ─── Blacklist (Upstash + local cache) ──────────────────────
// In-memory fallback ensures tokens remain blacklisted even if Redis is down.
const localBlacklist = new Set<string>();

/** Store a revoked token in Redis with TTL until it expires */
export async function blacklistToken(token: string): Promise<void> {
  // Always add to local cache (fast path, survives Redis outage)
  localBlacklist.add(token);

  try {
    const client = getUpstashRedis();
    if (!client) return; // Upstash not configured, skip

    const decoded = verifyToken(token) as any;
    const ttl = decoded.exp - Math.floor(Date.now() / 1000);
    if (ttl > 0) {
      await client.set(`blacklist:${token}`, '1', { ex: ttl });
    }
  } catch (e: any) {
    console.warn('[JWT] blacklist failed:', e.message);
  }
}

/** Check if a token has been revoked */
export async function isBlacklisted(token: string): Promise<boolean> {
  // Check local cache first (works even if Redis is down)
  if (localBlacklist.has(token)) return true;

  try {
    const client = getUpstashRedis();
    if (!client) return false; // Upstash not configured, allow all

    const result = await client.get(`blacklist:${token}`);
    if (result !== null) {
      // Sync to local cache so future checks don't need Redis
      localBlacklist.add(token);
      return true;
    }
    return false;
  } catch (e: any) {
    console.warn('[JWT] blacklist check failed:', e.message);
    // Fail closed: deny if we can't verify — safer to reject a valid token
    // than to accept a revoked one
    return true;
  }
}
