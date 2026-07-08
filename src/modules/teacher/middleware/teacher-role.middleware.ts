import { Request, Response, NextFunction } from 'express';
import { TEACHER_PORTAL_ROLES } from '../teacher.constants';

/** Restrict route to global role=teacher (JWT). */
export function teacherRoleMiddleware(req: Request, res: Response, next: NextFunction) {
  const user = (req as any).user;
  if (!user?.id) {
    return res.status(401).json({ success: false, message: 'Authentication required' });
  }
  if (!TEACHER_PORTAL_ROLES.includes(user.role)) {
    return res.status(403).json({
      success: false,
      message: 'Access denied: teacher portal only',
    });
  }
  next();
}
