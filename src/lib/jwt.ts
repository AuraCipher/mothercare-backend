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

// ─── Blacklist (Redis-only with TTL eviction) ──────────────────────
// Tokens are blacklisted in Upstash with TTL matching their remaining
// expiry. No in-memory cache — prevents unbounded memory growth in
// long-running processes. Falls back gracefully if Upstash is not configured.

/** Store a revoked token in Redis with TTL until it expires */
export async function blacklistToken(token: string): Promise<void> {
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

/** Maximum time (ms) to wait for a blacklist check before failing closed. */
const BLACKLIST_TIMEOUT_MS = 3_000;

/** Check if a token has been revoked */
export async function isBlacklisted(token: string): Promise<boolean> {
  try {
    const client = getUpstashRedis();
    if (!client) return false; // Upstash not configured, allow all

    const result = await Promise.race([
      client.get(`blacklist:${token}`),
      new Promise<null>((_, reject) =>
        setTimeout(() => reject(new Error('blacklist timeout')), BLACKLIST_TIMEOUT_MS),
      ),
    ]);
    return result !== null;
  } catch (e: any) {
    console.warn('[JWT] blacklist check failed:', e.message);
    // Fail closed: deny if we can't verify — safer to reject a valid token
    // than to accept a revoked one
    return true;
  }
}
