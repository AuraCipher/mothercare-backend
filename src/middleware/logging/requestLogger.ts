import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import logger from '../../lib/logger';

/**
 * Sanitizes request body for logging — redacts sensitive fields.
 */
function sanitizeBody(body: any): any {
  if (!body || typeof body !== 'object') return body;
  const SENSITIVE_KEYS = /^(password|adminPassword|newPassword|token|secret|keyHash)$/i;
  const sanitized: any = {};
  for (const [key, value] of Object.entries(body)) {
    if (SENSITIVE_KEYS.test(key)) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      sanitized[key] = sanitizeBody(value);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

/**
 * Request/Response logging middleware
 * - Adds X-Request-ID correlation header to every request
 * - Logs incoming request and outgoing response (sanitized)
 * - In production: structured JSON logs for log aggregation
 */
export default function requestLogger(req: Request, res: Response, next: NextFunction) {
  const start = Date.now();

  // Correlation ID — use client-provided or generate new
  const requestId = (req.headers['x-request-id'] as string) || crypto.randomUUID();
  req.headers['x-request-id'] = requestId;
  res.setHeader('X-Request-ID', requestId);

  // Store audit context for downstream use (fee audit log, etc.)
  (req as any).auditContext = {
    ipAddress: req.ip || req.socket.remoteAddress || null,
    userAgent: req.headers['user-agent'] || null,
    requestId,
  };

  // Log incoming request — sanitized
  logger.req(req.method, req.originalUrl, sanitizeBody(req.body));

  // Capture the original end function
  const originalEnd = res.end.bind(res);

  // @ts-ignore: monkey-patch res.end to log response
  res.end = (chunk: any, encoding?: any, cb?: any) => {
    const duration = Date.now() - start;
    logger.res(req.method, req.originalUrl, res.statusCode, duration);
    return originalEnd(chunk, encoding, cb);
  };

  next();
}
