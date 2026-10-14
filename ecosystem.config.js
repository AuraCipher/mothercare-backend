/**
 * PM2 process file for the Mother Care School backend (CommonJS).
 *
 * Usage (always from the backend directory):
 *   cd /home/root/mothercare-backend
 *   pm2 start ecosystem.config.js
 *   pm2 logs mcs-backend
 *   pm2 save                 # persist the process list
 *   pm2 startup              # run the printed sudo command → survives reboot
 *
 * After a code update:
 *   npm ci && npx prisma generate && npx prisma migrate deploy && npm run build
 *   pm2 restart mcs-backend --update-env
 *
 * WHY cwd MATTERS: server.ts starts with `import 'dotenv/config'`, which reads
 * .env from process.cwd(). Setting cwd here means it works no matter where you
 * run `pm2 start` from.
 */

const path = require('path');

const ROOT = __dirname;

module.exports = {
  apps: [
    {
      name: 'mcs-backend',

      // Compiled output — NOT `npm run dev` (nodemon + ts-node are dev-only
      // and would watch/restart your live server on every file edit).
      script: path.join(ROOT, 'dist', 'server.js'),
      cwd: ROOT,

      // fork = one OS process. 1 instance is correct for a single VPS.
      // Scaling: set instances: 2+ with exec_mode: 'cluster', and add nginx
      // sticky sessions (ip_hash) — the Socket.IO Redis adapter is already
      // enabled, so cross-instance chat fanout works.
      instances: 1,
      exec_mode: 'fork',

      // ── Environment ─────────────────────────────────────────────
      // dotenv does NOT override vars already in process.env, so these win
      // over .env — they are the safety net that keeps the auth cookie
      // `secure: true` (auth.controller.ts) in the right mode.
      // PORT / HOST intentionally NOT set here → taken from .env
      // (you have HOST=127.0.0.1 for nginx on the same box).
      env: {
        NODE_ENV: 'production',
        APP_MODE: 'production',
      },

      // ── Restarts ────────────────────────────────────────────────
      autorestart: true,
      min_uptime: '10s', // uptime below this = crashed at boot → counted as failure
      max_restarts: 10, // give up after 10 fast crashes in a row
      exp_backoff_restart_delay: 100, // 100, 200, 400, 800… ms between retries
      max_memory_restart: '600M', // restart if RSS exceeds this (sharp/media jobs)

      // ── Graceful shutdown ───────────────────────────────────────
      // server.ts traps SIGINT/SIGTERM, closes workers + socket.io + prisma,
      // then force-exits after 10s (src/lib/startup.ts). PM2 must wait > 10s
      // before it escalates to SIGKILL, or in-flight requests get cut.
      kill_timeout: 15000,
      listen_timeout: 10000,

      // ── Watch (keep OFF in production) ──────────────────────────
      watch: false,
      ignore_watch: ['node_modules', 'logs', '.git', 'uploads', 'dist', '*.log'],

      // ── Logs ────────────────────────────────────────────────────
      out_file: path.join(ROOT, 'logs', 'pm2-out.log'),
      error_file: path.join(ROOT, 'logs', 'pm2-error.log'),
      merge_logs: true, // one combined stream across restarts
      time: true, // prefix each line with a timestamp

      // ── Misc ────────────────────────────────────────────────────
      // Kill the whole process group on stop/restart so no stray
      // `npx`/child workers linger holding :5000.
      kill_retry_time: 1000,
      wait_ready: false, // server.ts does not call process.send('ready')
    },
  ],
};
