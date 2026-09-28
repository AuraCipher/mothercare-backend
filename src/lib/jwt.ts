import jwt from 'jsonwebtoken';
import env from '../config/env';
import { checkBlacklisted, isBlacklistConfigured, putBlacklist } from '../config/blacklist-store';

// ─── JWT Token Management ─────────────────────────────────────
// Token blacklisting (logout/revocation) via src/config/blacklist-store —
// uses whichever backend is configured: local/self-hosted TCP Redis
// (REDIS_URL), Upstash over TCP/TLS, or Upstash REST, in any combination.
// Falls back gracefully if none is configured.
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

// ─── Blacklist (Redis with TTL eviction) ─────────────────────────
// Tokens are blacklisted with TTL matching their remaining expiry, on
// every configured backend (see blacklist-store.ts). No in-memory cache —
// prevents unbounded memory growth in long-running processes. Falls back
// gracefully if no blacklist backend is configured.

/** Store a revoked token in Redis with TTL until it expires */
export async function blacklistToken(token: string): Promise<void> {
  try {
    if (!isBlacklistConfigured()) return; // no blacklist backend, skip

    const decoded = verifyToken(token) as any;
    const ttl = decoded.exp - Math.floor(Date.now() / 1000);
    if (ttl > 0) {
      await putBlacklist(token, ttl);
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
    if (!isBlacklistConfigured()) return false; // no blacklist backend, allow all

    const result = await Promise.race([
      checkBlacklisted(token),
      new Promise<null>((_, reject) =>
        setTimeout(() => reject(new Error('blacklist timeout')), BLACKLIST_TIMEOUT_MS),
      ),
    ]);
    return result === true;
  } catch (e: any) {
    console.warn('[JWT] blacklist check failed:', e.message);
    // Fail closed: deny if we can't verify — safer to reject a valid token
    // than to accept a revoked one
    return true;
  }
}
