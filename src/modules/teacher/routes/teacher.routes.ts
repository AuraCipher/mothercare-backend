import { Router, Request, Response, NextFunction } from 'express';
import auth from '../../../middleware/auth/auth.middleware';
import { teacherRoleMiddleware } from '../middleware/teacher-role.middleware';
import { teacherActiveMiddleware } from '../middleware/teacher-active.middleware';
import {
  teacherScopeMiddleware,
  teacherReadOnlyGuard,
} from '../middleware/teacher-scope.middleware';
import { buildBootstrapResponse } from '../services/teacher-bootstrap.service';
import type { TeacherContext } from '../services/teacher-context.service';
import { prisma } from '../../../lib/prisma';

const router = Router();

const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };

router.use(auth);
router.use(teacherRoleMiddleware);
router.use(teacherActiveMiddleware);

/**
 * GET /teacher/bootstrap?branchId=&academicYearId=
 * Portal shell data: user, AY, branch, assignments, read-only flags.
 */
router.get(
  '/bootstrap',
  teacherScopeMiddleware,
  asyncHandler(async (req, res) => {
    const ctx = (req as any).teacherContext as TeacherContext;
    const user = (req as any).teacherUser;

    const profile = await prisma.teacherProfile.findUnique({
      where: { userId: user.id },
      select: { id: true, employeeId: true },
    });

    const payload = buildBootstrapResponse(ctx, {
      id: user.id,
      name: user.name,
      email: user.email,
      username: user.username,
      role: user.role,
      profilePhotoId: user.profilePhotoId,
    });
    payload.teacherProfile.employeeId = profile?.employeeId ?? null;

    res.json({ success: true, data: payload });
  }),
);

/** Future write routes mount after scope + read-only guard. */
router.use(teacherScopeMiddleware);
router.use(teacherReadOnlyGuard);

export default router;
