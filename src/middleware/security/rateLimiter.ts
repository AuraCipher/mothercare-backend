import rateLimit from 'express-rate-limit';

const passwordWindowMs = Number(process.env.RATE_LIMIT_PASSWORD_WINDOW_MS ?? 60_000);
const passwordMax = Number(process.env.RATE_LIMIT_PASSWORD_MAX ?? 5);
const uploadWindowMs = Number(process.env.RATE_LIMIT_UPLOAD_WINDOW_MS ?? 60_000);
const uploadMax = Number(process.env.RATE_LIMIT_UPLOAD_MAX ?? 20);

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
