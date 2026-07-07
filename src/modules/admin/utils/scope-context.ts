import { Request, Response } from 'express';
import { prisma } from '../../../lib/prisma';
import { staffService } from '../services/staff.service';
import { canAccessArchivedAy } from './ay-access';

export interface ScopeContext {
  academicYearId: string;
  branchId: string;
  academicYearStatus: string;
  isArchived: boolean;
}

export async function resolveAcademicYearId(explicitId?: string | null): Promise<string | null> {
  if (explicitId) return explicitId;
  const active = await prisma.academicYear.findFirst({
    where: { status: 'ACTIVE' },
    select: { id: true },
    orderBy: { createdAt: 'desc' },
  });
  return active?.id ?? null;
}

function extractBranchId(req: Request): string | undefined {
  return (
    (req.query.branchId as string) ||
    req.body?.branchId ||
    req.params.branchId ||
    undefined
  );
}

function extractAcademicYearId(req: Request): string | undefined {
  return (
    (req.query.academicYearId as string) ||
    req.body?.academicYearId ||
    req.params.ayId ||
    req.params.academicYearId ||
    undefined
  );
}

function assertBranchAccess(req: Request, branchId: string): { status: number; message: string } | null {
  const user = (req as any).user;
  if (user?.branchIds && user.role !== 'super_admin' && !user.branchIds.includes(branchId)) {
    return { status: 403, message: 'Access denied: you do not have access to this branch' };
  }
  return null;
}

/** Resolve branch + academic year, validate AY belongs to branch and user has branch access. */
export async function resolveScopeContext(req: Request): Promise<ScopeContext | { error: { status: number; message: string } }> {
  const academicYearId = await resolveAcademicYearId(extractAcademicYearId(req));
  if (!academicYearId) {
    return { error: { status: 400, message: 'No academic year specified' } };
  }

  const ay = await prisma.academicYear.findUnique({
    where: { id: academicYearId },
    select: { id: true, branchId: true, status: true },
  });
  if (!ay) {
    return { error: { status: 404, message: 'Academic year not found' } };
  }

  const explicitBranchId = extractBranchId(req);
  const branchId = explicitBranchId || ay.branchId;

  if (explicitBranchId && explicitBranchId !== ay.branchId) {
    return { error: { status: 400, message: 'academicYearId does not belong to the specified branch' } };
  }

  const accessErr = assertBranchAccess(req, branchId);
  if (accessErr) return { error: accessErr };

  const user = (req as any).user;
  if (ay.status === 'ARCHIVED' && user?.role === 'management') {
    const access = await staffService.resolveUserAccess(user.id, branchId, user.role);
    if (access.isRestricted && !access.isFullAdmin && !canAccessArchivedAy(access.permissions)) {
      return { error: { status: 403, message: 'No permission to access archived academic years' } };
    }
  }

  return {
    academicYearId,
    branchId,
    academicYearStatus: ay.status,
    isArchived: ay.status === 'ARCHIVED',
  };
}

export async function requireScope(req: Request, res: Response): Promise<ScopeContext | null> {
  const result = await resolveScopeContext(req);
  if ('error' in result) {
    res.status(result.error.status).json({ success: false, message: result.error.message });
    return null;
  }
  return result;
}
