import { z } from 'zod';

const phoneRegex = /^(\+92|0|92)[0-9]{10}$/;

export const loginSchema = z.object({
  identifier: z.string().min(1, 'Username, email, or phone is required'),
  password: z.string().min(1, 'Password is required'),
  rememberMe: z.boolean().default(false),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(6),
  newPassword: z.string().min(8, 'New password must be at least 8 characters')
    .regex(/[A-Z]/, 'Must contain an uppercase letter')
    .regex(/[0-9]/, 'Must contain a number'),
  confirmPassword: z.string(),
}).refine((data) => data.newPassword === data.confirmPassword, {
  message: 'Passwords do not match',
  path: ['confirmPassword'],
});

export const forgotPasswordSchema = z.object({
  phone: z.string().regex(phoneRegex, 'Enter a valid phone number'),
});

export const verifyOtpSchema = z.object({
  phone: z.string().regex(phoneRegex),
  otp: z.string().length(6, 'OTP must be 6 digits').regex(/^\d+$/),
});

export const resetPasswordSchema = z.object({
  resetToken: z.string().min(10),
  newPassword: z.string().min(8)
    .regex(/[A-Z]/, 'Must contain uppercase')
    .regex(/[0-9]/, 'Must contain a number'),
});