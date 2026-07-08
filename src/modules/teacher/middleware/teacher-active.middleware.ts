import { Request, Response, NextFunction } from 'express';
import { prisma } from '../../../lib/prisma';

/**
 * Re-validates user + branch membership on every request (JWT alone is not enough).
 * Sets req.teacherUser and req.teacherBranchMember when branchId is in query/body.
 */
export async function teacherActiveMiddleware(
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
    if (user.role !== 'teacher') {
      return res.status(403).json({ success: false, message: 'Access denied: teacher portal only' });
    }

    const profile = await prisma.teacherProfile.findUnique({
      where: { userId: user.id },
      select: { id: true, employeeId: true },
    });
    if (!profile) {
      return res.status(403).json({
        success: false,
        message: 'Teacher profile not found. Contact school administration.',
      });
    }

    (req as any).teacherUser = user;
    (req as any).teacherProfileId = profile.id;

    const branchId =
      (req.query.branchId as string) ||
      req.body?.branchId ||
      req.params.branchId;

    if (branchId) {
      if (jwtUser.branchIds && !jwtUser.branchIds.includes(branchId)) {
        return res.status(403).json({
          success: false,
          message: 'Access denied: you do not have access to this branch',
        });
      }

      const membership = await prisma.branchMember.findUnique({
        where: { branchId_userId: { branchId, userId: user.id } },
        select: { id: true, branchId: true, role: true, isActive: true },
      });

      if (!membership?.isActive || membership.role !== 'teacher') {
        return res.status(403).json({
          success: false,
          message: 'You are not an active teacher at this branch',
        });
      }

      (req as any).teacherBranchMember = membership;
    }

    next();
  } catch (err) {
    next(err);
  }
}
