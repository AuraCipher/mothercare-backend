import { Request, Response, NextFunction } from 'express';
import logger from '../../lib/logger';
import { captureRequestError } from '../../lib/sentry';

/**
 * Prisma failures that are really the caller's fault, not a server fault.
 * Without this mapping every one of them collapses into a masked 500
 * ("Internal server error"), so the UI cannot explain what went wrong and
 * the real cause is only visible in the server log.
 */
const PRISMA_ERRORS: Record<string, { status: number; message: string }> = {
  // Unique constraint — the record already exists (duplicate admission
  // number, student number, username, email…).
  P2002: { status: 409, message: 'That record already exists.' },
  // Foreign key constraint — something still points at this row.
  P2003: { status: 400, message: 'This record is still linked to other data and cannot be changed.' },
  // Required relation still holds rows — the same case as P2003 for deletes.
  P2014: { status: 400, message: 'This record is still linked to other data and cannot be changed.' },
  // Connection pool exhausted — the server is busy, not broken.
  P2024: { status: 503, message: 'The server is busy right now. Please try again.' },
};

export default function errorHandler(err: any, req: Request, res: Response, _next: NextFunction) {
  const isDev = process.env.APP_MODE === 'development';

  // Prisma P2025 — record not found on delete/update
  if (err?.code === 'P2025') {
    return res.status(404).json({
      success: false,
      message: 'The requested resource was not found.',
    });
  }

  // Known Prisma failures are client errors, not server faults.
  const prismaError = err?.code ? PRISMA_ERRORS[err.code] : undefined;
  if (prismaError) {
    logger.warn('Request rejected by database constraint', {
      code: err.code,
      method: req.method,
      url: req.originalUrl,
      // @ts-ignore
      userId: req.user?.id,
      ...(isDev ? { detail: err.message } : {}),
    });
    return res.status(prismaError.status).json({
      success: false,
      code: err.code,
      message: isDev ? (err.message || prismaError.message) : prismaError.message,
    });
  }

  const status = err.status || err.statusCode || 500;
  const message = err.message || 'Internal server error';
  const requestId = (req.headers['x-request-id'] as string) || undefined;

  if (status >= 500) {
    captureRequestError(err, {
      method: req.method,
      originalUrl: req.originalUrl,
      // @ts-ignore
      user: req.user,
    });
  }

  // Always log errors (production + development)
  logger.error('Request failed', {
    message,
    status,
    method: req.method,
    url: req.originalUrl,
    // @ts-ignore
    userId: req.user?.id,
    ...(requestId ? { requestId } : {}),
    ...(isDev && { stack: err.stack }),
  });

  // Production-safe response: never leak internals
  const response: Record<string, any> = {
    success: false,
    message: isDev ? message : (status === 500 ? 'Internal server error' : message),
  };

  if (isDev) {
    response.stack = err.stack;
  }

  // Only include structured validation errors in dev mode.
  // In production, raw err.errors could leak SQL, Zod internals,
  // or Prisma schema details.
  if (isDev && err.errors) {
    response.errors = err.errors;
  }

  res.status(status).json(response);
}
