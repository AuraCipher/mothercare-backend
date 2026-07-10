import { Request, Response, NextFunction } from 'express';

const STAFF_ROLES = new Set(['super_admin', 'management', 'branch_admin', 'sub_admin', 'teacher', 'staff']);

export function staffRoleMiddleware(req: Request, res: Response, next: NextFunction) {
  const user = (req as any).user;
  if (!user) {
    res.status(401).json({ success: false, message: 'Authentication required' });
    return;
  }
  if (!STAFF_ROLES.has(user.role)) {
    res.status(403).json({ success: false, message: 'Staff portal access required' });
    return;
  }
  next();
}

export function staffAdminRoleMiddleware(req: Request, res: Response, next: NextFunction) {
  const user = (req as any).user;
  if (!user) {
    res.status(401).json({ success: false, message: 'Authentication required' });
    return;
  }
  const adminRoles = new Set(['super_admin', 'management', 'branch_admin', 'sub_admin']);
  if (!adminRoles.has(user.role)) {
    res.status(403).json({ success: false, message: 'Branch admin access required' });
    return;
  }
  next();
}
