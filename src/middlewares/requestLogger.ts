import { Request, Response, NextFunction } from 'express';
import logger from '../lib/logger';

/**
 * Request/Response logging middleware
 * Logs: incoming request (method, url, body) and outgoing response (status, duration)
 */
export default function requestLogger(req: Request, res: Response, next: NextFunction) {
  const start = Date.now();

  // Log incoming request (development only)
  logger.req(req.method, req.originalUrl, req.body);

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

