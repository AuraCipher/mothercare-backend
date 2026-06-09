import { Router } from 'express';
import { login, getMe, changePassword, forgotPassword, verifyOTP, resetPassword, logout, refresh } from './auth.controller';
import auth from '../../middleware/auth.middleware';
import { validate } from '../../middleware/validate.middleware';
import {
  loginSchema,
  changePasswordSchema,
  forgotPasswordSchema,
  verifyOtpSchema,
  resetPasswordSchema,
} from './auth.schema';

const router = Router();

// Public routes
router.post('/login', validate(loginSchema), login);
router.post('/forgot-password', validate(forgotPasswordSchema), forgotPassword);
router.post('/verify-otp', validate(verifyOtpSchema), verifyOTP);
router.post('/reset-password', validate(resetPasswordSchema), resetPassword);

// Protected routes
router.post('/refresh', auth, refresh);
router.get('/me', auth, getMe);
router.put('/password', auth, validate(changePasswordSchema), changePassword);
router.post('/logout', auth, logout);

export default router;