import env from '../config/env';
import logger from './logger';

type SentryLike = {
  init: (options: Record<string, unknown>) => void;
  withScope: (fn: (scope: { setTag: (k: string, v: string) => void; setUser: (u: { id: string }) => void }) => void) => void;
  captureException: (err: unknown) => void;
};

let sentry: SentryLike | null = null;

function loadSentry(): SentryLike | null {
  if (sentry) return sentry;
  try {
    // Optional dependency — install @sentry/node when enabling error tracking.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('@sentry/node') as SentryLike;
    sentry = mod;
    return mod;
  } catch {
    return null;
  }
}

export function initSentry() {
  const dsn = env.SENTRY_DSN;
  if (!dsn) {
    logger.info('Sentry disabled — SENTRY_DSN not set');
    return;
  }

  const client = loadSentry();
  if (!client) {
    logger.warn('Sentry DSN set but @sentry/node is not installed');
    return;
  }

  client.init({
    dsn,
    environment: env.NODE_ENV,
    tracesSampleRate: env.NODE_ENV === 'production' ? 0.1 : 1.0,
  });
  logger.info('Sentry initialized');
}

export function captureRequestError(
  err: unknown,
  req: { method: string; originalUrl: string; user?: { id?: string } },
) {
  const client = loadSentry();
  if (!client || !env.SENTRY_DSN) return;

  client.withScope((scope) => {
    scope.setTag('method', req.method);
    scope.setTag('route', req.originalUrl);
    if (req.user?.id) scope.setUser({ id: req.user.id });
    client.captureException(err);
  });
}
