import { Request, Response, NextFunction } from 'express';
import authService from './auth.service';
import {
  loginSchema,
  changePasswordSchema,
} from './auth.schema';

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict' as const,
  path: '/',
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
};

const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<any>) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

export const login = asyncHandler(async (req: Request, res: Response) => {
  const data = await authService.login(req.body);

  // Set httpOnly cookie (V3 — JWT inaccessible to JS, prevents XSS token theft)
  if (data.token) {
    res.cookie('token', data.token, COOKIE_OPTIONS);
  }

  res.status(200).json(data);
});

export const refresh = asyncHandler(async (req: Request, res: Response) => {
  // @ts-ignore: req.user is set by auth middleware
  const userId = req.user?.id;
  const data = await authService.refresh(userId);
  res.status(200).json(data);
});

export const getMe = asyncHandler(async (req: Request, res: Response) => {
  // @ts-ignore: req.user is set by auth middleware
  const user = await authService.getMe(req.user.id);
  res.status(200).json({ success: true, user });
});

export const changePassword = asyncHandler(async (req: Request, res: Response) => {
  const { currentPassword, newPassword } = req.body;
  // @ts-ignore: req.user is set by auth middleware
  const result = await authService.changePassword(req.user.id, currentPassword, newPassword);
  res.status(200).json(result);
});

export const logout = asyncHandler(async (req: Request, res: Response) => {
  // @ts-ignore: req.user is set by auth middleware
  const userId = req.user?.id;
  const result = await authService.logout(userId);

  // Clear httpOnly cookie
  res.clearCookie('token', { path: '/' });

  res.status(200).json(result);
});