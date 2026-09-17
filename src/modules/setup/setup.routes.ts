import { Router } from 'express';
import { status, init } from './setup.controller';

const router = Router();

// Public — no auth required (no users exist yet)
router.get('/status', status);

// In production, restrict setup init to localhost only
if (process.env.NODE_ENV === 'production') {
  router.post('/init', (req, res, next) => {
    const ip = req.ip || req.socket.remoteAddress || '';
    const isLocal = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
    if (!isLocal) {
      return res.status(403).json({ success: false, message: 'Setup is only available from localhost in production' });
    }
    next();
  }, init);
} else {
  router.post('/init', init);
}

export default router;
