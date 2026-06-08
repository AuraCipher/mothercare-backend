/**
 * ApiKeyService Unit Tests
 *
 * Tests the ApiKeyService methods (createApiKey, listApiKeys, revokeApiKey, verifyByKey)
 * in isolation using a mocked Prisma client and mocked bcrypt.
 */

// IMPORTANT: Mock bcryptjs BEFORE any source imports so that jest.mock('bcryptjs')
// is hoisted and registered before the service module loads bcryptjs.
jest.mock('bcryptjs', () => ({
  hash: jest.fn().mockResolvedValue('$2a$12$mocked_hash_for_testing'),
  compare: jest.fn().mockResolvedValue(true),
}));

import { prismaMock } from '../../mocks/prisma';
import apiKeyService from '../../../src/modules/api-key/api-key.service';
import { createMockApiKey } from '../../helpers/factories';
import type { MockApiKey } from '../../helpers/factories';
import bcrypt from 'bcryptjs';

// ─── CREATE API KEY ─────────────────────────────────────────

describe('ApiKeyService.createApiKey', () => {
  let mockKey: MockApiKey;

  beforeEach(() => {
    jest.clearAllMocks();
    mockKey = createMockApiKey({ type: 'publishable' });
  });

  test('creates a publishable key → returns key object with plaintext', async () => {
    // The mock must return the same name that was passed in, mirroring real Prisma behavior
    prismaMock.apiKey.create.mockResolvedValue({ ...mockKey, name: 'Test Key' } as any);

    const result = await apiKeyService.createApiKey('Test Key', 'publishable', 'user-1');

    expect(result.key).toBeDefined();
    expect(result.key.id).toBe(mockKey.id);
    expect(result.key.name).toBe('Test Key');
    expect(result.key.type).toBe('publishable');
    expect(result.key.key).toBeDefined();
    expect(typeof result.key.key).toBe('string');
    expect(result.key.prefix).toBeDefined();
    expect(result.key.createdAt).toBeDefined();
  });

  test('creates a secret key → returns key object with plaintext', async () => {
    const secretKey = createMockApiKey({ type: 'secret' });
    prismaMock.apiKey.create.mockResolvedValue({ ...secretKey, name: 'Secret Key' } as any);

    const result = await apiKeyService.createApiKey('Secret Key', 'secret', 'user-1');

    expect(result.key.type).toBe('secret');
    expect(result.key.name).toBe('Secret Key');
    expect(result.key.key).toBeDefined();
  });

  test('generated publishable key starts with pk_mcs_', async () => {
    prismaMock.apiKey.create.mockResolvedValue(mockKey as any);

    const result = await apiKeyService.createApiKey('Test', 'publishable', 'user-1');

    expect(result.key.key).toMatch(/^pk_mcs_/);
  });

  test('generated secret key starts with sk_mcs_', async () => {
    prismaMock.apiKey.create.mockResolvedValue(mockKey as any);

    const result = await apiKeyService.createApiKey('Test', 'secret', 'user-1');

    expect(result.key.key).toMatch(/^sk_mcs_/);
  });

  test('generated publishable prefix starts with pk_mcs_', async () => {
    prismaMock.apiKey.create.mockResolvedValue(mockKey as any);

    await apiKeyService.createApiKey('Test', 'publishable', 'user-1');

    expect(prismaMock.apiKey.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          prefix: expect.stringMatching(/^pk_mcs_/),
        }),
      }),
    );
  });

  test('generated secret prefix starts with sk_mcs_', async () => {
    prismaMock.apiKey.create.mockResolvedValue(mockKey as any);

    await apiKeyService.createApiKey('Test', 'secret', 'user-1');

    expect(prismaMock.apiKey.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          prefix: expect.stringMatching(/^sk_mcs_/),
        }),
      }),
    );
  });

  test('key is persisted to database (prisma.apiKey.create called)', async () => {
    prismaMock.apiKey.create.mockResolvedValue(mockKey as any);

    await apiKeyService.createApiKey('Test', 'publishable', 'user-1');

    expect(prismaMock.apiKey.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: 'Test',
          type: 'publishable',
          keyHash: expect.any(String),
          prefix: expect.any(String),
          createdBy: 'user-1',
        }),
      }),
    );
  });

  test('response includes the one-time plaintext key', async () => {
    prismaMock.apiKey.create.mockResolvedValue(mockKey as any);

    const result = await apiKeyService.createApiKey('Test', 'publishable', 'user-1');

    expect(result.key.key).toBeDefined();
    expect(typeof result.key.key).toBe('string');
    expect(result.key.key.length).toBeGreaterThan(0);
  });

  test('response includes warning message', async () => {
    prismaMock.apiKey.create.mockResolvedValue(mockKey as any);

    const result = await apiKeyService.createApiKey('Test', 'publishable', 'user-1');

    expect(result.message).toBe('Store this key safely. It will not be shown again.');
  });
});

// ─── LIST API KEYS ──────────────────────────────────────────

describe('ApiKeyService.listApiKeys', () => {
  let mockKeys: MockApiKey[];

  beforeEach(() => {
    jest.clearAllMocks();
    mockKeys = [
      createMockApiKey({ createdAt: new Date('2025-02-01') }),
      createMockApiKey({ createdAt: new Date('2025-01-01') }),
    ];
  });

  test('returns all keys ordered by createdAt desc', async () => {
    // The mock returns keys in the order we specify; the service uses orderBy
    prismaMock.apiKey.findMany.mockResolvedValue(mockKeys as any);

    const result = await apiKeyService.listApiKeys();

    expect(result).toHaveLength(2);
    expect(prismaMock.apiKey.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { createdAt: 'desc' },
      }),
    );
  });

  test('returns empty array when no keys exist', async () => {
    prismaMock.apiKey.findMany.mockResolvedValue([]);

    const result = await apiKeyService.listApiKeys();

    expect(result).toEqual([]);
  });

  test('does NOT include keyHash in response', async () => {
    // Simulate Prisma's select behavior: exclude keyHash from returned objects
    const keysWithoutHash = mockKeys.map(({ keyHash, ...rest }) => rest);
    prismaMock.apiKey.findMany.mockResolvedValue(keysWithoutHash as any);

    const result = await apiKeyService.listApiKeys();

    for (const key of result) {
      expect((key as any).keyHash).toBeUndefined();
    }

    // Verify the select explicitly excludes keyHash
    expect(prismaMock.apiKey.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.not.objectContaining({ keyHash: expect.anything() }),
      }),
    );
  });
});

// ─── REVOKE API KEY ─────────────────────────────────────────

describe('ApiKeyService.revokeApiKey', () => {
  let mockKey: MockApiKey;

  beforeEach(() => {
    jest.clearAllMocks();
    mockKey = createMockApiKey({ revokedAt: null });
  });

  test('revokes an existing key → sets revokedAt', async () => {
    prismaMock.apiKey.findUnique.mockResolvedValue(mockKey as any);
    prismaMock.apiKey.update.mockResolvedValue({ ...mockKey, revokedAt: new Date() } as any);

    const result = await apiKeyService.revokeApiKey(mockKey.id);

    expect(result.message).toBe('API key revoked successfully');
    expect(prismaMock.apiKey.update).toHaveBeenCalledWith({
      where: { id: mockKey.id },
      data: { revokedAt: expect.any(Date) },
    });
  });

  test('throws 404 when key not found', async () => {
    prismaMock.apiKey.findUnique.mockResolvedValue(null);

    await expect(
      apiKeyService.revokeApiKey('nonexistent-id'),
    ).rejects.toMatchObject({
      status: 404,
      message: 'API key not found',
    });
  });

  test('throws 400 when key already revoked', async () => {
    const revokedKey = createMockApiKey({ revokedAt: new Date() });
    prismaMock.apiKey.findUnique.mockResolvedValue(revokedKey as any);

    await expect(
      apiKeyService.revokeApiKey(revokedKey.id),
    ).rejects.toMatchObject({
      status: 400,
      message: 'API key already revoked',
    });
  });
});

// ─── VERIFY BY KEY ──────────────────────────────────────────

describe('ApiKeyService.verifyByKey', () => {
  let mockKey: MockApiKey;

  beforeEach(() => {
    jest.clearAllMocks();
    mockKey = createMockApiKey({ revokedAt: null });
  });

  test('returns key info when key matches (bcrypt compare succeeds)', async () => {
    prismaMock.apiKey.findMany.mockResolvedValue([mockKey] as any);
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);
    prismaMock.apiKey.update.mockResolvedValue(mockKey as any);

    const result = await apiKeyService.verifyByKey('pk_mcs_global_a1b2c3d4e5');

    expect(result).toBeDefined();
    expect(result!.id).toBe(mockKey.id);
    expect(result!.name).toBe(mockKey.name);
    expect(result!.type).toBe(mockKey.type);
  });

  test('returns null when no key matches', async () => {
    prismaMock.apiKey.findMany.mockResolvedValue([mockKey] as any);
    (bcrypt.compare as jest.Mock).mockResolvedValue(false);

    const result = await apiKeyService.verifyByKey('pk_mcs_global_wrongkeyvalue');

    expect(result).toBeNull();
  });

  test('updates lastUsedAt on successful verification', async () => {
    prismaMock.apiKey.findMany.mockResolvedValue([mockKey] as any);
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);
    prismaMock.apiKey.update.mockResolvedValue(mockKey as any);

    await apiKeyService.verifyByKey('pk_mcs_global_a1b2c3d4e5');

    expect(prismaMock.apiKey.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: mockKey.id },
        data: { lastUsedAt: expect.any(Date) },
      }),
    );
  });
});
