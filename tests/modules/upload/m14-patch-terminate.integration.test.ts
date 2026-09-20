/**
 * M14 §2 — PATCH requests always terminate with a bounded error response.
 *
 * Regression for the destroyBody bug: early-reject PATCH paths destroyed the
 * live request socket, so clients hung (or saw resets) instead of receiving
 * 404/409/400. Supertest cannot reproduce it (it hangs); this uses a real
 * HTTP server + real undici client like production traffic.
 */
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL || 'postgresql://mcs:mcs_dev_password@localhost:5434/mcs_test';

import http from 'http';
import { createTestPrisma, uniquePrefix, disconnect } from '../../integration/helpers';
import { generateTestToken, getAuthHeader } from '../../helpers/auth';
import type { PrismaClient } from '@prisma/client';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const app = require('../../../src/app').default || require('../../../src/app');

let prisma: PrismaClient;
const P = uniquePrefix() + '_m14p';
const ownerId = `${P}_owner`;
const strangerId = `${P}_stranger`;
let sid = '';

let httpServer: http.Server;
let base = '';

function pdf(n: number): Buffer {
  const hdr = Buffer.from('%PDF-1.4 m14\n');
  const b = Buffer.alloc(n, 0x41);
  hdr.copy(b, 0, 0, Math.min(hdr.length, n));
  return b;
}

async function patch(
  token: string,
  id: string,
  headers: Record<string, string>,
  body: Buffer,
  timeoutMs = 15000,
): Promise<{ status: number; body: string }> {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}/api/upload-sessions/${id}`, {
      method: 'PATCH',
      signal: ctrl.signal,
      headers: { Authorization: `Bearer ${token}`, ...headers },
      body: body as unknown as Uint8Array,
      duplex: 'half' as never,
    });
    const text = await res.text();
    return { status: res.status, body: text };
  } finally {
    clearTimeout(to);
  }
}

beforeAll(async () => {
  prisma = createTestPrisma();
  for (const [id, role] of [[ownerId, 'super_admin'], [strangerId, 'super_admin']] as const) {
    await prisma.user.create({ data: { id, name: id, passwordHash: 'x', role: role as never } });
  }
  const ownerTok = generateTestToken(ownerId, 'super_admin');
  httpServer = http.createServer(app);
  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const addr = httpServer.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;

  const create = await fetch(`${base}/api/upload-sessions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ownerTok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      purpose: 'document', originalFilename: 'm14.pdf', mimeType: 'application/pdf',
      expectedSize: 102400, idempotencyKey: `${P}-sess-01`,
    }),
  });
  const cj = (await create.json()) as { data?: { id?: string } };
  if (!cj?.data?.id) throw new Error(`setup create failed: ${create.status}`);
  sid = cj.data.id;
}, 120000);

afterAll(async () => {
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  await prisma.uploadSession.deleteMany({ where: { userId: { in: [ownerId, strangerId] } } }).catch(() => undefined);
  await prisma.user.deleteMany({ where: { id: { in: [ownerId, strangerId] } } }).catch(() => undefined);
  await disconnect(prisma);
});

describe('M14 PATCH termination (real transport)', () => {
  const tok = (uid: string) => generateTestToken(uid, 'super_admin');
  const oct = (extra: Record<string, string> = {}) => ({
    'Content-Type': 'application/octet-stream',
    ...extra,
  });

  test('stranger PATCH terminates 404 with body (was: hang)', async () => {
    const r = await patch(tok(strangerId), sid, oct({ 'Upload-Offset': '0', 'Content-Length': '10' }), pdf(10));
    expect(r.status).toBe(404);
    expect(r.body).toMatch(/not found/i);
  });

  test('forged session id terminates 404 (was: reset)', async () => {
    const r = await patch(tok(ownerId), 'does-not-exist', oct({ 'Upload-Offset': '0', 'Content-Length': '10' }), pdf(10));
    expect(r.status).toBe(404);
  });

  test('missing Upload-Offset terminates 400', async () => {
    const r = await patch(tok(ownerId), sid, oct({ 'Content-Length': '10' }), pdf(10));
    expect(r.status).toBe(400);
  });

  test('wrong-size non-final chunk terminates 400 (protocol enforced)', async () => {
    const r = await patch(tok(ownerId), sid, oct({ 'Upload-Offset': '0', 'Content-Length': '100' }), pdf(100));
    expect(r.status).toBe(400);
  });
});
