import type IORedis from 'ioredis';
import env from './env';
import logger from '../lib/logger';
import { getRedisConnectionConfig } from './redis-tcp';
import { getUpstashRedis } from './redis';

// ─────────────────────────────────────────────────────────────────────────────
// JWT blacklist store — multi-backend.
//
// Selects whichever backend(s) are configured, so the SAME code works for:
//   • local / self-hosted Redis over TCP  (REDIS_URL=redis://host:6379)
//   • Upstash over TCP + TLS              (REDIS_URL=rediss://…upstash.io)
//   • Upstash REST                        (UPSTASH_REDIS_REST_URL + TOKEN)
//   • any combination of the above at once
//
// Semantics:
//   • WRITE → mirrored to ALL configured backends, so a revocation lands
//             everywhere and any store is authoritative on read.
//   • READ  → TCP first (~0.1 ms locally / TLS to Upstash), REST as fallback
//             (~160 ms) only when TCP is unavailable. Never both per request.
//   • NONE configured → blacklist disabled (auth still works — legacy behaviour).
//   • Backends configured but ALL reads failing → fail CLOSED (deny), matching
//     the previous REST-only behaviour in src/lib/jwt.ts.
// ─────────────────────────────────────────────────────────────────────────────

type BackendKind = 'tcp' | 'rest';

let tcpClient: IORedis | null = null;
let tcpClientInit: Promise<IORedis | null> | null = null;
let lastTcpErrorLogAt = 0;

function tcpUrl(): string | undefined {
  const url = env.REDIS_URL?.trim();
  return url || undefined;
}

function restConfigured(): boolean {
  return Boolean(env.UPSTASH_REDIS_REST_URL?.trim() && env.UPSTASH_REDIS_REST_TOKEN?.trim());
}

/** True when at least one blacklist backend is configured. */
export function isBlacklistConfigured(): boolean {
  return Boolean(tcpUrl()) || restConfigured();
}

/** Classify the configured TCP URL: Upstash (TLS) vs local/self-hosted. */
function describeTcpUrl(): string | null {
  const url = tcpUrl();
  if (!url) return null;
  try {
    const u = new URL(url);
    const proto = u.protocol.replace(':', ''); // redis: | rediss:
    const host = u.host || `${u.hostname}:${u.port || 6379}`;
    const kind = u.hostname.endsWith('upstash.io')
      ? 'upstash tcp/tls'
      : 'local/self-hosted';
    return `${proto}://${host} (${kind})`;
  } catch {
    return 'REDIS_URL (unparsable)';
  }
}

/** One-line description for the startup banner / logs. */
export function describeBlacklistBackends(): string {
  if (!isBlacklistConfigured()) return 'disabled — no REDIS_URL / Upstash creds';
  const parts: string[] = [];
  const tcp = describeTcpUrl();
  if (tcp) parts.push(`TCP ${tcp}`);
  if (restConfigured()) parts.push('REST fallback');
  return parts.join(' + ');
}

/**
 * Lazy shared TCP client (ioredis). Reuses the URL parsing in redis-tcp.ts
 * (handles rediss:// → TLS automatically, so Upstash TCP works unchanged).
 *
 * Fast-fail options: if TCP Redis is down, operations reject immediately so
 * the REST fallback (and the caller's timeout) stay within budget — instead of
 * hanging in the offline queue. On first creation we additionally wait up to
 * 1.5 s for the initial connection ('ready') so the very first check after
 * process boot hits TCP directly instead of failing over (or, with no REST
 * configured, deny/closing) — a local/upstash connection needs only a few ms.
 */
async function getTcpClient(): Promise<IORedis | null> {
  if (tcpClient) return tcpClient;
  const config = getRedisConnectionConfig();
  if (!config) return null;

  if (!tcpClientInit) {
    tcpClientInit = (async () => {
      const { default: IORedisCtor } = await import('ioredis');
      const client = new IORedisCtor({
        ...config,
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
        connectTimeout: 1500,
      });
      // Must have an error listener — ioredis emits 'error' on connection
      // issues and an unhandled 'error' event would crash the process.
      // Throttled to at most one log per minute while Redis is down.
      client.on('error', (err: Error) => {
        const now = Date.now();
        if (now - lastTcpErrorLogAt > 60_000) {
          lastTcpErrorLogAt = now;
          logger.warn('Blacklist TCP Redis error', { error: err.message });
        }
      });
      tcpClient = client;
      // Bounded wait for the initial connection. This promise must never
      // reject (it gets cached) — if Redis is unreachable we simply proceed
      // after 1.5 s and subsequent commands fail fast into the REST fallback.
      await new Promise<void>((resolve) => {
        if (client.status === 'ready') {
          resolve();
          return;
        }
        const timer = setTimeout(resolve, 1500);
        client.once('ready', () => {
          clearTimeout(timer);
          resolve();
        });
      });
      return client;
    })();
  }
  return tcpClientInit;
}

/**
 * Check a token against the blacklist.
 * TCP first (healthy TCP is authoritative because writes are mirrored);
 * falls back to REST if TCP is unavailable; fail-closed if nothing can answer.
 */
export async function checkBlacklisted(token: string): Promise<boolean> {
  const key = `blacklist:${token}`;

  // 1) TCP — local/self-hosted or Upstash rediss:// (fast path)
  if (tcpUrl()) {
    try {
      const client = await getTcpClient();
      if (client) {
        const value = await client.get(key);
        return value !== null;
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'unknown';
      logger.warn('Blacklist TCP read failed — trying REST fallback', { error: msg });
    }
  }

  // 2) Upstash REST — primary when no TCP URL, fallback otherwise
  if (restConfigured()) {
    try {
      const client = getUpstashRedis();
      if (client) {
        const value = await client.get(key);
        return value !== null;
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'unknown';
      logger.warn('Blacklist REST read failed', { error: msg });
    }
  }

  if (!isBlacklistConfigured()) return false; // disabled → allow (legacy)

  // 3) Configured but nothing could answer → fail closed (deny).
  logger.error('JWT blacklist unverifiable — denying request (fail-closed)', {
    backends: describeBlacklistBackends(),
  });
  return true;
}

/**
 * Store a revoked token with a TTL until it expires.
 * Mirrors to every configured backend; throws only if ALL writes fail
 * (caller logs it), warns on partial failure.
 */
export async function putBlacklist(token: string, ttlSeconds: number): Promise<void> {
  const key = `blacklist:${token}`;
  const failures: BackendKind[] = [];
  let attempted = 0;
  const promises: Promise<void>[] = [];

  if (tcpUrl()) {
    attempted++;
    promises.push(
      (async () => {
        const client = await getTcpClient();
        if (!client) throw new Error('TCP client unavailable');
        await client.set(key, '1', 'EX', ttlSeconds);
      })().catch((err: unknown) => {
        failures.push('tcp');
        const msg = err instanceof Error ? err.message : 'unknown';
        logger.warn('Blacklist TCP write failed', { error: msg });
      }),
    );
  }

  if (restConfigured()) {
    attempted++;
    promises.push(
      (async () => {
        const client = getUpstashRedis();
        if (!client) throw new Error('REST client unavailable');
        await client.set(key, '1', { ex: ttlSeconds });
      })().catch((err: unknown) => {
        failures.push('rest');
        const msg = err instanceof Error ? err.message : 'unknown';
        logger.warn('Blacklist REST write failed', { error: msg });
      }),
    );
  }

  await Promise.all(promises);

  if (failures.length > 0 && failures.length === attempted) {
    throw new Error(`blacklist write failed on all backends (${failures.join(', ')})`);
  }
}

/** Close the shared TCP client on graceful shutdown. */
export async function closeBlacklistTcp(): Promise<void> {
  const client = tcpClient;
  const init = tcpClientInit;
  tcpClient = null;
  tcpClientInit = null;
  try {
    if (client) await client.quit().catch(() => {});
    else if (init) (await init)?.quit().catch(() => {});
  } catch {
    // shutdown path — ignore
  }
}
