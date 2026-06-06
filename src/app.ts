import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import authRoutes from './modules/auth/auth.routes';
import apiKeyRoutes from './modules/api-key/api-key.routes';
import adminRoutes, { meRouter } from './modules/admin/admin.routes';
import errorHandler from './middleware/errorHandler';
import requestLogger from './middlewares/requestLogger';
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
          styleSrc: ["'self'", "'unsafe-inline'"],
          connectSrc: ["'self'"],
        },
      },
    })(req, res, next);
  }
  return helmet()(req, res, next);
});
app.use(cors({
  origin: env.ALLOWED_ORIGINS?.split(',').map(o => o.trim()) || [],
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key', 'x-publishable-api-key'],
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ─── Request / Response Logger (development only) ──────────────
app.use(requestLogger);

// ─── Admin HTML Page (served from src/admin/) ────────────────
// Resolve relative to this file so it works in both dev (src/) and
// production (dist/) — the HTML lives in src/admin/ and is NOT
// compiled by tsc, so we always step up one level from __dirname.
const adminHtmlPath = path.resolve(__dirname, '..', 'src', 'admin', 'index.html');
app.get('/key-manager', (_req, res) => {
  fs.readFile(adminHtmlPath, 'utf8', (err, data) => {
    if (err) {
      console.error('[key-manager] Failed to read HTML:', adminHtmlPath, err.message);
      return res.status(500).send('Failed to load key manager page');
    }

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.send(data);
  });
});

// ─── Public Routes ─────────────────────────────────────────────
app.get('/', (_req, res) => {
  res.json({
    name: 'Mother Care School',
    version: '1.0.0',
    endpoints: {
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
app.use('/admin', adminRoutes);
app.use('/me', meRouter);

// ─── 404 Handler ─────────────────────────────────────────────
app.use('*', (_req, res) => {
  res.status(404).json({ success: false, message: 'Route not found' });
});

// ─── GLOBAL ERROR HANDLER (must be last) ──────────────────
app.use(errorHandler);

export default app;
