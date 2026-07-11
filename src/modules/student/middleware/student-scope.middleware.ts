import { Request, Response, NextFunction } from 'express';
import { prisma } from '../../../lib/prisma';
import type { StudentContext } from '../services/student-context.service';

function extractAcademicYearId(req: Request): string | undefined {
  return (
    (req.query.academicYearId as string) ||
    req.body?.academicYearId ||
    req.params.ayId ||
    req.params.academicYearId ||
    undefined
  );
}

function formatGroupLabel(group: { name: string; section: string | null }) {
  return group.section ? `${group.name} — ${group.section}` : group.name;
}

/**
 * Resolves the logged-in student's enrollment for the scoped academic year.
 */
export async function studentScopeMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const userId = (req as any).studentUser?.id || (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    const requestedAyId = extractAcademicYearId(req);

    const student = requestedAyId
      ? await prisma.student.findFirst({
          where: {
            userId,
            academicYearId: requestedAyId,
            isActive: true,
            status: 'ACTIVE',
            credentialTag: { not: 'NO_LOGIN' },
          },
          include: {
            group: { select: { id: true, name: true, section: true } },
            academicYear: {
              select: {
                id: true,
                branchId: true,
                status: true,
                calendar: { select: { label: true } },
                branch: { select: { id: true, name: true, code: true } },
              },
            },
          },
        })
      : await prisma.student.findFirst({
          where: {
            userId,
            isActive: true,
            status: 'ACTIVE',
            credentialTag: { not: 'NO_LOGIN' },
            academicYear: { status: 'ACTIVE' },
          },
          include: {
            group: { select: { id: true, name: true, section: true } },
            academicYear: {
              select: {
                id: true,
                branchId: true,
                status: true,
                calendar: { select: { label: true } },
                branch: { select: { id: true, name: true, code: true } },
              },
            },
          },
          orderBy: { createdAt: 'desc' },
        });

    if (!student) {
      return res.status(403).json({
        success: false,
        message: 'Student is not enrolled in the selected academic year',
      });
    }

    const ay = student.academicYear;
    const explicitBranchId =
      (req.query.branchId as string) || req.body?.branchId || req.params.branchId;
    if (explicitBranchId && explicitBranchId !== ay.branchId) {
      return res.status(400).json({
        success: false,
        message: 'academicYearId does not belong to the specified branch',
      });
    }

    const ctx: StudentContext = {
      userId,
      studentId: student.id,
      studentName: student.name,
      rollNumber: student.rollNumber,
      branchId: ay.branchId,
      academicYearId: ay.id,
      academicYearStatus: ay.status,
      academicYearLabel: ay.calendar?.label || ay.id,
      groupId: student.group?.id ?? null,
      groupLabel: student.group ? formatGroupLabel(student.group) : null,
      branch: ay.branch,
    };

    (req as any).studentContext = ctx;
    next();
  } catch (err) {
    next(err);
  }
}

/** Student portal is read-only — block mutating methods except chat DMs. */
export function studentReadOnlyGuard(req: Request, res: Response, next: NextFunction) {
  const method = req.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    return next();
  }
  if (method === 'POST' && (req.path === '/chat/dm' || req.path.endsWith('/chat/dm'))) {
    return next();
  }
  return res.status(405).json({
    success: false,
    message: 'Student portal is read-only',
  });
}

export function getStudentContext(req: Request): StudentContext {
  const ctx = (req as any).studentContext as StudentContext | undefined;
  if (!ctx) {
    throw { status: 500, message: 'Student context not initialized' };
  }
  return ctx;
}
