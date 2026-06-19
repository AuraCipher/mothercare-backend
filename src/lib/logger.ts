import env from '../config/env';

// ─── Logger ─────────────────────────────────────────────
// APP_MODE=development: verbose (info, warn, error, debug)
// APP_MODE=production:  only errors, no debug, no info
// ─────────────────────────────────────────────────────────

const IS_DEV = env.APP_MODE === 'development';

function timestamp() {
  return new Date().toISOString().slice(11, 23); // HH:mm:ss.SSS
}

// Pretty-print objects with 2-space indentation for readability
function pretty(val: any): string {
  if (val === null || val === undefined) return '';
  if (typeof val === 'object') {
    try { return '\n' + JSON.stringify(val, null, 2); } catch { return ''; }
  }
  return ` ${val}`;
}

export default {
  info: (label: string, meta?: any) => {
    if (!IS_DEV) return;
    console.info(`[${timestamp()}]  INFO  ${label}${pretty(meta)}`);
  },

  warn: (label: string, meta?: any) => {
    if (!IS_DEV) return;
    console.warn(`[${timestamp()}]  WARN  ${label}${pretty(meta)}`);
  },

  error: (label: string, meta?: any) => {
    console.error(`[${timestamp()}]  ERROR ${label}${pretty(meta)}`);
  },

  debug: (label: string, meta?: any) => {
    if (!IS_DEV) return;
    console.debug(`[${timestamp()}]  DEBUG ${label}${pretty(meta)}`);
  },

  // Request/Response logging (development only)
  req: (method: string, url: string, body?: any) => {
    if (!IS_DEV) return;
    const bodyStr = body && Object.keys(body).length > 0 ? pretty(body) : '';
    console.log(`[${timestamp()}]  -->  ${method}  ${url}${bodyStr}`);
  },

  res: (method: string, url: string, status: number, duration: number) => {
    if (!IS_DEV) return;
    const color = status >= 400 ? '\x1b[31m' : status >= 300 ? '\x1b[33m' : '\x1b[32m';
    console.log(`[${timestamp()}]  <--  ${method}  ${url}  ${color}${status}\x1b[0m  ${duration.toFixed(0)}ms`);
  },
};
