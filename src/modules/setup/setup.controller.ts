import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import env from '../../config/env';

const prisma = new PrismaClient();

const asyncHandler = (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };

/**
 * GET /setup/status
 *
 * Returns whether the system has been bootstrapped (any user exists).
 * Used by the key-manager to decide: show setup screen or login screen.
 */
export const status = asyncHandler(async (_req: Request, res: Response) => {
  const userCount = await prisma.user.count();
  res.json({
    success: true,
    initialized: userCount > 0,
  });
});

/**
 * POST /setup/init
 *
 * One-time bootstrap — creates the first CEO user and initial API keys.
 * Returns a JWT token so the key-manager can auto-login after setup.
 * Rejected with 409 if any user already exists in the system.
 *
 * Body:
 *   username: string    — login username
 *   name: string        — display name
 *   email: string       — login identifier (also used)
 *   password: string    — min 8 chars
 *   confirmPassword: string — must match password
 */
export const init = asyncHandler(async (req: Request, res: Response) => {
  // ── 1. Guard: system must not already be bootstrapped ──
  const existingUserCount = await prisma.user.count();
  if (existingUserCount > 0) {
    res.status(409).json({
      success: false,
      message: 'System already initialized. A CEO user already exists.',
    });
    return;
  }

  // ── 2. Validate input ──
  const { username, name, email, password, confirmPassword } = req.body;

  if (!username?.trim()) {
    res.status(400).json({ success: false, message: 'Username is required' });
    return;
  }
  if (!name?.trim()) {
    res.status(400).json({ success: false, message: 'Name is required' });
    return;
  }
  if (!email?.trim()) {
    res.status(400).json({ success: false, message: 'Email is required' });
    return;
  }
  if (!password || password.length < 8) {
    res.status(400).json({ success: false, message: 'Password must be at least 8 characters' });
    return;
  }
  if (password !== confirmPassword) {
    res.status(400).json({ success: false, message: 'Passwords do not match' });
    return;
  }

  // ── 3. Check uniqueness ──
  const existing = await prisma.user.findFirst({
    where: {
      OR: [
        { username: username.trim().toLowerCase() },
        { email: email.trim().toLowerCase() },
      ],
    },
  });
  if (existing) {
    const field = existing.username === username.trim().toLowerCase() ? 'Username' : 'Email';
    res.status(409).json({ success: false, message: field + ' already taken' });
    return;
  }

  // ── 4. Create CEO user ──
  const passwordHash = await bcrypt.hash(password, 12);

  const user = await prisma.user.create({
    data: {
      name: name.trim(),
      username: username.trim().toLowerCase(),
      email: email.trim().toLowerCase(),
      passwordHash,
      role: 'super_admin',
      status: 'active',
    },
  });

  // ── 5. Helper to generate key strings ──
  const generateKey = (type: 'publishable' | 'secret'): string => {
    const prefix = type === 'publishable' ? 'pk_mcs_' : 'sk_mcs_';
    return `${prefix}global_${crypto.randomBytes(32).toString('hex')}`;
  };

  const generatePrefix = (type: 'publishable' | 'secret'): string => {
    const prefix = type === 'publishable' ? 'pk_mcs_' : 'sk_mcs_';
    const shortHash = crypto.randomBytes(4).toString('hex').substring(0, 4);
    return `${prefix}global_${shortHash}`;
  };

  // ── 6. Create publishable API key ──
  const pubPlaintext = generateKey('publishable');
  const pubPrefix = generatePrefix('publishable');
  const pubKeyHash = await bcrypt.hash(pubPlaintext, 12);

  await prisma.apiKey.create({
    data: {
      name: 'Default Publishable Key (global)',
      type: 'publishable',
      keyHash: pubKeyHash,
      prefix: pubPrefix,
      createdBy: user.id,
    },
  });

  // ── 7. Create secret API key ──
  const secPlaintext = generateKey('secret');
  const secPrefix = generatePrefix('secret');
  const secKeyHash = await bcrypt.hash(secPlaintext, 12);

  await prisma.apiKey.create({
    data: {
      name: 'Default Secret Key (global)',
      type: 'secret',
      keyHash: secKeyHash,
      prefix: secPrefix,
      createdBy: user.id,
    },
  });

  // ── 8. Generate JWT token for auto-login ──
  const token = jwt.sign(
    { id: user.id, role: user.role, name: user.name },
    env.JWT_SECRET,
    { expiresIn: env.JWT_EXPIRY as any, issuer: 'school-erp' } as any,
  );

  // ── 9. Return credentials, keys, and login token ──
  res.status(201).json({
    success: true,
    message: 'System initialized successfully',
    token,
    user: {
      id: user.id,
      name: user.name,
      username: user.username,
      email: user.email,
      role: user.role,
    },
    apiKeys: {
      publishable: pubPlaintext,
      secret: secPlaintext,
    },
    warnings: [
      'Save the API keys now — they will never be shown again.',
      'The secret key (sk_mcs_*) must never be exposed to browsers.',
    ],
  });
});
