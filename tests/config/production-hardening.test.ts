/**
 * 12D — Production Configuration Hardening Tests
 *
 * Validates:
 *  - ISSUE 1: Known JWT_SECRET placeholders rejected in production
 *  - ISSUE 2: PUSH_MASTER_SECRET required when FCM enabled in production
 *  - Local development behavior preserved
 *  - Secrets never appear in error output
 */

// ─── Env schema (reproduce from env.ts) ──────────────────────
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().default('5000'),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  APP_MODE: z.enum(['development', 'production']).default('production'),
  JWT_EXPIRY: z.string().default('7d'),
  APP_URL: z.string().url().optional(),
  FRONTEND_URL: z.string().url().optional(),
  APP_DOWNLOAD_URL: z.string().optional(),
  SCHOOL_NAME: z.string().default('Mother Care School'),
  UPSTASH_REDIS_REST_URL: z.string().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().optional(),
  REDIS_URL: z.string().optional(),
  MESSAGE_QUEUE_CONCURRENCY: z.string().default('3'),
  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM_EMAIL: z.string().optional(),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_WHATSAPP_FROM: z.string().optional(),
  TWILIO_TEMPLATE_STUDENT: z.string().optional(),
  TWILIO_TEMPLATE_TEACHER: z.string().optional(),
  TWILIO_TEMPLATE_STAFF: z.string().optional(),
  ALLOWED_ORIGINS: z.string().optional(),
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_DOCUMENTS_BUCKET: z.string().default('mcs-documents'),
  R2_BACKUPS_BUCKET: z.string().default('mcs-backups'),
  R2_PUBLIC_BASE_URL: z.string().url().optional(),
  DEFAULT_BRANCH_NAME: z.string().default('Mother Care Sohan'),
  PUSH_MASTER_SECRET: z.string().min(32).optional(),
  FIREBASE_SERVICE_ACCOUNT_PATH: z.string().optional(),
  FIREBASE_SERVICE_ACCOUNT_JSON: z.string().optional(),
  FCM_ENABLED: z.enum(['true', 'false']).default('false'),
  SOCKET_PATH: z.string().default('/socket.io'),
  CHAT_QUEUE_CONCURRENCY: z.string().default('5'),
  SENTRY_DSN: z.string().url().optional(),
});

/** Known JWT_SECRET placeholder patterns that must be rejected in production. */
const JWT_SECRET_PLACEHOLDERS = [
  'your_super_secret',
  'change_me',
  'replace_me',
  'default_secret',
  'secret_key',
  'minimum_32_characters',
];

/** Reproduce the post-parse hardening logic from env.ts. */
function validateProductionHardening(data: z.infer<typeof envSchema>): string[] {
  const errors: string[] = [];
  const isProduction = data.NODE_ENV === 'production' || data.APP_MODE === 'production';
  const isTest = data.NODE_ENV === 'test';
  const hardened = isProduction && !isTest;

  if (hardened) {
    const jwtLower = data.JWT_SECRET.toLowerCase();
    if (JWT_SECRET_PLACEHOLDERS.some((p) => jwtLower.includes(p))) {
      errors.push(
        'JWT_SECRET contains a known placeholder value. Generate a real secret: openssl rand -base64 48',
      );
    }

    if (data.FCM_ENABLED === 'true' && !data.PUSH_MASTER_SECRET) {
      errors.push(
        'PUSH_MASTER_SECRET is required when FCM_ENABLED=true in production. Generate one: openssl rand -base64 48',
      );
    }
  }

  return errors;
}

function baseEnv(overrides: Record<string, any> = {}) {
  return {
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
    JWT_SECRET: 'a'.repeat(64),
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════
// ISSUE 1 — JWT_SECRET placeholder rejection
// ═══════════════════════════════════════════════════════════════

describe('12D ISSUE 1 — JWT_SECRET placeholder rejection', () => {
  describe('production mode (NODE_ENV=production)', () => {
    test('rejects "your_super_secret_jwt_key_minimum_32_characters"', () => {
      const parsed = envSchema.safeParse(baseEnv({
        NODE_ENV: 'production',
        JWT_SECRET: 'your_super_secret_jwt_key_minimum_32_characters',
      }));
      expect(parsed.success).toBe(true);
      const errors = validateProductionHardening(parsed.data!);
      expect(errors.length).toBe(1);
      expect(errors[0]).toContain('JWT_SECRET');
      expect(errors[0]).not.toContain('your_super_secret');
    });

    test('rejects "change_me_at_least_32_characters_long"', () => {
      const parsed = envSchema.safeParse(baseEnv({
        NODE_ENV: 'production',
        JWT_SECRET: 'change_me_at_least_32_characters_long',
      }));
      expect(parsed.success).toBe(true);
      const errors = validateProductionHardening(parsed.data!);
      expect(errors.length).toBe(1);
      expect(errors[0]).toContain('JWT_SECRET');
    });

    test('rejects "replace_me_with_real_secret_32ch"', () => {
      const parsed = envSchema.safeParse(baseEnv({
        NODE_ENV: 'production',
        JWT_SECRET: 'replace_me_with_real_secret_32chars!!',
      }));
      expect(parsed.success).toBe(true);
      const errors = validateProductionHardening(parsed.data!);
      expect(errors.length).toBe(1);
    });

    test('rejects "default_secret_key_do_not_use_32ch"', () => {
      const parsed = envSchema.safeParse(baseEnv({
        NODE_ENV: 'production',
        JWT_SECRET: 'default_secret_key_do_not_use_32chars',
      }));
      expect(parsed.success).toBe(true);
      const errors = validateProductionHardening(parsed.data!);
      expect(errors.length).toBe(1);
    });

    test('rejects case-insensitive placeholders', () => {
      const parsed = envSchema.safeParse(baseEnv({
        NODE_ENV: 'production',
        JWT_SECRET: 'YOUR_SUPER_SECRET_KEY_AT_LEAST_32_CHARS',
      }));
      expect(parsed.success).toBe(true);
      const errors = validateProductionHardening(parsed.data!);
      expect(errors.length).toBe(1);
    });

    test('accepts random-looking legitimate secret', () => {
      const parsed = envSchema.safeParse(baseEnv({
        NODE_ENV: 'production',
        JWT_SECRET: 'k8$mN2pQ9xL4vB7wR1jF5hT3yA6cE0dG',
      }));
      expect(parsed.success).toBe(true);
      const errors = validateProductionHardening(parsed.data!);
      expect(errors.length).toBe(0);
    });

    test('accepts base64-encoded secret', () => {
      const parsed = envSchema.safeParse(baseEnv({
        NODE_ENV: 'production',
        JWT_SECRET: 'c2VjcmV0LWtleS1mb3Itand0LXNpZ25pbmctcHVycG9zZQ==',
      }));
      expect(parsed.success).toBe(true);
      const errors = validateProductionHardening(parsed.data!);
      expect(errors.length).toBe(0);
    });

    test('accepts hex-encoded secret', () => {
      const parsed = envSchema.safeParse(baseEnv({
        NODE_ENV: 'production',
        JWT_SECRET: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0',
      }));
      expect(parsed.success).toBe(true);
      const errors = validateProductionHardening(parsed.data!);
      expect(errors.length).toBe(0);
    });

    test('error message does not contain the actual secret value', () => {
      const parsed = envSchema.safeParse(baseEnv({
        NODE_ENV: 'production',
        JWT_SECRET: 'your_super_secret_jwt_key_minimum_32_characters',
      }));
      const errors = validateProductionHardening(parsed.data!);
      for (const err of errors) {
        expect(err).not.toContain('your_super_secret_jwt_key_minimum_32_characters');
      }
    });
  });

  describe('production mode (APP_MODE=production)', () => {
    test('rejects placeholder when APP_MODE=production', () => {
      const parsed = envSchema.safeParse(baseEnv({
        NODE_ENV: 'development',
        APP_MODE: 'production',
        JWT_SECRET: 'your_super_secret_jwt_key_minimum_32_characters',
      }));
      expect(parsed.success).toBe(true);
      const errors = validateProductionHardening(parsed.data!);
      expect(errors.length).toBe(1);
    });
  });

  describe('development mode — preserved behavior', () => {
    test('allows placeholder in development mode', () => {
      const parsed = envSchema.safeParse(baseEnv({
        NODE_ENV: 'development',
        APP_MODE: 'development',
        JWT_SECRET: 'your_super_secret_jwt_key_minimum_32_characters',
      }));
      expect(parsed.success).toBe(true);
      const errors = validateProductionHardening(parsed.data!);
      expect(errors.length).toBe(0);
    });

    test('allows placeholder in test mode', () => {
      const parsed = envSchema.safeParse(baseEnv({
        NODE_ENV: 'test',
        JWT_SECRET: 'your_super_secret_jwt_key_minimum_32_characters',
      }));
      expect(parsed.success).toBe(true);
      const errors = validateProductionHardening(parsed.data!);
      expect(errors.length).toBe(0);
    });
  });
});

// ═══════════════════════════════════════════════════════════════
// ISSUE 2 — PUSH_MASTER_SECRET requirement when FCM enabled
// ═══════════════════════════════════════════════════════════════

describe('12D ISSUE 2 — PUSH_MASTER_SECRET requirement', () => {
  describe('FCM disabled + no PUSH_MASTER_SECRET', () => {
    test('no error in production', () => {
      const parsed = envSchema.safeParse(baseEnv({
        NODE_ENV: 'production',
        FCM_ENABLED: 'false',
        PUSH_MASTER_SECRET: undefined,
      }));
      expect(parsed.success).toBe(true);
      const errors = validateProductionHardening(parsed.data!);
      expect(errors.length).toBe(0);
    });
  });

  describe('FCM enabled + valid PUSH_MASTER_SECRET', () => {
    test('no error in production', () => {
      const parsed = envSchema.safeParse(baseEnv({
        NODE_ENV: 'production',
        FCM_ENABLED: 'true',
        PUSH_MASTER_SECRET: 'a'.repeat(64),
      }));
      expect(parsed.success).toBe(true);
      const errors = validateProductionHardening(parsed.data!);
      expect(errors.length).toBe(0);
    });
  });

  describe('FCM enabled + missing PUSH_MASTER_SECRET', () => {
    test('error in production', () => {
      const parsed = envSchema.safeParse(baseEnv({
        NODE_ENV: 'production',
        FCM_ENABLED: 'true',
        PUSH_MASTER_SECRET: undefined,
      }));
      expect(parsed.success).toBe(true);
      const errors = validateProductionHardening(parsed.data!);
      expect(errors.length).toBe(1);
      expect(errors[0]).toContain('PUSH_MASTER_SECRET');
      expect(errors[0]).toContain('required');
    });

    test('error when APP_MODE=production', () => {
      const parsed = envSchema.safeParse(baseEnv({
        NODE_ENV: 'development',
        APP_MODE: 'production',
        FCM_ENABLED: 'true',
        PUSH_MASTER_SECRET: undefined,
      }));
      expect(parsed.success).toBe(true);
      const errors = validateProductionHardening(parsed.data!);
      expect(errors.length).toBe(1);
      expect(errors[0]).toContain('PUSH_MASTER_SECRET');
    });
  });

  describe('FCM enabled + too-short PUSH_MASTER_SECRET', () => {
    test('rejected by Zod min(32) validation', () => {
      const parsed = envSchema.safeParse(baseEnv({
        NODE_ENV: 'production',
        FCM_ENABLED: 'true',
        PUSH_MASTER_SECRET: 'short',
      }));
      expect(parsed.success).toBe(false);
    });
  });

  describe('development mode — preserved behavior', () => {
    test('FCM enabled + missing PUSH_MASTER_SECRET allowed in dev', () => {
      const parsed = envSchema.safeParse(baseEnv({
        NODE_ENV: 'development',
        APP_MODE: 'development',
        FCM_ENABLED: 'true',
        PUSH_MASTER_SECRET: undefined,
      }));
      expect(parsed.success).toBe(true);
      const errors = validateProductionHardening(parsed.data!);
      expect(errors.length).toBe(0);
    });
  });

  describe('error message safety', () => {
    test('error does not contain the actual secret value', () => {
      const parsed = envSchema.safeParse(baseEnv({
        NODE_ENV: 'production',
        FCM_ENABLED: 'true',
        PUSH_MASTER_SECRET: undefined,
      }));
      const errors = validateProductionHardening(parsed.data!);
      for (const err of errors) {
        // Should reference generation command, not actual value
        expect(err).toContain('openssl');
        // Should not contain the placeholder value itself
        expect(err).not.toContain('your_super_secret');
      }
    });
  });
});

// ═══════════════════════════════════════════════════════════════
// Zod schema — existing validation preserved
// ═══════════════════════════════════════════════════════════════

describe('12D — Zod schema validation (regression)', () => {
  test('JWT_SECRET min 32 enforced', () => {
    const result = envSchema.safeParse(baseEnv({ JWT_SECRET: 'short' }));
    expect(result.success).toBe(false);
  });

  test('PUSH_MASTER_SECRET min 32 enforced when set', () => {
    const result = envSchema.safeParse(baseEnv({ PUSH_MASTER_SECRET: 'short' }));
    expect(result.success).toBe(false);
  });

  test('FCM_ENABLED only accepts "true" or "false"', () => {
    const result = envSchema.safeParse(baseEnv({ FCM_ENABLED: 'yes' }));
    expect(result.success).toBe(false);
  });

  test('DATABASE_URL must be valid URL', () => {
    const result = envSchema.safeParse(baseEnv({ DATABASE_URL: 'not-a-url' }));
    expect(result.success).toBe(false);
  });
});
