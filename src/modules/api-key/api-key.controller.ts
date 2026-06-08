import { Request, Response } from 'express';
import { ApiKeyType } from '@prisma/client';
import apiKeyService from './api-key.service';

const asyncHandler =
  (fn: (req: Request, res: Response) => Promise<any>) =>
  (req: Request, res: Response) => {
    Promise.resolve(fn(req, res)).catch((err) => {
      console.error(err);
      res.status(err.status || 500).json({ success: false, message: err.message || 'Internal server error' });
    });
  };

export const createApiKey = asyncHandler(async (req, res) => {
  const { name, type, branchCode, branchId } = req.body;
  // @ts-ignore
  const createdBy = req.user?.id || 'system';
  const result = await apiKeyService.createApiKey(
    name,
    (type as ApiKeyType) || 'publishable',
    createdBy,
    branchCode || undefined,
    branchId || undefined,
  );
  res.status(201).json({ success: true, ...result });
});

export const listApiKeys = asyncHandler(async (_req, res) => {
  const keys = await apiKeyService.listApiKeys();
  res.status(200).json({ success: true, data: keys });
});

export const revokeApiKey = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const result = await apiKeyService.revokeApiKey(id);
  res.status(200).json({ success: true, ...result });
});
