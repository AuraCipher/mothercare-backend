import { Request, Response, NextFunction } from 'express';
import { verifyToken, isBlacklisted } from '../../lib/jwt';
import apiKeyService from '../../modules/api-key/api-key.service';
import { prisma } from '../../lib/prisma';

async function resolveTargetBranchCode(req: Request): Promise<string | undefined> {
  const branchId = req.params.branchId || req.params.id || (req.query?.branchId as string);
  if (!branchId) return undefined;
  try {
    const branch = await prisma.branch.findUnique({ where: { id: branchId }, select: { code: true } });
    return branch?.code;
  } catch {
    return undefined;
  }
}

export default async function authMiddleware(req: Request, _res: Response, next: NextFunction) {
  try {
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
        (req as any).apiKey = null;
        return next();
      } catch (err: any) {
        if (err.name === 'TokenExpiredError') {
          return next({ status: 401, message: 'Token expired' });
        }
        // Fall through to try API key auth
      }
    }

    // ─── 1.5. Try httpOnly cookie (V3) ─────────────────────────────
    const cookieToken = req.cookies?.token as string | undefined;
    if (cookieToken) {
      try {
        if (await isBlacklisted(cookieToken)) {
          return next({ status: 401, message: 'Token has been revoked' });
        }
        const payload = verifyToken(cookieToken) as any;
        (req as any).user = payload;
        (req as any).token = cookieToken;
        (req as any).apiKey = null;
        return next();
      } catch (err: any) {
        if (err.name === 'TokenExpiredError') {
          return next({ status: 401, message: 'Token expired' });
        }
        // Fall through to API key auth
      }
    }

    // ─── 2. Try API key auth (publishable or secret) ──────────────
    const targetBranchCode = await resolveTargetBranchCode(req);
    const pubKey = req.headers['x-publishable-api-key'] as string;
    const secKey = req.headers['x-api-key'] as string;
    const keyToVerify = pubKey || secKey;
    const isPublishable = !!pubKey;

    if (keyToVerify) {
      const result = await apiKeyService.verifyByKey(keyToVerify, targetBranchCode);
      if (result && (!isPublishable || result.type === 'publishable')) {
        (req as any).apiKey = result;
        (req as any).user = { role: 'super_admin', id: result.id, name: 'API Key' };
        return next();
      }
      return next({ status: 401, message: 'Invalid or revoked API key' });
    }

    next({ status: 401, message: 'Authentication required' });
  } catch (err) {
    next(err);
  }
}
