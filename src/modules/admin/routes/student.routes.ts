import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../../../lib/prisma';
import { studentService } from '../services/student.service';
import { passwordSetLimiter } from '../../../middleware/security/rateLimiter';

const router = Router();
const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => { fn(req, res, next).catch(next); };

// GET /students — List with search, filter, pagination
router.get('/students', asyncHandler(async (req: Request, res: Response) => {
  const { search, groupId, academicYearId, rollNumber, page, limit } = req.query;
  const result = await studentService.findAll({
    search: search as string, groupId: groupId as string,
    academicYearId: academicYearId as string, rollNumber: rollNumber as string,
    page: page ? parseInt(page as string, 10) : 1,
    limit: limit ? parseInt(limit as string, 10) : 20,
  });
  res.json({ success: true, ...result });
}));

// GET /students/:id — Detail
router.get('/students/:id', asyncHandler(async (req: Request, res: Response) => {
  const student = await studentService.findById(req.params.id);
  res.json({ success: true, data: student });
}));

// POST /students — Create
router.post('/students', asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).user?.id;
  const student = await studentService.create({ ...req.body, createdById: userId });
  res.status(201).json({ success: true, data: student });
}));

// PUT /students/:id — Update
router.put('/students/:id', asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).user?.id;
  const student = await studentService.update(req.params.id, { ...req.body, updatedById: userId });
  res.json({ success: true, data: student });
}));

// DELETE /students/:id — Soft delete (deactivate)
router.delete('/students/:id', asyncHandler(async (req: Request, res: Response) => {
  const student = await studentService.deactivate(req.params.id);
  res.json({ success: true, message: 'Student deactivated', data: student });
}));

// POST /students/:id/emergency-contact — Add emergency contact
router.post('/students/:id/emergency-contact', asyncHandler(async (req: Request, res: Response) => {
  const contact = await studentService.addEmergencyContact(req.params.id, { ...req.body, createdById: (req as any).user?.id });
  res.status(201).json({ success: true, data: contact });
}));

// PUT /students/:id/emergency-contact/:contactId — Update emergency contact
router.put('/students/:id/emergency-contact/:contactId', asyncHandler(async (req: Request, res: Response) => {
  const updated = await prisma.emergencyContact.update({
    where: { id: req.params.contactId },
    data: { ...req.body, updatedById: (req as any).user?.id },
  });
  res.json({ success: true, data: updated });
}));

// DELETE /students/:id/emergency-contact/:contactId
router.delete('/students/:id/emergency-contact/:contactId', asyncHandler(async (req: Request, res: Response) => {
  await studentService.deleteEmergencyContact(req.params.contactId);
  res.json({ success: true });
}));

// PUT /students/:id/health-record — Upsert health record
router.put('/students/:id/health-record', asyncHandler(async (req: Request, res: Response) => {
  const record = await studentService.upsertHealthRecord(req.params.id, { ...req.body, updatedById: (req as any).user?.id });
  res.json({ success: true, data: record });
}));

// POST /students/:id/parents — Link parent
router.post('/students/:id/parents', asyncHandler(async (req: Request, res: Response) => {
  const { parentUserId, relation, isPrimary } = req.body;
  const link = await studentService.linkParent(req.params.id, parentUserId, relation, isPrimary, (req as any).user?.id);
  res.status(201).json({ success: true, data: link });
}));

// PUT /students/:id/parent — Create or update parent profile
router.put('/students/:id/parent', asyncHandler(async (req: Request, res: Response) => {
  const student = await prisma.student.findUnique({ where: { id: req.params.id }, select: { id: true } });
  if (!student) { res.status(404).json({ success: false, message: 'Student not found' }); return; }

  const link = await prisma.studentParent.findFirst({ where: { studentId: req.params.id }, select: { parentId: true } });
  const { name, ...parentData } = req.body;

  if (link) {
    // Update existing parent profile
    const updated = await prisma.parentProfile.update({
      where: { id: link.parentId },
      data: parentData,
    });
    res.json({ success: true, data: updated });
  } else if (name) {
    // Create new parent user + profile + link
    const baseUsername = `parent_${student.id.slice(0, 8)}`;
    const parentUser = await prisma.user.create({
      data: { name, username: baseUsername, passwordHash: '$2a$12$placeholder', role: 'parent', status: 'active' },
    }).catch(async () => {
      return prisma.user.create({
        data: { name, username: `${baseUsername}_${Math.random().toString(36).slice(2, 6)}`, passwordHash: '$2a$12$placeholder', role: 'parent', status: 'active' },
      });
    });
    const profile = await prisma.parentProfile.create({
      data: { userId: parentUser.id, ...parentData },
    });
    await prisma.studentParent.create({
      data: { studentId: req.params.id, parentId: profile.id, relation: parentData.relation || 'Guardian', isPrimary: true },
    });
    res.status(201).json({ success: true, data: profile });
  } else {
    res.status(400).json({ success: false, message: 'Parent name is required to create a new parent' });
  }
}));

// DELETE /students/:id/parents/:parentUserId — Unlink parent
router.delete('/students/:id/parents/:parentUserId', asyncHandler(async (req: Request, res: Response) => {
  await studentService.unlinkParent(req.params.id, req.params.parentUserId);
  res.json({ success: true });
}));

// PUT /students/:id/generate-credentials — Generate login credentials
router.put('/students/:id/generate-credentials', asyncHandler(async (req: Request, res: Response) => {
  const result = await studentService.generateCredentials(req.params.id);
  res.json({ success: true, data: result });
}));

// PUT /students/:id/set-password — Set student password (admin must verify)
router.put('/students/:id/set-password', passwordSetLimiter, asyncHandler(async (req: Request, res: Response) => {
  const { password, adminPassword } = req.body;
  const adminId = (req as any).user?.id;
  if (!password || !adminPassword) {
    res.status(400).json({ success: false, message: 'password and adminPassword are required' });
    return;
  }
  const result = await studentService.setPassword(req.params.id, password, adminId, adminPassword, req.ip);
  res.json({ success: true, message: result.message });
}));

export default router;
