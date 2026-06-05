import { Request, Response, NextFunction } from 'express';
import { verifyToken, isBlacklisted } from '../lib/jwt';
import apiKeyService from '../modules/api-key/api-key.service';

export default async function authMiddleware(req: Request, _res: Response, next: NextFunction) {
  // ─── 1. Try JWT Bearer ────────────────────────────────────────
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    try {
      if (await isBlacklisted(token)) {
        return next({ status: 401, message: 'Token has been revoked' });
      }
      const payload = verifyToken(token) as any;
      (req as any).user = payload;
      (req as any).token = token;
      (req as any).apiKey = null; // not an API key auth
      return next();
    } catch (err: any) {
      if (err.name === 'TokenExpiredError') {
        return next({ status: 401, message: 'Token expired' });
      }
      // fall through to try API key auth
    }
  }

  // ─── 2. Try x-publishable-api-key (public /store routes) ───────
  const pubKey = req.headers['x-publishable-api-key'] as string;
  if (pubKey) {
    const result = await apiKeyService.verifyByKey(pubKey);
    if (result && result.type === 'publishable') {
      (req as any).apiKey = result;
      (req as any).user = { role: 'super_admin', id: result.id, name: 'API Key' }; // grant access
      return next();
    }
    return next({ status: 401, message: 'Invalid or revoked publishable API key' });
  }

  // ─── 3. Try standard x-api-key (legacy / fallback) ─────────────-
  const apiKey = req.headers['x-api-key'] as string;
  if (apiKey) {
    const result = await apiKeyService.verifyByKey(apiKey);
    if (result) {
      (req as any).apiKey = result;
      (req as any).user = { role: 'super_admin', id: result.id, name: 'API Key' };
      return next();
    }
    return next({ status: 401, message: 'Invalid or revoked API key' });
  }

  next({ status: 401, message: 'Authentication required' });
}
