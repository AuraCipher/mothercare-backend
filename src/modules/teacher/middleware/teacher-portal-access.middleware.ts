import { Request, Response, NextFunction } from 'express';
import type { TeacherContext } from '../services/teacher-context.service';
import { TEACHER_PORTAL_ACCESS } from '../teacher.constants';

/** Block frozen teachers from operational routes; bootstrap remains available. */
export function teacherPortalAccessGuard(req: Request, res: Response, next: NextFunction) {
  const ctx = (req as any).teacherContext as TeacherContext | undefined;
  if (!ctx) return next();

  if (ctx.portalAccess === TEACHER_PORTAL_ACCESS.FROZEN) {
    return res.status(403).json({
      success: false,
      message: ctx.freezeReason || 'Teacher portal access is frozen. Contact school administration.',
    });
  }

  next();
}
