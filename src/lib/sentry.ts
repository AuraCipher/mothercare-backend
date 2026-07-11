import * as Sentry from '@sentry/node';
import env from '../config/env';
import logger from './logger';

let initialized = false;

export function initSentry() {
  if (initialized) return;
  const dsn = env.SENTRY_DSN;
  if (!dsn) {
    logger.info('Sentry disabled — SENTRY_DSN not set');
    return;
  }

  Sentry.init({
    dsn,
    environment: env.NODE_ENV,
    tracesSampleRate: env.NODE_ENV === 'production' ? 0.1 : 1.0,
  });
  initialized = true;
  logger.info('Sentry initialized');
}

export function captureRequestError(
  err: unknown,
  req: { method: string; originalUrl: string; user?: { id?: string } },
) {
  if (!initialized || !env.SENTRY_DSN) return;

  Sentry.withScope((scope) => {
    scope.setTag('method', req.method);
    scope.setTag('route', req.originalUrl);
    if (req.user?.id) scope.setUser({ id: req.user.id });
    Sentry.captureException(err);
  });
}

export { Sentry };
