import { Router } from 'express';
import { status, init } from './setup.controller';

const router = Router();

// Public — no auth required (no users exist yet)
router.get('/status', status);
router.post('/init', init);

export default router;
