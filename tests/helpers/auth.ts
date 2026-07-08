/**
 * Auth Test Helpers
 *
 * Provides utilities for generating test JWT tokens and auth headers
 * to simulate authenticated requests in integration tests.
 *
 * Usage:
 *   import { generateTestToken, getAuthHeader } from '../helpers/auth';
 *   const token = generateTestToken('user-123', 'super_admin');
 *   const headers = getAuthHeader(token);
 *   // Or directly:
 *   const headers = getAuthHeader(generateTestToken('user-123', 'super_admin'));
 */

import jwt from 'jsonwebtoken';

// ─── Configuration ──────────────────────────────────────
// Must match the value set in tests/setup.ts
const TEST_JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key-for-testing-only-that-is-at-least-32-chars';
const TEST_JWT_ISSUER = 'school-erp';
const TEST_JWT_AUDIENCE = 'school-erp-clients';

// ─── Types ──────────────────────────────────────────────

export interface TokenPayload {
  id: string;
  role: 'super_admin' | 'management' | 'teacher' | 'parent';
  name?: string;
  schoolId?: string;
  branchIds?: string[];
}

// ─── Token Generation ───────────────────────────────────

/**
 * Generates a signed JWT token for testing purposes.
 * Uses the test JWT secret defined in the test environment.
 *
 * @param userId - The user's ID
 * @param role - The user's role (super_admin, management, teacher, parent)
 * @param overrides - Optional payload overrides (name, schoolId, etc.)
 * @returns A signed JWT string
 */
export function generateTestToken(
  userId: string,
  role: TokenPayload['role'] = 'super_admin',
  overrides: Partial<TokenPayload> = {},
): string {
  const payload: TokenPayload = {
    id: userId,
    role,
    name: overrides.name || 'Test User',
    schoolId: overrides.schoolId,
    ...overrides,
  };

  return jwt.sign(payload, TEST_JWT_SECRET, {
    expiresIn: '1h',
    issuer: TEST_JWT_ISSUER,
    audience: TEST_JWT_AUDIENCE,
  });
}

/**
 * Generates an expired JWT token for testing expired-token scenarios.
 *
 * @param userId - The user's ID
 * @param role - The user's role
 * @returns An expired signed JWT string
 */
export function generateExpiredToken(
  userId: string,
  role: TokenPayload['role'] = 'super_admin',
): string {
  const payload: TokenPayload = { id: userId, role, name: 'Test User' };

  return jwt.sign(payload, TEST_JWT_SECRET, {
    expiresIn: '0s', // Expires immediately
    issuer: TEST_JWT_ISSUER,
    audience: TEST_JWT_AUDIENCE,
  });
}

/**
 * Generates a token signed with a wrong secret (for testing invalid token).
 *
 * @param userId - The user's ID
 * @param role - The user's role
 * @returns A JWT signed with a different secret
 */
export function generateTokenWithWrongSecret(
  userId: string,
  role: TokenPayload['role'] = 'super_admin',
): string {
  const payload: TokenPayload = { id: userId, role, name: 'Test User' };

  return jwt.sign(payload, 'wrong-secret-that-does-not-match-the-test-secret', {
    expiresIn: '1h',
    issuer: TEST_JWT_ISSUER,
    audience: TEST_JWT_AUDIENCE,
  });
}

// ─── Auth Header Helpers ───────────────────────────────

/**
 * Returns an authorization header object for the given token.
 * Suitable for passing to supertest's .set() or .query().
 *
 * @param token - The JWT token (from generateTestToken)
 * @returns An object with the Authorization header
 *
 * @example
 *   const res = await request(app)
 *     .get('/admin/users')
 *     .set(getAuthHeader(token));
 */
export function getAuthHeader(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}

/**
 * Returns a publishable API key header for testing API key auth.
 *
 * @param apiKey - The publishable API key value
 * @returns An object with the x-publishable-api-key header
 */
export function getPublishableApiKeyHeader(apiKey: string): { 'x-publishable-api-key': string } {
  return { 'x-publishable-api-key': apiKey };
}

/**
 * Returns a secret API key header for testing API key auth.
 *
 * @param apiKey - The secret API key value
 * @returns An object with the x-api-key header
 */
export function getSecretApiKeyHeader(apiKey: string): { 'x-api-key': string } {
  return { 'x-api-key': apiKey };
}
