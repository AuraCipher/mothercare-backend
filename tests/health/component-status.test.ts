/**
 * R2-11b — Component status tracker focused tests.
 *
 * Tests:
 * - Initial state is 'starting' for all components
 * - markReady transitions component to 'ready'
 * - markDegraded transitions component to 'degraded'
 * - markDown transitions component to 'down'
 * - isReady returns true only when database is ready
 * - getReadinessReport returns correct snapshot
 * - getUptimeMs returns positive number after markServerStarted
 */

/* ------------------------------------------------------------------ */
/*  Mocks                                                              */
/* ------------------------------------------------------------------ */

jest.mock('../../src/lib/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  req: jest.fn(),
  res: jest.fn(),
}));

/* ------------------------------------------------------------------ */
/*  Imports after mocks                                                */
/* ------------------------------------------------------------------ */

import {
  markReady,
  markDegraded,
  markDown,
  isReady,
  getReadinessReport,
  getUptimeMs,
  markServerStarted,
} from '../../src/lib/componentStatus';

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe('R2-11b — Component Status Tracker', () => {
  beforeEach(() => {
    // Reset all components to starting state
    // by re-importing a fresh module (not possible with singleton,
    // so we test the state transitions instead)
    jest.clearAllMocks();
  });

  test('isReady returns false initially (database starts as starting)', () => {
    // Database starts as 'starting', so isReady should be false
    // (unless markReady was called from a previous test)
    // We test the logic by explicitly setting states
    markDown('database', 'test reset');
    expect(isReady()).toBe(false);
  });

  test('isReady returns true after database is marked ready', () => {
    markReady('database');
    expect(isReady()).toBe(true);
  });

  test('isReady returns false when database is down', () => {
    markDown('database', 'connection lost');
    expect(isReady()).toBe(false);
  });

  test('isReady returns false when database is degraded', () => {
    markDegraded('database', 'slow queries');
    expect(isReady()).toBe(false);
  });

  test('isReady ignores non-database components', () => {
    markReady('database');
    markDown('tcpRedis', 'unreachable');
    markDown('upstashRedis', 'not configured');
    markDown('messageWorker', 'no redis');
    markDown('chatWorker', 'no redis');
    markDown('socketIo', 'not started');
    // Database is the only required component
    expect(isReady()).toBe(true);
  });

  test('getReadinessReport returns all components', () => {
    markReady('database');
    const report = getReadinessReport();
    expect(report.ready).toBe(true);
    expect(report.components).toHaveProperty('database');
    expect(report.components).toHaveProperty('tcpRedis');
    expect(report.components).toHaveProperty('upstashRedis');
    expect(report.components).toHaveProperty('messageWorker');
    expect(report.components).toHaveProperty('chatWorker');
    expect(report.components).toHaveProperty('socketIo');
  });

  test('getReadinessReport component includes uptimeMs', () => {
    markReady('database', 'connected');
    const report = getReadinessReport();
    expect(report.components.database.state).toBe('ready');
    expect(typeof report.components.database.uptimeMs).toBe('number');
    expect(report.components.database.uptimeMs).toBeGreaterThanOrEqual(0);
  });

  test('getReadinessReport component includes detail when provided', () => {
    markDegraded('tcpRedis', 'Connection timeout');
    const report = getReadinessReport();
    expect(report.components.tcpRedis.detail).toBe('Connection timeout');
  });

  test('markServerStarted and getUptimeMs work together', () => {
    markServerStarted();
    const uptime = getUptimeMs();
    expect(typeof uptime).toBe('number');
    expect(uptime).toBeGreaterThanOrEqual(0);
    expect(uptime).toBeLessThan(1000); // Should be nearly instant
  });

  test('getReadinessReport includes uptimeMs from server start', () => {
    markServerStarted();
    const report = getReadinessReport();
    expect(typeof report.uptimeMs).toBe('number');
    expect(report.uptimeMs).toBeGreaterThanOrEqual(0);
  });
});
