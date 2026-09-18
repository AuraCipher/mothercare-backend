import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import authRoutes from './modules/auth/auth.routes';
import apiKeyRoutes from './modules/api-key/api-key.routes';
import setupRoutes from './modules/setup/setup.routes';
import adminRoutes, { meRouter } from './modules/admin/routes/admin.routes';
import invitationRoutes from './modules/admin/routes/invitation.routes';
import branchAdminRoutes from './modules/admin/routes/branch-admin.routes';
import uploadRoutes from './modules/upload/upload.routes';
import chatRoutes from './modules/chat/routes/chat.routes';
import staffPortalRoutes from './modules/staff/routes/staff.routes';
import canteenRoutes from './modules/canteen/canteen.routes';
import teacherPortalRoutes from './modules/teacher/routes/teacher.routes';
import studentPortalRoutes from './modules/student/routes/student.routes';
import errorHandler from './middleware/error/errorHandler';
import requestLogger from './middleware/logging/requestLogger';
import { auditContextMiddleware } from './middleware/auth/auditContext.middleware';
import { globalLimiter } from './middleware/security/rateLimiter';
import env from './config/env';
import { isReady, getReadinessReport, getComponentStatus, getUptimeMs } from './lib/componentStatus';

const app = express();

// ─── Security & Parsing ──────────────────────────────────────
// Helmet with relaxed CSP for the key-manager page (inline scripts needed).
// All other routes keep the strict default.
app.use((req, res, next) => {
  if (req.path === '/key-manager') {
    return helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'"],
          scriptSrcAttr: ["'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          connectSrc: ["'self'"],
        },
      },
    })(req, res, next);
  }
  return helmet()(req, res, next);
});
app.use(cors({
  origin: (origin, cb) => {
    // In development mode, allow any origin (local dev, ngrok, etc.)
    if (env.APP_MODE === 'development' && origin) return cb(null, true);
    const allowed = env.ALLOWED_ORIGINS?.split(',').map(o => o.trim()) || [];
    if (!origin || allowed.includes(origin)) return cb(null, true);
    cb(new Error('Not allowed by CORS'));
  },
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key', 'x-publishable-api-key'],
}));

// NOTE: CORS fallback middleware intentionally removed.
// The cors() middleware above handles all origin validation.
// The old fallback set Access-Control-Allow-Origin: * which
// defeated CORS protection entirely in production.

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// ─── Global Rate Limiter ────────────────────────────────────
app.use('/api', globalLimiter);
app.use('/admin', globalLimiter);

// ─── Request / Response Logger ──────────────────────────────────
// Now works in ALL environments (dev + production) with requestId propagation
app.use(requestLogger);

// ─── Global Audit Context ───────────────────────────────────────
// Captures req reference for every request. logAudit() reads userId
// from req.user lazily at call time, so this works regardless of
// where auth middleware is mounted in sub-routers.
app.use(auditContextMiddleware);

// ─── Admin HTML Pages (served from src/admin/) ──────────────
// Resolve relative to this file so it works in both dev (src/) and
// production (dist/) — the HTML lives in src/admin/ and is NOT
// compiled by tsc, so we always step up one level from __dirname.
const adminHtmlDir = path.resolve(__dirname, '..', 'src', 'admin');

function serveHtml(route: string, fileName: string) {
  const filePath = path.join(adminHtmlDir, fileName);
  app.get(route, (_req, res) => {
    fs.readFile(filePath, 'utf8', (err, data) => {
      if (err) {
        console.error(`[${fileName}] Failed to read:`, filePath, err.message);
        return res.status(500).send('Failed to load page');
      }
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.send(data);
    });
  });
}

serveHtml('/key-manager', 'index.html');

// ─── Public Routes ─────────────────────────────────────────────
app.get('/', (_req, res) => {
  res.json({
    name: 'Mother Care School',
    version: '1.0.0',
    endpoints: {
      setup: '/setup/init',
      auth: '/auth',
      apiKeys: '/api-keys',
      admin: '/admin',
      teacher: '/teacher',
      student: '/student',
      chat: '/chat',
      health: '/health',
      healthLive: '/health/live',
      healthReady: '/health/ready',
      keyManager: '/key-manager',
    },
  });
});

// ─── Health Endpoints ──────────────────────────────────────────

/**
 * Liveness: "Is the process alive?"
 *
 * Must remain lightweight — no external dependency checks.
 * This answers the load balancer question: should this instance
 * be kept in the rotation or killed and restarted?
 *
 * K8s/Docker: use as livenessProbe.
 */
app.get('/health/live', (_req, res) => {
  res.status(200).json({
    status: 'alive',
    timestamp: new Date().toISOString(),
  });
});

/**
 * Readiness: "Can this instance serve normal traffic?"
 *
 * Checks only dependencies that are REQUIRED for normal operation.
 * Currently: PostgreSQL is the only critical dependency.
 * Redis, Socket.IO, and BullMQ workers are optional (graceful degradation).
 *
 * K8s/Docker: use as readinessProbe.
 */
app.get('/health/ready', async (_req, res) => {
  const report = getReadinessReport();

  // Database is the only critical dependency for readiness.
  // Other components degrade gracefully (queue → direct, auth → no blacklist).
  if (!isReady()) {
    return res.status(503).json({
      ...report,
      status: 'not_ready',
      message: 'Database not ready — instance cannot serve traffic',
      timestamp: new Date().toISOString(),
    });
  }

  res.status(200).json({
    ...report,
    status: 'ready',
    timestamp: new Date().toISOString(),
  });
});

/**
 * Backward-compatible: GET /health
 * Returns liveness status (same as /health/live).
 */
app.get('/health', (_req, res) => {
  res.status(200).json({
    status: 'OK',
    timestamp: new Date().toISOString(),
  });
});

/**
 * Deep health check — verifies DB + Redis connectivity (5 s deadline)
 * Kept for backward compatibility. Prefer /health/ready for probes.
 */
app.get('/health/deep', async (_req, res) => {
  const checks: Record<string, string> = {};
  let healthy = true;

  // Database check (bounded)
  try {
    const { prisma } = await import('./lib/prisma');
    await Promise.race([
      prisma.$queryRaw`SELECT 1`,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('DB timeout')), 5000)),
    ]);
    checks.database = 'ok';
  } catch {
    checks.database = 'fail';
    healthy = false;
  }

  // Redis check (bounded)
  try {
    const { getUpstashRedis } = await import('./config/redis');
    const client = getUpstashRedis();
    if (client) {
      await Promise.race([
        client.ping(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Redis timeout')), 5000)),
      ]);
      checks.redis = 'ok';
    } else {
      checks.redis = 'not_configured';
    }
  } catch {
    checks.redis = 'fail';
  }

  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'OK' : 'DEGRADED',
    timestamp: new Date().toISOString(),
    checks,
  });
});

// ─── API Routes ──────────────────────────────────────────────
app.use('/auth', authRoutes);
app.use('/api-keys', apiKeyRoutes);
app.use('/setup', setupRoutes);
// Invitation public token routes — mounted only under /admin/invitations (no global /admin middleware).
app.use('/admin/canteen', canteenRoutes);
app.use('/admin/invitations', invitationRoutes);
app.use('/admin', adminRoutes);
app.use('/teacher', teacherPortalRoutes);
app.use('/student', studentPortalRoutes);
app.use('/staff', staffPortalRoutes);
app.use('/chat', chatRoutes);
app.use('/me', meRouter);
app.use('/branches', branchAdminRoutes);

// ─── Upload routes (authenticated) ───────────────────────
app.use('/api', uploadRoutes);

// ─── 404 Handler ─────────────────────────────────────────────
app.use('*', (_req, res) => {
  res.status(404).json({ success: false, message: 'Route not found' });
});

// ─── GLOBAL ERROR HANDLER (must be last) ──────────────────
app.use(errorHandler);

export default app;
