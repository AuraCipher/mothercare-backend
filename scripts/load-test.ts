#!/usr/bin/env npx ts-node
/**
 * HTTP load test for MCS API.
 *
 * Usage:
 *   npx ts-node scripts/load-test.ts --url http://127.0.0.1:5000 --path /health --concurrency 50 --duration 15
 *   # Main seed: admin / admin123 — Demo seed: demo_admin / DemoAdmin@123
 *   npx ts-node scripts/load-test.ts --url http://127.0.0.1:5000 --path /auth/login --method POST \
 *     --body '{"identifier":"demo_admin","password":"DemoAdmin@123"}' --concurrency 20 --duration 30
 *
 * Reports: total requests, RPS, latency p50/p95/p99, error rate.
 */
import 'dotenv/config';
import http from 'http';
import https from 'https';

type Options = {
  url: string;
  path: string;
  method: string;
  body?: string;
  concurrency: number;
  durationSec: number;
  token?: string;
};

function parseArgs(): Options {
  const argv = process.argv.slice(2);
  const get = (flag: string, fallback?: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : fallback;
  };
  const base = get('--url', 'http://127.0.0.1:5000')!;
  const path = get('--path', '/health')!;
  return {
    url: base,
    path: path.startsWith('/') ? path : `/${path}`,
    method: (get('--method', 'GET') || 'GET').toUpperCase(),
    body: get('--body'),
    concurrency: parseInt(get('--concurrency', '25')!, 10),
    durationSec: parseInt(get('--duration', '20')!, 10),
    token: get('--token'),
  };
}

function percentile(sorted: number[], p: number) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

async function main() {
  const opts = parseArgs();
  const target = new URL(opts.path, opts.url);
  const transport = target.protocol === 'https:' ? https : http;

  const latencies: number[] = [];
  let completed = 0;
  let errors = 0;
  let statusHistogram: Record<string, number> = {};

  const endAt = Date.now() + opts.durationSec * 1000;
  const startedAt = Date.now();

  function oneRequest(): Promise<void> {
    return new Promise((resolve) => {
      const reqStart = Date.now();
      const headers: Record<string, string> = {
        'Accept': 'application/json',
      };
      if (opts.body) headers['Content-Type'] = 'application/json';
      if (opts.token) headers['Authorization'] = `Bearer ${opts.token}`;

      const req = transport.request(
        {
          protocol: target.protocol,
          hostname: target.hostname,
          port: target.port || (target.protocol === 'https:' ? 443 : 80),
          path: `${target.pathname}${target.search}`,
          method: opts.method,
          headers,
        },
        (res) => {
          res.on('data', () => {});
          res.on('end', () => {
            const ms = Date.now() - reqStart;
            latencies.push(ms);
            const code = String(res.statusCode || 0);
            statusHistogram[code] = (statusHistogram[code] || 0) + 1;
            if (res.statusCode && res.statusCode >= 400) errors++;
            completed++;
            resolve();
          });
        },
      );

      req.on('error', () => {
        errors++;
        completed++;
        latencies.push(Date.now() - reqStart);
        statusHistogram['ERR'] = (statusHistogram['ERR'] || 0) + 1;
        resolve();
      });

      if (opts.body) req.write(opts.body);
      req.end();
    });
  }

  async function worker() {
    while (Date.now() < endAt) {
      await oneRequest();
    }
  }

  console.log(`Load test → ${opts.method} ${target.href}`);
  console.log(`Concurrency: ${opts.concurrency}, duration: ${opts.durationSec}s`);

  await Promise.all(Array.from({ length: opts.concurrency }, () => worker()));

  const elapsedSec = (Date.now() - startedAt) / 1000;
  const sorted = [...latencies].sort((a, b) => a - b);

  console.log('\n=== Results ===');
  console.log(`Total requests:  ${completed}`);
  console.log(`Errors (4xx/5xx): ${errors}`);
  console.log(`RPS:             ${(completed / elapsedSec).toFixed(1)}`);
  console.log(`Latency p50:     ${percentile(sorted, 50).toFixed(0)} ms`);
  console.log(`Latency p95:     ${percentile(sorted, 95).toFixed(0)} ms`);
  console.log(`Latency p99:     ${percentile(sorted, 99).toFixed(0)} ms`);
  console.log(`Latency max:     ${(sorted[sorted.length - 1] || 0).toFixed(0)} ms`);
  console.log('Status codes:', statusHistogram);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
