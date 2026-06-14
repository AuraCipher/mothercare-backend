import { Router, Request, Response, NextFunction } from 'express';
import { timetableService, timetableSlotService, timetableEntryService } from '../services/timetable.service';
import { prisma } from '../../../lib/prisma';

const router = Router();
const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => { fn(req, res, next).catch(next); };

// ═══════════════════════════════════════════════════════════════════
// TIMETABLE CRUD
// ═══════════════════════════════════════════════════════════════════

// GET /admin/branches/:branchId/academic-years/:ayId/timetables — List
router.get('/branches/:branchId/academic-years/:ayId/timetables', asyncHandler(async (req: Request, res: Response) => {
  const timetables = await timetableService.findAll(req.params.ayId);
  res.json({ success: true, data: timetables });
}));

// POST /admin/branches/:branchId/academic-years/:ayId/timetables — Create
router.post('/branches/:branchId/academic-years/:ayId/timetables', asyncHandler(async (req: Request, res: Response) => {
  const { name, type } = req.body;
  if (!name) { res.status(400).json({ success: false, message: 'Name is required' }); return; }
  const result = await timetableService.create(req.params.ayId, name, type || 'timetable');
  res.status(201).json({ success: true, data: result });
}));

// PUT /admin/branches/:branchId/timetables/:id/rename
router.put('/branches/:branchId/timetables/:id/rename', asyncHandler(async (req: Request, res: Response) => {
  const { newName } = req.body;
  if (!newName) { res.status(400).json({ success: false, message: 'newName is required' }); return; }
  const result = await timetableService.rename(req.params.id, newName);
  res.json({ success: true, data: result });
}));

// DELETE /admin/branches/:branchId/timetables/:id
router.delete('/branches/:branchId/timetables/:id', asyncHandler(async (req: Request, res: Response) => {
  const result = await timetableService.delete(req.params.id);
  res.json({ success: true, message: result.message });
}));

// ═══════════════════════════════════════════════════════════════════
// TIMETABLE DAY CONFIG — Enable/disable days
// ═══════════════════════════════════════════════════════════════════

// GET /admin/branches/:branchId/timetables/:id/days
router.get('/branches/:branchId/timetables/:id/days', asyncHandler(async (req: Request, res: Response) => {
  const days = await prisma.timetableDayConfig.findMany({
    where: { timetableId: req.params.id },
    orderBy: { dayOfWeek: 'asc' },
  });
  res.json({ success: true, data: days });
}));

// PUT /admin/branches/:branchId/timetables/:id/days
router.put('/branches/:branchId/timetables/:id/days', asyncHandler(async (req: Request, res: Response) => {
  const { days } = req.body;
  if (!days || !Array.isArray(days)) { res.status(400).json({ success: false, message: 'days array is required' }); return; }
  for (const d of days) {
    await prisma.timetableDayConfig.upsert({
      where: { timetableId_dayOfWeek: { timetableId: req.params.id, dayOfWeek: d.dayOfWeek } },
      create: { timetableId: req.params.id, dayOfWeek: d.dayOfWeek, isActive: d.isActive },
      update: { isActive: d.isActive },
    });
  }
  res.json({ success: true });
}));

// ═══════════════════════════════════════════════════════════════════
// TIMETABLE SLOTS
// ═══════════════════════════════════════════════════════════════════

// GET /admin/branches/:branchId/timetables/:id/slots
router.get('/branches/:branchId/timetables/:id/slots', asyncHandler(async (req: Request, res: Response) => {
  const slots = await timetableSlotService.findAll(req.params.id);
  res.json({ success: true, data: slots });
}));

// POST /admin/branches/:branchId/timetables/:id/slots
router.post('/branches/:branchId/timetables/:id/slots', asyncHandler(async (req: Request, res: Response) => {
  const { dayOfWeek, startTime, endTime } = req.body;
  if (!startTime || !endTime) {
    res.status(400).json({ success: false, message: 'startTime and endTime are required' });
    return;
  }
  // 12-hour cycle: 12→1 is forward, but string "12" > "01" fails
  const sh = parseInt(startTime.split(':')[0], 10);
  const eh = parseInt(endTime.split(':')[0], 10);
  const isAfter = (sh === 12 && eh < 12) ? true : startTime < endTime;
  if (!isAfter) {
    res.status(400).json({ success: false, message: 'End time must be after start time' });
    return;
  }
  const slot = await timetableSlotService.create(req.params.id, { dayOfWeek: dayOfWeek ?? null, startTime, endTime });
  res.status(201).json({ success: true, data: slot });
}));

// DELETE /admin/branches/:branchId/timetables/:id/slots/:slotId
router.delete('/branches/:branchId/timetables/:id/slots/:slotId', asyncHandler(async (req: Request, res: Response) => {
  const result = await timetableSlotService.delete(req.params.slotId);
  res.json({ success: true, message: result.message });
}));

// ═══════════════════════════════════════════════════════════════════
// TIMETABLE ENTRIES
// ═══════════════════════════════════════════════════════════════════

// GET /admin/branches/:branchId/sections/:sectionId/timetable
router.get('/branches/:branchId/sections/:sectionId/timetable', asyncHandler(async (req: Request, res: Response) => {
  const entries = await timetableEntryService.findByGroup(req.params.sectionId);
  res.json({ success: true, data: entries });
}));

// PUT /admin/branches/:branchId/sections/:sectionId/timetable/:slotId
router.put('/branches/:branchId/sections/:sectionId/timetable/:slotId', asyncHandler(async (req: Request, res: Response) => {
  const { subjectId, teacherId, note } = req.body;
  const entry = await timetableEntryService.upsert(req.params.slotId, req.params.sectionId, { subjectId, teacherId, note });
  res.json({ success: true, data: entry });
}));

// GET /admin/branches/:branchId/teachers/:teacherId/timetables — Teacher's timetable entries grouped
router.get('/branches/:branchId/teachers/:teacherId/timetables', asyncHandler(async (req: Request, res: Response) => {
  const result = await timetableEntryService.findByTeacherGrouped(req.params.branchId, req.params.teacherId);
  res.json({ success: true, data: result });
}));

export default router;
