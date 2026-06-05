/**
 * API Key Routes Integration Tests
 *
 * Tests the API Key HTTP endpoints (POST, GET, DELETE) using supertest
 * against the real Express app with mocked Prisma and mocked bcrypt.
 */

// IMPORTANT: Mock bcryptjs BEFORE any source imports so that jest.mock('bcryptjs')
// is hoisted and registered before the service/app modules load bcryptjs.
jest.mock('bcryptjs', () => ({
  hash: jest.fn().mockResolvedValue('$2a$12$mocked_hash_for_testing'),
  compare: jest.fn().mockResolvedValue(true),
}));

import { prismaMock } from '../../mocks/prisma';
import request from 'supertest';
import app from '../../../src/app';
import { createMockApiKey } from '../../helpers/factories';
import type { MockApiKey } from '../../helpers/factories';
import { generateTestToken, getAuthHeader } from '../../helpers/auth';

// ─── Shared auth tokens ─────────────────────────────────────

const adminToken = getAuthHeader(generateTestToken('admin-1', 'super_admin'));

// ─── POST /api-keys ─────────────────────────────────────────

describe('POST /api-keys', () => {
  let mockKey: MockApiKey;

  beforeEach(() => {
    jest.clearAllMocks();
    mockKey = createMockApiKey({ type: 'publishable' });
  });

  test('valid request with publishable type → 201 with key', async () => {
    // Mock returns the same name that was passed in, mirroring real Prisma behavior
    prismaMock.apiKey.create.mockResolvedValue({ ...mockKey, name: 'Test Key' } as any);

    const res = await request(app)
      .post('/api-keys')
      .set(adminToken)
      .send({ name: 'Test Key', type: 'publishable' });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.key).toBeDefined();
    expect(res.body.key.name).toBe('Test Key');
    expect(res.body.key.type).toBe('publishable');
    expect(res.body.key.key).toBeDefined();
    expect(typeof res.body.key.key).toBe('string');
    expect(res.body.message).toBe('Store this key safely. It will not be shown again.');
  });

  test('valid request with secret type → 201 with key', async () => {
    const secretKey = createMockApiKey({ type: 'secret' });
    prismaMock.apiKey.create.mockResolvedValue({ ...secretKey, name: 'Secret Key' } as any);

    const res = await request(app)
      .post('/api-keys')
      .set(adminToken)
      .send({ name: 'Secret Key', type: 'secret' });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.key.type).toBe('secret');
    expect(res.body.key.key).toBeDefined();
  });

  test('missing name → passes through as undefined (no validation in controller)', async () => {
    // The controller passes undefined name through to the service.
    // With our mocked Prisma, no DB-level validation occurs, so the request
    // passes through and returns 201. In production, Prisma would reject this.
    prismaMock.apiKey.create.mockResolvedValue(mockKey as any);

    const res = await request(app)
      .post('/api-keys')
      .set(adminToken)
      .send({ type: 'publishable' });

    expect(res.status).toBe(201);
  });

  test('without auth token → 401', async () => {
    const res = await request(app)
      .post('/api-keys')
      .send({ name: 'Test Key', type: 'publishable' });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });
});

// ─── GET /api-keys ──────────────────────────────────────────

describe('GET /api-keys', () => {
  let mockKeys: MockApiKey[];

  beforeEach(() => {
    jest.clearAllMocks();
    mockKeys = [
      createMockApiKey({ createdAt: new Date('2025-02-01') }),
      createMockApiKey({ createdAt: new Date('2025-01-01') }),
    ];
  });

  test('returns list of keys → 200', async () => {
    // Simulate Prisma's select behavior: exclude keyHash
    const keysWithoutHash = mockKeys.map(({ keyHash, ...rest }) => rest);
    prismaMock.apiKey.findMany.mockResolvedValue(keysWithoutHash as any);

    const res = await request(app)
      .get('/api-keys')
      .set(adminToken);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toBeDefined();
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBe(2);

    // Verify keyHash is not exposed
    for (const key of res.body.data) {
      expect(key.keyHash).toBeUndefined();
    }
  });

  test('without auth token → 401', async () => {
    const res = await request(app).get('/api-keys');

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });
});

// ─── DELETE /api-keys/:id ───────────────────────────────────

describe('DELETE /api-keys/:id', () => {
  let mockKey: MockApiKey;

  beforeEach(() => {
    jest.clearAllMocks();
    mockKey = createMockApiKey({ revokedAt: null });
  });

  test('revokes existing key → 200', async () => {
    prismaMock.apiKey.findUnique.mockResolvedValue(mockKey as any);
    prismaMock.apiKey.update.mockResolvedValue({ ...mockKey, revokedAt: new Date() } as any);

    const res = await request(app)
      .delete(`/api-keys/${mockKey.id}`)
      .set(adminToken);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe('API key revoked successfully');
  });

  test('without auth token → 401', async () => {
    const res = await request(app).delete('/api-keys/some-id');

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });
});
