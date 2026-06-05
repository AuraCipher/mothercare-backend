import { Request, Response, NextFunction } from 'express';
import logger from '../lib/logger';

export default function errorHandler(err: any, req: Request, res: Response, _next: NextFunction) {
  const status = err.status || err.statusCode || 500;
  const message = err.message || 'Internal server error';

  // Always log errors (production + development)
  logger.error('Request failed', {
    message,
    status,
    method: req.method,
    url: req.originalUrl,
    // @ts-ignore
    userId: req.user?.id,
    stack: err.stack,
  });

  // Don't leak error details in production
  const isDev = process.env.APP_MODE === 'development';

  res.status(status).json({
    success: false,
    message: isDev ? message : (status === 500 ? 'Internal server error' : message),
    ...(isDev && { stack: err.stack }),
  });
}
