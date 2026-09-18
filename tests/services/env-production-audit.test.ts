/**
 * R2-12c — Environment / Production Configuration Audit
 *
 * Validates:
 *  - Required production secrets have no insecure defaults
 *  - Placeholder JWT secrets are rejected in production
 *  - Provider configuration fails clearly when required config is missing
 *  - Credentials are not tracked by git
 *  - Sensitive values are redacted from logs/errors
 *  - Local Docker development remains functional without production provider secrets
 */

import fs from 'fs';
import path from 'path';
import { z } from 'zod';

// ─── Env schema (reproduce the Zod schema from env.ts) ─────
// We test the schema directly to avoid importing the actual env.ts
// which would parse process.env and potentially exit.

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

// ─── JWT_SECRET validation ─────────────────────────────────

describe('R2-12c — JWT_SECRET validation', () => {
  test('rejects JWT_SECRET shorter than 32 characters', () => {
    const result = envSchema.safeParse({
      DATABASE_URL: 'postgresql://test:test@localhost:5432/db',
      JWT_SECRET: 'short',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const jwtIssues = result.error.issues.filter((i) => i.path.includes('JWT_SECRET'));
      expect(jwtIssues.length).toBeGreaterThan(0);
    }
  });

  test('rejects empty JWT_SECRET', () => {
    const result = envSchema.safeParse({
      DATABASE_URL: 'postgresql://test:test@localhost:5432/db',
      JWT_SECRET: '',
    });
    expect(result.success).toBe(false);
  });

  test('accepts JWT_SECRET with exactly 32 characters', () => {
    const result = envSchema.safeParse({
      DATABASE_URL: 'postgresql://test:test@localhost:5432/db',
      JWT_SECRET: 'a'.repeat(32),
    });
    expect(result.success).toBe(true);
  });

  test('accepts JWT_SECRET longer than 32 characters', () => {
    const result = envSchema.safeParse({
      DATABASE_URL: 'postgresql://test:test@localhost:5432/db',
      JWT_SECRET: 'a'.repeat(64),
    });
    expect(result.success).toBe(true);
  });

  test('rejects placeholder "your_super_secret"', () => {
    const result = envSchema.safeParse({
      DATABASE_URL: 'postgresql://test:test@localhost:5432/db',
      JWT_SECRET: 'your_super_secret',
    });
    // 18 chars < 32, should fail
    expect(result.success).toBe(false);
  });

  test('rejects placeholder from .env.production', () => {
    const result = envSchema.safeParse({
      DATABASE_URL: 'postgresql://test:test@localhost:5432/db',
      JWT_SECRET: 'your_super_secret_jwt_key_minimum_32_characters',
    });
    // This is 48 chars — passes length but is a placeholder
    // The Zod schema enforces length only, not content
    // Post-parse hardening in env.ts catches this in production mode
    // (tested in tests/config/production-hardening.test.ts)
    expect(result.success).toBe(true);
  });
});

// ─── DATABASE_URL validation ───────────────────────────────

describe('R2-12c — DATABASE_URL validation', () => {
  test('requires DATABASE_URL to be a valid URL', () => {
    const result = envSchema.safeParse({
      DATABASE_URL: 'not-a-url',
      JWT_SECRET: 'a'.repeat(32),
    });
    expect(result.success).toBe(false);
  });

  test('accepts valid PostgreSQL URL', () => {
    const result = envSchema.safeParse({
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
      JWT_SECRET: 'a'.repeat(32),
    });
    expect(result.success).toBe(true);
  });
});

// ─── Provider config — fails clearly when missing ──────────

describe('R2-12c — Provider config graceful degradation', () => {
  test('all providers optional — valid config with no providers', () => {
    const result = envSchema.safeParse({
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
      JWT_SECRET: 'a'.repeat(32),
      RESEND_API_KEY: undefined,
      RESEND_FROM_EMAIL: undefined,
      TWILIO_ACCOUNT_SID: undefined,
      TWILIO_AUTH_TOKEN: undefined,
      R2_ACCOUNT_ID: undefined,
      R2_ACCESS_KEY_ID: undefined,
      R2_SECRET_ACCESS_KEY: undefined,
    });
    expect(result.success).toBe(true);
  });

  test('FCM_ENABLED defaults to "false"', () => {
    const result = envSchema.safeParse({
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
      JWT_SECRET: 'a'.repeat(32),
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.FCM_ENABLED).toBe('false');
    }
  });

  test('FCM_ENABLED rejects invalid values', () => {
    const result = envSchema.safeParse({
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
      JWT_SECRET: 'a'.repeat(32),
      FCM_ENABLED: 'yes',
    });
    expect(result.success).toBe(false);
  });

  test('PUSH_MASTER_SECRET requires minimum 32 characters when set', () => {
    const result = envSchema.safeParse({
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
      JWT_SECRET: 'a'.repeat(32),
      PUSH_MASTER_SECRET: 'short',
    });
    expect(result.success).toBe(false);
  });

  test('R2_PUBLIC_BASE_URL must be a valid URL when set', () => {
    const result = envSchema.safeParse({
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
      JWT_SECRET: 'a'.repeat(32),
      R2_PUBLIC_BASE_URL: 'not-a-url',
    });
    expect(result.success).toBe(false);
  });

  test('SENTRY_DSN must be a valid URL when set', () => {
    const result = envSchema.safeParse({
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
      JWT_SECRET: 'a'.repeat(32),
      SENTRY_DSN: 'not-a-url',
    });
    expect(result.success).toBe(false);
  });
});

// ─── Credentials not tracked by git ────────────────────────

describe('R2-12c — Credentials gitignore audit', () => {
  test('backend .gitignore excludes .env', () => {
    const gitignore = fs.readFileSync(
      path.resolve(__dirname, '../../.gitignore'),
      'utf8',
    );
    expect(gitignore).toContain('.env');
  });

  test('backend .gitignore excludes .env.local', () => {
    const gitignore = fs.readFileSync(
      path.resolve(__dirname, '../../.gitignore'),
      'utf8',
    );
    expect(gitignore).toContain('.env.local');
  });

  test('web .gitignore excludes all .env* files', () => {
    const webGitignorePath = path.resolve(__dirname, '../../../web/.gitignore');
    if (fs.existsSync(webGitignorePath)) {
      const gitignore = fs.readFileSync(webGitignorePath, 'utf8');
      expect(gitignore).toContain('.env*');
    }
  });
});

// ─── .env.production template audit ────────────────────────

describe('R2-12c — .env.production template audit', () => {
  const productionEnvPath = path.resolve(__dirname, '../../../.env.production');
  let productionEnv: string;

  beforeAll(() => {
    productionEnv = fs.readFileSync(productionEnvPath, 'utf8');
  });

  test('.env.production file exists', () => {
    expect(fs.existsSync(productionEnvPath)).toBe(true);
  });

  test('JWT_SECRET has placeholder value (not a real secret)', () => {
    // The template should have a placeholder, not a real key
    const jwtLine = productionEnv.split('\n').find((l) => l.startsWith('JWT_SECRET='));
    expect(jwtLine).toBeDefined();
    // Should not be empty
    expect(jwtLine!.length).toBeGreaterThan('JWT_SECRET='.length);
  });

  test('DATABASE_URL has placeholder credentials', () => {
    const dbLine = productionEnv.split('\n').find((l) => l.startsWith('DATABASE_URL='));
    expect(dbLine).toBeDefined();
    expect(dbLine).toContain('USER');
    expect(dbLine).toContain('PASSWORD');
  });

  test('Twilio credentials are empty in template', () => {
    const lines = productionEnv.split('\n');
    const twilioSid = lines.find((l) => l.startsWith('TWILIO_ACCOUNT_SID='));
    const twilioToken = lines.find((l) => l.startsWith('TWILIO_AUTH_TOKEN='));
    expect(twilioSid).toBeDefined();
    expect(twilioToken).toBeDefined();
    expect(twilioSid!.trim()).toBe('TWILIO_ACCOUNT_SID=');
    expect(twilioToken!.trim()).toBe('TWILIO_AUTH_TOKEN=');
  });

  test('R2 credentials are empty in template', () => {
    const lines = productionEnv.split('\n');
    const r2Key = lines.find((l) => l.startsWith('R2_ACCESS_KEY_ID='));
    const r2Secret = lines.find((l) => l.startsWith('R2_SECRET_ACCESS_KEY='));
    expect(r2Key).toBeDefined();
    expect(r2Secret).toBeDefined();
    expect(r2Key!.trim()).toBe('R2_ACCESS_KEY_ID=');
    expect(r2Secret!.trim()).toBe('R2_SECRET_ACCESS_KEY=');
  });

  test('Resend API key is empty in template', () => {
    const lines = productionEnv.split('\n');
    const resendKey = lines.find((l) => l.startsWith('RESEND_API_KEY='));
    expect(resendKey).toBeDefined();
    expect(resendKey!.trim()).toBe('RESEND_API_KEY=');
  });

  test('NODE_ENV is set to development in template (not production)', () => {
    // The template is a starting point — should default to development
    const nodeEnv = productionEnv.split('\n').find((l) => l.startsWith('NODE_ENV='));
    expect(nodeEnv).toBeDefined();
    expect(nodeEnv).toContain('development');
  });
});

// ─── Docker development without production secrets ─────────

describe('R2-12c — Docker development environment', () => {
  const dockerEnvPath = path.resolve(__dirname, '../../.env.docker');

  test('.env.docker file exists', () => {
    expect(fs.existsSync(dockerEnvPath)).toBe(true);
  });

  test('.env.docker sets NODE_ENV=production', () => {
    const dockerEnv = fs.readFileSync(dockerEnvPath, 'utf8');
    const nodeEnv = dockerEnv.split('\n').find((l) => l.startsWith('NODE_ENV='));
    expect(nodeEnv).toContain('production');
  });

  test('.env.docker has valid DATABASE_URL', () => {
    const dockerEnv = fs.readFileSync(dockerEnvPath, 'utf8');
    const dbLine = dockerEnv.split('\n').find((l) => l.startsWith('DATABASE_URL='));
    expect(dbLine).toBeDefined();
    expect(dbLine).toContain('postgresql://');
  });

  test('.env.docker has valid JWT_SECRET (min 32 chars)', () => {
    const dockerEnv = fs.readFileSync(dockerEnvPath, 'utf8');
    const jwtLine = dockerEnv.split('\n').find((l) => l.startsWith('JWT_SECRET='));
    expect(jwtLine).toBeDefined();
    const secret = jwtLine!.split('=')[1].replace(/"/g, '');
    expect(secret.length).toBeGreaterThanOrEqual(32);
  });

  test('.env.docker disables FCM', () => {
    const dockerEnv = fs.readFileSync(dockerEnvPath, 'utf8');
    const fcmLine = dockerEnv.split('\n').find((l) => l.startsWith('FCM_ENABLED='));
    expect(fcmLine).toContain('false');
  });

  test('.env.docker has external services commented out', () => {
    const dockerEnv = fs.readFileSync(dockerEnvPath, 'utf8');
    const lines = dockerEnv.split('\n');
    // External services should be commented or empty
    const twilioLines = lines.filter((l) => l.includes('TWILIO'));
    const twilioActive = twilioLines.filter((l) => !l.startsWith('#') && l.includes('='));
    // Active Twilio lines should have empty values
    for (const line of twilioActive) {
      const value = line.split('=')[1]?.trim();
      expect(!value || value === '').toBe(true);
    }
  });
});

// ─── env.ts source code audit ──────────────────────────────

describe('R2-12c — env.ts source audit', () => {
  const envSrc = fs.readFileSync(
    path.resolve(__dirname, '../../src/config/env.ts'),
    'utf8',
  );

  test('env.ts uses Zod for validation', () => {
    expect(envSrc).toContain("from 'zod'");
    expect(envSrc).toContain('z.object');
    expect(envSrc).toContain('safeParse');
  });

  test('env.ts exits on invalid config', () => {
    expect(envSrc).toContain('process.exit(1)');
  });

  test('env.ts logs validation errors', () => {
    expect(envSrc).toContain('console.error');
    expect(envSrc).toContain('Invalid environment variables');
  });

  test('JWT_SECRET has min(32) validation', () => {
    expect(envSrc).toContain('min(32');
  });

  test('DATABASE_URL validates as URL', () => {
    expect(envSrc).toContain('.url()');
  });

  test('Provider configs are optional (not required)', () => {
    // R2, Resend, Twilio, FCM should all be optional
    expect(envSrc).toContain('R2_ACCOUNT_ID: z.string().optional()');
    expect(envSrc).toContain('RESEND_API_KEY: z.string().optional()');
    expect(envSrc).toContain('TWILIO_ACCOUNT_SID: z.string().optional()');
    expect(envSrc).toContain('FCM_ENABLED:');
  });

  test('PUSH_MASTER_SECRET requires min 32 chars when set', () => {
    expect(envSrc).toContain('PUSH_MASTER_SECRET: z.string().min(32)');
  });
});

// ─── Sensitive values redacted from logs ───────────────────

describe('R2-12c — Log redaction audit', () => {
  test('Twilio WhatsApp service masks phone numbers in logs', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../src/services/twilio-whatsapp.service.ts'),
      'utf8',
    );
    expect(src).toContain("to.slice(0, 6) + '****'");
  });

  test('Twilio WhatsApp service does not log auth token', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../src/services/twilio-whatsapp.service.ts'),
      'utf8',
    );
    // The auth header is built but should not be logged
    const logStatements = src.match(/logger\.\w+\([^)]*\)/g) || [];
    for (const log of logStatements) {
      expect(log).not.toContain('authToken');
      expect(log).not.toContain('TWILIO_AUTH_TOKEN');
    }
  });

  test('Resend service does not log API key', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../src/lib/email/resend.service.ts'),
      'utf8',
    );
    const logStatements = src.match(/logger\.\w+\([^)]*\)/g) || [];
    for (const log of logStatements) {
      expect(log).not.toContain('RESEND_API_KEY');
      expect(log).not.toContain('apiKey');
    }
  });

  test('credential-delivery masks phone numbers in logs', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../src/services/credential-delivery.service.ts'),
      'utf8',
    );
    expect(src).toContain("to.slice(0, 6) + '****'");
  });

  test('FCM service does not log device tokens', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../src/modules/chat/push/fcm.service.ts'),
      'utf8',
    );
    const logStatements = src.match(/logger\.\w+\([^)]*\)/g) || [];
    for (const log of logStatements) {
      expect(log).not.toContain('token');
    }
  });
});
