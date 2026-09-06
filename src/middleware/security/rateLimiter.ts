import rateLimit from 'express-rate-limit';

const passwordWindowMs = Number(process.env.RATE_LIMIT_PASSWORD_WINDOW_MS ?? 60_000);
const passwordMax = Number(process.env.RATE_LIMIT_PASSWORD_MAX ?? 5);
const uploadWindowMs = Number(process.env.RATE_LIMIT_UPLOAD_WINDOW_MS ?? 60_000);
const uploadMax = Number(process.env.RATE_LIMIT_UPLOAD_MAX ?? 20);
const loginWindowMs = Number(process.env.RATE_LIMIT_LOGIN_WINDOW_MS ?? 900_000); // 15 min
const loginMax = Number(process.env.RATE_LIMIT_LOGIN_MAX ?? 10);
const globalWindowMs = Number(process.env.RATE_LIMIT_GLOBAL_WINDOW_MS ?? 60_000);
const globalMax = Number(process.env.RATE_LIMIT_GLOBAL_MAX ?? 100);

/**
 * Rate limiter for password set endpoint.
 * Prevents brute-force attacks against admin password verification.
 */
export const passwordSetLimiter = rateLimit({
  windowMs: passwordWindowMs,
  max: passwordMax,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many attempts. Please try again in 1 minute.',
  },
});

/**
 * Rate limiter for file upload endpoint.
 * Prevents disk space abuse by limiting upload frequency.
 */
export const uploadLimiter = rateLimit({
  windowMs: uploadWindowMs,
  max: uploadMax,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many uploads. Please slow down (max 20 per minute).',
  },
});

/**
 * Rate limiter for login endpoint.
 * Prevents brute-force credential stuffing.
 * 10 attempts per 15 minutes per IP.
 */
export const loginLimiter = rateLimit({
  windowMs: loginWindowMs,
  max: loginMax,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many login attempts. Please try again in 15 minutes.',
  },
});

/**
 * General API rate limiter.
 * Prevents abuse across all API endpoints.
 * 100 requests per minute per IP.
 */
export const globalLimiter = rateLimit({
  windowMs: globalWindowMs,
  max: globalMax,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many requests. Please slow down.',
  },
});
