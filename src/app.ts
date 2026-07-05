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
import canteenRoutes from './modules/canteen/canteen.routes';
import errorHandler from './middleware/error/errorHandler';
import requestLogger from './middleware/logging/requestLogger';
import { auditContextMiddleware } from './middleware/auth/auditContext.middleware';
import env from './config/env';

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

// Fallback: ensure CORS headers on every response (ngrok sometimes strips them)
app.use((req, res, next) => {
  if (!res.getHeader('Access-Control-Allow-Origin')) {
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,PUT,PATCH,POST,DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,x-api-key,x-publishable-api-key');
  }
  next();
});

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// ─── Request / Response Logger (development only) ──────────────
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
      health: '/health',
      keyManager: '/key-manager',
    },
  });
});

app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'OK', timestamp: new Date().toISOString() });
});

// ─── API Routes ──────────────────────────────────────────────
app.use('/auth', authRoutes);
app.use('/api-keys', apiKeyRoutes);
app.use('/setup', setupRoutes);
app.use('/admin', adminRoutes);
app.use('/admin/canteen', canteenRoutes);
app.use('/admin', invitationRoutes);
app.use('/me', meRouter);
app.use('/branches', branchAdminRoutes);

// ─── Upload routes — GET (serving) is public for <img> tags, POST needs auth ──
app.use('/api', uploadRoutes);

// ─── Serve uploaded files statically ─────────────────────────
const uploadsDir = path.resolve(__dirname, '..', 'uploads');
app.use('/uploads', express.static(uploadsDir, { maxAge: '1y', immutable: true }));

// ─── 404 Handler ─────────────────────────────────────────────
app.use('*', (_req, res) => {
  res.status(404).json({ success: false, message: 'Route not found' });
});

// ─── GLOBAL ERROR HANDLER (must be last) ──────────────────
app.use(errorHandler);

export default app;
