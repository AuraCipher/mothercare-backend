/**
 * Centralized component status tracking.
 *
 * Every subsystem that the readiness probe cares about reports its state
 * through this singleton. The readiness endpoint queries `isReady()` to
 * determine whether the instance can safely serve normal traffic.
 *
 * Semantic rules:
 *   - `database` is REQUIRED — app cannot function without it.
 *   - All other components are OPTIONAL — their absence degrades
 *     functionality but does not block readiness.
 */

import logger from './logger';

export type ComponentName =
  | 'database'
  | 'tcpRedis'
  | 'upstashRedis'
  | 'messageWorker'
  | 'chatWorker'
  | 'socketIo';

export type ComponentState = 'starting' | 'ready' | 'degraded' | 'down';

interface ComponentEntry {
  state: ComponentState;
  since: number;
  detail?: string;
}

const components: Record<ComponentName, ComponentEntry> = {
  database:      { state: 'starting', since: Date.now() },
  tcpRedis:      { state: 'starting', since: Date.now() },
  upstashRedis:  { state: 'starting', since: Date.now() },
  messageWorker: { state: 'starting', since: Date.now() },
  chatWorker:    { state: 'starting', since: Date.now() },
  socketIo:      { state: 'starting', since: Date.now() },
};

let serverStartTime: number | null = null;

export function markReady(name: ComponentName, detail?: string): void {
  components[name] = { state: 'ready', since: Date.now(), detail };
  logger.info(`Component ready: ${name}`, detail ? { detail } : undefined);
}

export function markDegraded(name: ComponentName, detail?: string): void {
  components[name] = { state: 'degraded', since: Date.now(), detail };
  logger.warn(`Component degraded: ${name}`, detail ? { detail } : undefined);
}

export function markDown(name: ComponentName, detail?: string): void {
  components[name] = { state: 'down', since: Date.now(), detail };
  logger.error(`Component down: ${name}`, detail ? { detail } : undefined);
}

/**
 * Returns true only if all REQUIRED components are ready.
 * Currently: only `database` is required.
 */
export function isReady(): boolean {
  return components.database.state === 'ready';
}

export function getComponentStatus(): Record<ComponentName, ComponentEntry> {
  return { ...components };
}

export function getUptimeMs(): number {
  if (!serverStartTime) return 0;
  return Date.now() - serverStartTime;
}

export function markServerStarted(): void {
  serverStartTime = Date.now();
}

/**
 * Structured snapshot for health endpoints.
 * Returns a plain object safe for JSON serialization.
 */
export function getReadinessReport(): {
  ready: boolean;
  uptimeMs: number;
  components: Record<string, { state: ComponentState; uptimeMs: number; detail?: string }>;
} {
  const now = Date.now();
  const report: Record<string, { state: ComponentState; uptimeMs: number; detail?: string }> = {};
  for (const [name, entry] of Object.entries(components)) {
    report[name] = {
      state: entry.state,
      uptimeMs: now - entry.since,
      ...(entry.detail ? { detail: entry.detail } : {}),
    };
  }
  return {
    ready: isReady(),
    uptimeMs: getUptimeMs(),
    components: report,
  };
}
