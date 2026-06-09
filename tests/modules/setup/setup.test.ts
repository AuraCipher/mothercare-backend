/**
 * Setup Endpoint Integration Tests
 *
 * Tests the one-time bootstrap flow:
 *   GET  /setup/status  — checks if system is initialized
 *   POST /setup/init   — creates first CEO + API keys + returns JWT
 *
 * Uses supertest + mocked Prisma (no real database).
 */

import { prismaMock } from '../../mocks/prisma';
import request from 'supertest';
import app from '../../../src/app';
import { createMockUser, createMockApiKey } from '../../helpers/factories';
import type { MockUser, MockApiKey } from '../../helpers/factories';

// ─── GET /setup/status ──────────────────────────────────────

describe('GET /setup/status', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns initialized: false when no users exist', async () => {
    prismaMock.user.count.mockResolvedValue(0);

    const res = await request(app).get('/setup/status');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.initialized).toBe(false);
  });

  test('returns initialized: true when users exist', async () => {
    prismaMock.user.count.mockResolvedValue(1);

    const res = await request(app).get('/setup/status');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.initialized).toBe(true);
  });

  test('returns initialized: true when multiple users exist', async () => {
    prismaMock.user.count.mockResolvedValue(5);

    const res = await request(app).get('/setup/status');

    expect(res.status).toBe(200);
    expect(res.body.initialized).toBe(true);
  });
});

// ─── POST /setup/init ────────────────────────────────────────

describe('POST /setup/init', () => {
  const validPayload = {
    username: 'ceo',
    name: 'CEO Mother Care',
    email: 'ceo@mothercareschool.com',
    password: 'StrongPass123',
    confirmPassword: 'StrongPass123',
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── Guard tests ──

  test('returns 409 when system is already initialized', async () => {
    prismaMock.user.count.mockResolvedValue(1);

    const res = await request(app)
      .post('/setup/init')
      .send(validPayload);

    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toContain('already initialized');
  });

  // ── Validation tests ──

  test('returns 400 when username is missing', async () => {
    prismaMock.user.count.mockResolvedValue(0);

    const res = await request(app)
      .post('/setup/init')
      .send({ name: 'CEO', email: 'ceo@school.com', password: 'StrongPass123', confirmPassword: 'StrongPass123' });

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('Username');
  });

  test('returns 400 when name is missing', async () => {
    prismaMock.user.count.mockResolvedValue(0);

    const res = await request(app)
      .post('/setup/init')
      .send({ username: 'ceo', email: 'ceo@school.com', password: 'StrongPass123', confirmPassword: 'StrongPass123' });

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('Name');
  });

  test('returns 400 when email is missing', async () => {
    prismaMock.user.count.mockResolvedValue(0);

    const res = await request(app)
      .post('/setup/init')
      .send({ username: 'ceo', name: 'CEO', password: 'StrongPass123', confirmPassword: 'StrongPass123' });

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('Email');
  });

  test('returns 400 when password is too short', async () => {
    prismaMock.user.count.mockResolvedValue(0);

    const res = await request(app)
      .post('/setup/init')
      .send({ username: 'ceo', name: 'CEO', email: 'ceo@school.com', password: 'Short1', confirmPassword: 'Short1' });

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('at least 8 characters');
  });

  test('returns 400 when passwords do not match', async () => {
    prismaMock.user.count.mockResolvedValue(0);

    const res = await request(app)
      .post('/setup/init')
      .send({ username: 'ceo', name: 'CEO', email: 'ceo@school.com', password: 'StrongPass123', confirmPassword: 'DifferentPass456' });

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('do not match');
  });

  // ── Success case ──

  test('returns 201 with token, user, and API keys on successful init', async () => {
    prismaMock.user.count.mockResolvedValue(0);
    prismaMock.user.findFirst.mockResolvedValue(null);
    prismaMock.user.create.mockResolvedValue({
      id: 'test-ceo-id-123',
      name: validPayload.name,
      username: validPayload.username,
      email: validPayload.email,
      role: 'super_admin',
      status: 'active',
      schoolId: null,
      passwordHash: '$2a$12$hashed',
      phone: null,
      gender: null,
      dateOfBirth: null,
      address: null,
      profilePhoto: null,
      managementPerms: [],
      isEmailVerified: false,
      isPhoneVerified: false,
      lastLoginAt: null,
      lastSeen: null,
      rememberMeToken: null,
      rememberMeExpiry: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any);

    // Mock API key creation (called twice: publishable + secret)
    prismaMock.apiKey.create.mockResolvedValue({
      id: 'test-key-id',
      name: 'Default Publishable Key (global)',
      type: 'publishable',
      keyHash: '$2a$12$hash',
      prefix: 'pk_mcs_global_test',
      createdBy: 'test-ceo-id-123',
      lastUsedAt: null,
      expiresAt: null,
      revokedAt: null,
      createdAt: new Date(),
    } as any);

    const res = await request(app)
      .post('/setup/init')
      .send(validPayload);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toContain('initialized');

    // Token
    expect(res.body.token).toBeDefined();
    expect(typeof res.body.token).toBe('string');

    // User
    expect(res.body.user.role).toBe('super_admin');
    expect(res.body.user.name).toBe(validPayload.name);
    expect(res.body.user.email).toBe(validPayload.email);

    // API keys
    expect(res.body.apiKeys).toBeDefined();
    expect(res.body.apiKeys.publishable).toContain('pk_mcs_');
    expect(res.body.apiKeys.secret).toContain('sk_mcs_');

    // Warnings
    expect(res.body.warnings).toBeDefined();
    expect(res.body.warnings.length).toBeGreaterThanOrEqual(1);

    // Verify CEO was created with super_admin role
    const userCreateCall = prismaMock.user.create.mock.calls[0]?.[0];
    expect(userCreateCall?.data?.role).toBe('super_admin');
    expect(userCreateCall?.data?.status).toBe('active');

    // Verify API keys were created
    expect(prismaMock.apiKey.create).toHaveBeenCalledTimes(2);
  });

  // ── Duplicate username/email ──

  test('returns 409 when username is already taken', async () => {
    prismaMock.user.count.mockResolvedValue(0);
    prismaMock.user.findFirst.mockResolvedValue({
      id: 'existing-user',
      username: 'ceo',
      email: 'other@school.com',
    } as any);

    const res = await request(app)
      .post('/setup/init')
      .send(validPayload);

    expect(res.status).toBe(409);
    expect(res.body.message).toContain('Username');
  });

  test('returns 409 when email is already taken', async () => {
    prismaMock.user.count.mockResolvedValue(0);
    prismaMock.user.findFirst.mockResolvedValue({
      id: 'existing-user',
      username: 'other',
      email: 'ceo@mothercareschool.com',
    } as any);

    const res = await request(app)
      .post('/setup/init')
      .send(validPayload);

    expect(res.status).toBe(409);
    expect(res.body.message).toContain('Email');
  });
});
