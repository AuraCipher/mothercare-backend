import { Request, Response, NextFunction } from 'express';
import logger from '../../lib/logger';
import { captureRequestError } from '../../lib/sentry';

export default function errorHandler(err: any, req: Request, res: Response, _next: NextFunction) {
  // Prisma P2025 — record not found on delete/update
  if (err?.code === 'P2025') {
    return res.status(404).json({
      success: false,
      message: 'The requested resource was not found.',
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
  const isDev = process.env.APP_MODE === 'development';
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
