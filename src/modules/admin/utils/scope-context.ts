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

export async function resolveAcademicYearId(explicitId?: string | null, branchId?: string | null): Promise<string | null> {
  if (explicitId) return explicitId;

  // The fallback MUST stay inside the caller's branch. A global "newest ACTIVE
  // year" lookup returns a year from a DIFFERENT branch, and the scope check
  // below then rejects the request with 400 — which the list pages swallow,
  // leaving an empty list with no error. Prefer the branch's ACTIVE year, and
  // fall back to its most recent year so a branch without an ACTIVE year still
  // resolves inside itself instead of leaking to another branch.
  if (branchId) {
    const active = await prisma.academicYear.findFirst({
      where: { status: 'ACTIVE', branchId },
      select: { id: true },
      orderBy: { createdAt: 'desc' },
    });
    if (active) return active.id;
    const newest = await prisma.academicYear.findFirst({
      where: { branchId },
      select: { id: true },
      orderBy: { createdAt: 'desc' },
    });
    return newest?.id ?? null;
  }

  // No branch known: fall back to the globally newest ACTIVE year (only
  // reachable when the caller has no branch access at all, e.g. super_admin).
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
  const explicitBranchId = extractBranchId(req);

  // When the request does not name a branch, scope the academic-year lookup to
  // a branch the caller actually belongs to. Otherwise the year resolves
  // globally, lands on another branch, and the request fails the check below.
  const userBranchIds = (req as any).user?.branchIds;
  const branchHint = explicitBranchId
    || (Array.isArray(userBranchIds) && userBranchIds.length ? userBranchIds[0] : undefined);

  const academicYearId = await resolveAcademicYearId(extractAcademicYearId(req), branchHint);
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
