import { Request, Response, NextFunction } from 'express';

export const roleMiddleware = (allowedRoles: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    // @ts-ignore: req.user is set by auth middleware
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthenticated'
      });
    }

    // @ts-ignore: req.user.role is set by auth middleware
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Access denied. Allowed roles: ${allowedRoles.join(', ')}`
      });
    }
    next();
  };
};