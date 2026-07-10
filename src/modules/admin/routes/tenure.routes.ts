import { Router, Request, Response, NextFunction } from 'express';
import { TenureEndReason } from '@prisma/client';
import { tenureService } from '../services/tenure.service';
import { prisma } from '../../../lib/prisma';
import { requireScope } from '../utils/scope-context';

const router = Router();

const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };

function parseEndReason(value: unknown): TenureEndReason | null {
  if (typeof value !== 'string') return null;
  return (Object.values(TenureEndReason) as string[]).includes(value)
    ? (value as TenureEndReason)
    : null;
}

router.get('/branch-members/:branchMemberId/tenures', asyncHandler(async (req: Request, res: Response) => {
  const data = await tenureService.listBranchTenures(req.params.branchMemberId);
  res.json({ success: true, data });
}));

router.post('/branch-members/:branchMemberId/tenures/join', asyncHandler(async (req: Request, res: Response) => {
  const { joinedAt, previousTenureId } = req.body;
  const data = await tenureService.recordBranchJoin(
    req.params.branchMemberId,
    joinedAt ? new Date(joinedAt) : new Date(),
    (req as any).user?.id,
    previousTenureId,
  );
  res.status(201).json({ success: true, data });
}));

router.post('/branch-members/:branchMemberId/tenures/leave', asyncHandler(async (req: Request, res: Response) => {
  const { leftAt, endReason, notes } = req.body;
  const parsedReason = parseEndReason(endReason);
  if (!parsedReason) {
    res.status(400).json({ success: false, message: 'Valid endReason is required' });
    return;
  }
  const data = await tenureService.recordBranchLeave(
    req.params.branchMemberId,
    leftAt ? new Date(leftAt) : new Date(),
    parsedReason,
    notes,
  );
  res.json({ success: true, data });
}));

router.get('/students/:studentId/school-tenures', asyncHandler(async (req: Request, res: Response) => {
  const student = await prisma.student.findUnique({
    where: { id: req.params.studentId },
    select: { personId: true },
  });
  if (!student?.personId) {
    res.status(404).json({ success: false, message: 'Student person record not found' });
    return;
  }
  const data = await tenureService.listStudentSchoolTenures(student.personId);
  res.json({ success: true, data });
}));

router.post('/students/:studentId/school-tenures/join', asyncHandler(async (req: Request, res: Response) => {
  const scope = await requireScope(req, res);
  if (!scope) return;
  const student = await prisma.student.findUnique({
    where: { id: req.params.studentId },
    select: { personId: true },
  });
  if (!student?.personId) {
    res.status(404).json({ success: false, message: 'Student person record not found' });
    return;
  }
  const data = await tenureService.recordStudentJoin(
    student.personId,
    scope.branchId,
    req.body.joinedAt ? new Date(req.body.joinedAt) : new Date(),
    (req as any).user?.id,
  );
  res.status(201).json({ success: true, data });
}));

router.post('/students/:studentId/school-tenures/leave', asyncHandler(async (req: Request, res: Response) => {
  const student = await prisma.student.findUnique({
    where: { id: req.params.studentId },
    select: { personId: true },
  });
  if (!student?.personId) {
    res.status(404).json({ success: false, message: 'Student person record not found' });
    return;
  }
  const { leftAt, endReason, notes } = req.body;
  const parsedReason = parseEndReason(endReason);
  if (!parsedReason) {
    res.status(400).json({ success: false, message: 'Valid endReason is required' });
    return;
  }
  const data = await tenureService.recordStudentLeave(
    student.personId,
    leftAt ? new Date(leftAt) : new Date(),
    parsedReason,
    notes,
  );
  res.json({ success: true, data });
}));

router.post('/students/:studentId/class-movements', asyncHandler(async (req: Request, res: Response) => {
  const scope = await requireScope(req, res);
  if (!scope) return;
  const student = await prisma.student.findUnique({
    where: { id: req.params.studentId },
    select: { groupId: true },
  });
  if (!student) {
    res.status(404).json({ success: false, message: 'Student not found' });
    return;
  }
  const { toGroupId, effectiveAt, reason } = req.body;
  if (!toGroupId) {
    res.status(400).json({ success: false, message: 'toGroupId is required' });
    return;
  }
  const data = await tenureService.recordClassMovement({
    studentId: req.params.studentId,
    academicYearId: scope.academicYearId,
    fromGroupId: student.groupId,
    toGroupId,
    effectiveAt: effectiveAt ? new Date(effectiveAt) : new Date(),
    reason,
    createdById: (req as any).user?.id,
  });
  res.status(201).json({ success: true, data });
}));

async function resolveBranchMemberByUser(branchId: string, userId: string) {
  return prisma.branchMember.findUnique({
    where: { branchId_userId: { branchId, userId } },
    select: { id: true },
  });
}

router.get('/teachers/:userId/tenures', asyncHandler(async (req: Request, res: Response) => {
  const scope = await requireScope(req, res);
  if (!scope) return;
  const member = await resolveBranchMemberByUser(scope.branchId, req.params.userId);
  if (!member) {
    res.status(404).json({ success: false, message: 'Teacher is not assigned to this branch' });
    return;
  }
  const data = await tenureService.listBranchTenures(member.id);
  res.json({ success: true, data });
}));

router.post('/teachers/:userId/tenures/join', asyncHandler(async (req: Request, res: Response) => {
  const scope = await requireScope(req, res);
  if (!scope) return;
  const member = await resolveBranchMemberByUser(scope.branchId, req.params.userId);
  if (!member) {
    res.status(404).json({ success: false, message: 'Teacher is not assigned to this branch' });
    return;
  }
  const data = await tenureService.recordBranchJoin(
    member.id,
    req.body.joinedAt ? new Date(req.body.joinedAt) : new Date(),
    (req as any).user?.id,
    req.body.previousTenureId,
  );
  res.status(201).json({ success: true, data });
}));

router.post('/teachers/:userId/tenures/leave', asyncHandler(async (req: Request, res: Response) => {
  const scope = await requireScope(req, res);
  if (!scope) return;
  const member = await resolveBranchMemberByUser(scope.branchId, req.params.userId);
  if (!member) {
    res.status(404).json({ success: false, message: 'Teacher is not assigned to this branch' });
    return;
  }
  const parsedReason = parseEndReason(req.body.endReason);
  if (!parsedReason) {
    res.status(400).json({ success: false, message: 'Valid endReason is required' });
    return;
  }
  const data = await tenureService.recordBranchLeave(
    member.id,
    req.body.leftAt ? new Date(req.body.leftAt) : new Date(),
    parsedReason,
    req.body.notes,
  );
  res.json({ success: true, data });
}));

export default router;
