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
  OTP_EXPIRY_MINUTES: z.string().default('10'),
  APP_URL: z.string().url().optional(),
  FRONTEND_URL: z.string().url().optional(),
  SCHOOL_NAME: z.string().default('Mother Care School'),
  UPSTASH_REDIS_REST_URL: z.string().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM_EMAIL: z.string().optional(),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_PHONE_NUMBER: z.string().optional(),
  TWILIO_WHATSAPP_NUMBER: z.string().optional(),
  ALLOWED_ORIGINS: z.string().optional(),

  // Default school branch name for single-school auto-assignment
  DEFAULT_BRANCH_NAME: z.string().default('Mother Care Sohan'),
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
