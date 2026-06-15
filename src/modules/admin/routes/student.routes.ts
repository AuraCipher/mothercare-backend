import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../../../lib/prisma';
import { studentService } from '../services/student.service';

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
  const student = await studentService.create(req.body);
  res.status(201).json({ success: true, data: student });
}));

// PUT /students/:id — Update
router.put('/students/:id', asyncHandler(async (req: Request, res: Response) => {
  const student = await studentService.update(req.params.id, req.body);
  res.json({ success: true, data: student });
}));

// DELETE /students/:id — Soft delete (deactivate)
router.delete('/students/:id', asyncHandler(async (req: Request, res: Response) => {
  const student = await studentService.deactivate(req.params.id);
  res.json({ success: true, message: 'Student deactivated', data: student });
}));

// POST /students/:id/emergency-contact — Add emergency contact
router.post('/students/:id/emergency-contact', asyncHandler(async (req: Request, res: Response) => {
  const contact = await studentService.addEmergencyContact(req.params.id, req.body);
  res.status(201).json({ success: true, data: contact });
}));

// DELETE /students/:id/emergency-contact/:contactId
router.delete('/students/:id/emergency-contact/:contactId', asyncHandler(async (req: Request, res: Response) => {
  await studentService.deleteEmergencyContact(req.params.contactId);
  res.json({ success: true });
}));

// PUT /students/:id/health-record — Upsert health record
router.put('/students/:id/health-record', asyncHandler(async (req: Request, res: Response) => {
  const record = await studentService.upsertHealthRecord(req.params.id, req.body);
  res.json({ success: true, data: record });
}));

// POST /students/:id/parents — Link parent
router.post('/students/:id/parents', asyncHandler(async (req: Request, res: Response) => {
  const { parentUserId, relation, isPrimary } = req.body;
  const link = await studentService.linkParent(req.params.id, parentUserId, relation, isPrimary);
  res.status(201).json({ success: true, data: link });
}));

// PUT /students/:id/parent — Update linked parent's profile
router.put('/students/:id/parent', asyncHandler(async (req: Request, res: Response) => {
  const student = await prisma.student.findUnique({ where: { id: req.params.id }, select: { id: true } });
  if (!student) { res.status(404).json({ success: false, message: 'Student not found' }); return; }
  const link = await prisma.studentParent.findFirst({ where: { studentId: req.params.id }, select: { parentId: true } });
  if (!link) { res.status(404).json({ success: false, message: 'No parent linked' }); return; }
  const updated = await prisma.parentProfile.update({
    where: { id: link.parentId },
    data: req.body,
  });
  res.json({ success: true, data: updated });
}));

// DELETE /students/:id/parents/:parentUserId — Unlink parent
router.delete('/students/:id/parents/:parentUserId', asyncHandler(async (req: Request, res: Response) => {
  await studentService.unlinkParent(req.params.id, req.params.parentUserId);
  res.json({ success: true });
}));

export default router;
