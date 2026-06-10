import rateLimit from 'express-rate-limit';

/**
 * Rate limiter for password set endpoint.
 * Prevents brute-force attacks against admin password verification.
 * 5 attempts per minute per IP — more than enough for legitimate use.
 */
export const passwordSetLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many attempts. Please try again in 1 minute.',
  },
});
