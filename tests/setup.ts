/**
 * Global Test Setup
 *
 * This file runs before each test suite to set up the test environment.
 * It sets environment variables needed for testing.
 */

// ─── Environment ───────────────────────────────────────────
process.env.NODE_ENV = 'test';

// ─── JWT ───────────────────────────────────────────────────
process.env.JWT_SECRET = 'test-secret-key-for-testing-only-that-is-at-least-32-chars';
process.env.JWT_EXPIRY = '1h';

// ─── Database ──────────────────────────────────────────────
// Won't actually connect since we mock Prisma
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/mcs_test';

// ─── App ──────────────────────────────────────────────────
process.env.APP_MODE = 'development';
process.env.PORT = '0'; // Random available port
process.env.HOST = '127.0.0.1';

// ─── Optional features (disabled in tests) ────────────────
process.env.UPSTASH_REDIS_REST_URL = '';
process.env.UPSTASH_REDIS_REST_TOKEN = '';
process.env.REDIS_URL = '';
process.env.MESSAGE_QUEUE_CONCURRENCY = '3';

process.env.META_WHATSAPP_PHONE_NUMBER_ID = '';
process.env.META_WHATSAPP_BUSINESS_ACCOUNT_ID = '';
process.env.META_WHATSAPP_ACCESS_TOKEN = '';
process.env.META_WHATSAPP_API_VERSION = 'v21.0';

// ─── CORS ────────────────────────────────────────────────
process.env.ALLOWED_ORIGINS = 'http://localhost:3000';
