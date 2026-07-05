import { Router } from 'express';
import { login, getMe, changePassword, logout, refresh } from './auth.controller';
import auth from '../../middleware/auth/auth.middleware';
import { validate } from '../../middleware/validation/validate.middleware';
import {
  loginSchema,
  changePasswordSchema,
} from './auth.schema';

const router = Router();

// Public routes
router.post('/login', validate(loginSchema), login);

// Protected routes
router.post('/refresh', auth, refresh);
router.get('/me', auth, getMe);
router.put('/password', auth, validate(changePasswordSchema), changePassword);
router.post('/logout', auth, logout);

export default router;