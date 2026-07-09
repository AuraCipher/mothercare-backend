import { Request, Response, NextFunction } from 'express';
import { STUDENT_PORTAL_ROLES } from '../student.constants';

/** Restrict route to global role=student (JWT). */
export function studentRoleMiddleware(req: Request, res: Response, next: NextFunction) {
  const user = (req as any).user;
  if (!user?.id) {
    return res.status(401).json({ success: false, message: 'Authentication required' });
  }
  if (!STUDENT_PORTAL_ROLES.includes(user.role)) {
    return res.status(403).json({
      success: false,
      message: 'Access denied: student portal only',
    });
  }
  next();
}
