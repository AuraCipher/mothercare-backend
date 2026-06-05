import { Redis as UpstashRedis } from '@upstash/redis';
import env from './env';

// ─── Upstash (cloud/REST) ───────────────────────────────────────
// We use Upstash (REST API) instead of local Redis.
// No local Redis is required or configured.
// ─────────────────────────────────────────────────────────────────

let _upstash: UpstashRedis | null = null;

export function getUpstashRedis(): UpstashRedis | null {
  if (_upstash) return _upstash;

  if (!env.UPSTASH_REDIS_REST_URL || !env.UPSTASH_REDIS_REST_TOKEN) {
    console.warn('[Redis] Upstash credentials not configured. JWT blacklist disabled.');
    return null;
  }

  _upstash = new UpstashRedis({
    url: env.UPSTASH_REDIS_REST_URL,
    token: env.UPSTASH_REDIS_REST_TOKEN,
  });

  return _upstash;
}

// Convenience: export the Upstash client directly
export const kv = getUpstashRedis();

/**
 * Check if the Upstash connection is healthy.
 * Returns true if it works, false otherwise.
 */
export async function testRedisConnection(): Promise<boolean> {
  const client = getUpstashRedis();
  if (!client) return false;

  try {
    // Test with a quick set/get
    const key = '__redis_test__';
    await client.set(key, 'ok', { ex: 5 });
    const result = await client.get(key);
    return result === 'ok';
  } catch (err: any) {
    console.warn('[Redis] Upstash test failed:', err.message);
    return false;
  }
}
