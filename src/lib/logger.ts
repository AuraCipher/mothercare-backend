import env from '../config/env';

// ─── Logger ─────────────────────────────────────────────
// Production:  JSON-structured logs (info, warn, error)
//              Request cycle logging enabled (req/res with requestId)
// Development: Pretty-printed console logs (all levels)
// ─────────────────────────────────────────────────────────

const IS_DEV = env.APP_MODE === 'development';

function timestamp() {
  return new Date().toISOString();
}

// Pretty-print objects with 2-space indentation for readability
function pretty(val: any): string {
  if (val === null || val === undefined) return '';
  if (typeof val === 'object') {
    try { return '\n' + JSON.stringify(val, null, 2); } catch { return ''; }
  }
  return ` ${val}`;
}

/** Structured JSON log for production (log aggregation compatible) */
function jsonLog(level: string, label: string, meta?: any) {
  const entry: Record<string, any> = {
    ts: timestamp(),
    level,
    msg: label,
  };
  if (meta !== undefined && meta !== null) {
    if (typeof meta === 'object') {
      try { Object.assign(entry, meta); } catch { entry.meta = String(meta); }
    } else {
      entry.meta = meta;
    }
  }
  // Single-line JSON for log aggregation (ELK, Datadog, CloudWatch, etc.)
  console.log(JSON.stringify(entry));
}

/** Sanitize meta to strip known secret patterns before logging. */
function sanitizeMeta(meta: any): any {
  if (!meta || typeof meta !== 'object') return meta;
  const sensitive = /(password|secret|token|key|authorization|cookie|database_url|redis_url)/i;
  const sanitized: Record<string, any> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (sensitive.test(k) && typeof v === 'string') {
      sanitized[k] = '[REDACTED]';
    } else {
      sanitized[k] = v;
    }
  }
  return sanitized;
}

export default {
  info: (label: string, meta?: any) => {
    if (IS_DEV) {
      console.info(`[${timestamp().slice(11, 23)}]  INFO  ${label}${pretty(meta)}`);
    } else {
      jsonLog('info', label, sanitizeMeta(meta));
    }
  },

  warn: (label: string, meta?: any) => {
    if (IS_DEV) {
      console.warn(`[${timestamp().slice(11, 23)}]  WARN  ${label}${pretty(meta)}`);
    } else {
      jsonLog('warn', label, sanitizeMeta(meta));
    }
  },

  error: (label: string, meta?: any) => {
    if (IS_DEV) {
      console.error(`[${timestamp().slice(11, 23)}]  ERROR ${label}${pretty(meta)}`);
    } else {
      jsonLog('error', label, sanitizeMeta(meta));
    }
  },

  debug: (label: string, meta?: any) => {
    if (!IS_DEV) return;
    console.debug(`[${timestamp().slice(11, 23)}]  DEBUG  ${label}${pretty(meta)}`);
  },

  /** Log incoming request. Works in ALL environments. */
  req: (method: string, url: string, requestId?: string, body?: any) => {
    const base = { method, url, ...(requestId ? { requestId } : {}) };
    if (IS_DEV) {
      const bodyStr = body && Object.keys(body).length > 0 ? pretty(body) : '';
      console.log(`[${timestamp().slice(11, 23)}]  -->  ${method}  ${url}${bodyStr}`);
    } else {
      const meta = body && Object.keys(body).length > 0
        ? { ...base, body: sanitizeMeta(body) }
        : base;
      jsonLog('info', 'request', meta);
    }
  },

  /** Log outgoing response. Works in ALL environments. */
  res: (method: string, url: string, status: number, duration: number, requestId?: string) => {
    if (IS_DEV) {
      const color = status >= 400 ? '\x1b[31m' : status >= 300 ? '\x1b[33m' : '\x1b[32m';
      console.log(`[${timestamp().slice(11, 23)}]  <--  ${method}  ${url}  ${color}${status}\x1b[0m  ${duration.toFixed(0)}ms`);
    } else {
      jsonLog(status >= 400 ? 'warn' : 'info', 'response', {
        method,
        url,
        status,
        durationMs: Math.round(duration),
        ...(requestId ? { requestId } : {}),
      });
    }
  },
};
