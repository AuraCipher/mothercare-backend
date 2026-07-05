import env from './env';

export type RedisConnectionConfig = {
  host: string;
  port: number;
  username?: string;
  password?: string;
  maxRetriesPerRequest: null;
  enableReadyCheck: false;
  tls?: Record<string, never>;
};

function parseRedisUrl(urlStr: string): RedisConnectionConfig | null {
  try {
    const parsed = new URL(urlStr);
    const useTls = parsed.protocol === 'rediss:';
    const port = parsed.port ? parseInt(parsed.port, 10) : 6379;

    return {
      host: parsed.hostname,
      port,
      username: parsed.username || undefined,
      password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      ...(useTls ? { tls: {} } : {}),
    };
  } catch {
    return null;
  }
}

export function getRedisConnectionConfig(): RedisConnectionConfig | null {
  const url = env.REDIS_URL?.trim();
  if (!url) return null;
  return parseRedisUrl(url);
}

export async function testTcpRedisConnection(): Promise<boolean> {
  const config = getRedisConnectionConfig();
  if (!config) return false;

  const { default: IORedis } = await import('ioredis');
  const conn = new IORedis({
    ...config,
    connectTimeout: 5000,
    lazyConnect: true,
  });

  try {
    await conn.connect();
    const pong = await conn.ping();
    return pong === 'PONG';
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'unknown';
    console.warn('[Redis TCP] Connection test failed:', msg);
    return false;
  } finally {
    await conn.quit().catch(() => {});
  }
}

export async function closeRedisConnection(): Promise<void> {
  // BullMQ queue/worker instances own their connections and are closed separately.
}
