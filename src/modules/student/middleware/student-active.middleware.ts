import { Request, Response, NextFunction } from 'express';
import { prisma } from '../../../lib/prisma';

/**
 * Re-validates student user on every request.
 * Sets req.studentUser when the account is active.
 */
export async function studentActiveMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const jwtUser = (req as any).user;
    if (!jwtUser?.id) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    const user = await prisma.user.findUnique({
      where: { id: jwtUser.id },
      select: {
        id: true,
        name: true,
        email: true,
        username: true,
        role: true,
        status: true,
        profilePhotoId: true,
      },
    });

    if (!user) {
      return res.status(401).json({ success: false, message: 'User not found' });
    }
    if (user.status !== 'active') {
      return res.status(403).json({
        success: false,
        message: 'Account is not active. Contact school administration.',
      });
    }
    if (user.role !== 'student') {
      return res.status(403).json({ success: false, message: 'Access denied: student portal only' });
    }

    (req as any).studentUser = user;
    next();
  } catch (err) {
    next(err);
  }
}
