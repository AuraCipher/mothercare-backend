import env from '../config/env';

// ─── Logger ─────────────────────────────────────────────
// APP_MODE=development: verbose (info, warn, error, debug)
// APP_MODE=production:  only errors, no debug, no info
// ─────────────────────────────────────────────────────────

const IS_DEV = env.APP_MODE === 'development';

function timestamp() {
  return new Date().toISOString().slice(11, 23); // HH:mm:ss.SSS
}

export default {
  info: (label: string, meta?: any) => {
    if (!IS_DEV) return;
    if (meta) console.info(`[${timestamp()}]  INFO  ${label}`, meta);
    else console.info(`[${timestamp()}]  INFO  ${label}`);
  },

  warn: (label: string, meta?: any) => {
    if (!IS_DEV) return;
    if (meta) console.warn(`[${timestamp()}]  WARN  ${label}`, meta);
    else console.warn(`[${timestamp()}]  WARN  ${label}`);
  },

  error: (label: string, meta?: any) => {
    if (meta) console.error(`[${timestamp()}]  ERROR ${label}`, meta);
    else console.error(`[${timestamp()}]  ERROR ${label}`);
  },

  debug: (label: string, meta?: any) => {
    if (!IS_DEV) return;
    if (meta) console.debug(`[${timestamp()}]  DEBUG ${label}`, meta);
    else console.debug(`[${timestamp()}]  DEBUG ${label}`);
  },

  // Request/Response logging (development only)
  req: (method: string, url: string, body?: any) => {
    if (!IS_DEV) return;
    if (body && Object.keys(body).length > 0) {
      console.log(`[${timestamp()}]  -->  ${method}  ${url}`, body);
    } else {
      console.log(`[${timestamp()}]  -->  ${method}  ${url}`);
    }
  },

  res: (method: string, url: string, status: number, duration: number) => {
    if (!IS_DEV) return;
    const color = status >= 400 ? '\x1b[31m' : status >= 300 ? '\x1b[33m' : '\x1b[32m';
    console.log(`[${timestamp()}]  <--  ${method}  ${url}  ${color}${status}\x1b[0m  ${duration.toFixed(0)}ms`);
  },
};
