import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  // REQUIRED
  PORT: z.string().default('5000'),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),

  // APP MODE: 'development' = verbose logs, 'production' = silent
  APP_MODE: z.enum(['development', 'production']).default('production'),

  // OPTIONAL
  // Optional: local Redis (tcp). Only used if set; skips localhost.
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
  META_WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  META_WHATSAPP_BUSINESS_ACCOUNT_ID: z.string().optional(),
  META_WHATSAPP_ACCESS_TOKEN: z.string().optional(),
  META_WHATSAPP_API_VERSION: z.string().default('v21.0'),
  ALLOWED_ORIGINS: z.string().optional(),

  // Cloudflare R2 (optional — falls back to local uploads/ when unset)
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_DOCUMENTS_BUCKET: z.string().default('mcs-documents'),
  R2_BACKUPS_BUCKET: z.string().default('mcs-backups'),
  R2_PUBLIC_BASE_URL: z.string().url().optional(),

  // Default school branch name for single-school auto-assignment
  DEFAULT_BRANCH_NAME: z.string().default('Mother Care Sohan'),

  // Mobile chat + encrypted FCM (optional in dev)
  PUSH_MASTER_SECRET: z.string().min(32).optional(),
  FIREBASE_SERVICE_ACCOUNT_PATH: z.string().optional(),
  FIREBASE_SERVICE_ACCOUNT_JSON: z.string().optional(),
  FCM_ENABLED: z.enum(['true', 'false']).default('false'),
  SOCKET_PATH: z.string().default('/socket.io'),
  CHAT_QUEUE_CONCURRENCY: z.string().default('5'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables:');
  parsed.error.issues.forEach((issue) => {
    console.error(` - ${issue.path.join('.')}: ${issue.message}`);
  });
  process.exit(1);
}

export default parsed.data;
