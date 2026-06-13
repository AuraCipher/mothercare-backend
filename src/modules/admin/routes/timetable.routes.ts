import { Router, Request, Response, NextFunction } from 'express';
import { timetableDayConfigService, timetableSlotService, timetableEntryService } from '../services/timetable.service';

const router = Router();
const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => { fn(req, res, next).catch(next); };

// ═══════════════════════════════════════════════════════════════════
// TIMETABLE SLOTS — Universal time grid per AY
// ═══════════════════════════════════════════════════════════════════

// GET /admin/branches/:branchId/academic-years/:ayId/timetable/slots
router.get('/branches/:branchId/academic-years/:ayId/timetable/slots', asyncHandler(async (req: Request, res: Response) => {
  const slots = await timetableSlotService.findAll(req.params.ayId);
  res.json({ success: true, data: slots });
}));

// POST /admin/branches/:branchId/academic-years/:ayId/timetable/slots
router.post('/branches/:branchId/academic-years/:ayId/timetable/slots', asyncHandler(async (req: Request, res: Response) => {
  const { dayOfWeek, startTime, endTime } = req.body;
  if (!dayOfWeek || !startTime || !endTime) {
    res.status(400).json({ success: false, message: 'dayOfWeek, startTime, and endTime are required' });
    return;
  }
  const slot = await timetableSlotService.create(req.params.ayId, { dayOfWeek, startTime, endTime });
  res.status(201).json({ success: true, data: slot });
}));

// PUT /admin/branches/:branchId/timetable/slots/:id
router.put('/branches/:branchId/timetable/slots/:id', asyncHandler(async (req: Request, res: Response) => {
  const { startTime, endTime, dayOfWeek } = req.body;
  const slot = await timetableSlotService.update(req.params.id, { startTime, endTime, dayOfWeek });
  res.json({ success: true, data: slot });
}));

// DELETE /admin/branches/:branchId/timetable/slots/:id
router.delete('/branches/:branchId/timetable/slots/:id', asyncHandler(async (req: Request, res: Response) => {
  const result = await timetableSlotService.delete(req.params.id);
  res.json({ success: true, message: result.message });
}));

// DELETE /admin/branches/:branchId/academic-years/:ayId/timetable/groups/:group — Delete timetable group
router.delete('/branches/:branchId/academic-years/:ayId/timetable/groups/:group', asyncHandler(async (req: Request, res: Response) => {
  const result = await timetableSlotService.deleteGroup(req.params.ayId, req.params.group);
  res.json({ success: true, message: result.message });
}));

// ═══════════════════════════════════════════════════════════════════
// TIMETABLE DAY CONFIG — Enable/disable days per timetable group
// ═══════════════════════════════════════════════════════════════════

// GET /admin/branches/:branchId/academic-years/:ayId/timetable/groups — List all timetable groups
router.get('/branches/:branchId/academic-years/:ayId/timetable/groups', asyncHandler(async (req: Request, res: Response) => {
  const groups = await timetableDayConfigService.getGroups(req.params.ayId);
  const slots = await timetableSlotService.findAll(req.params.ayId);
  const enriched = groups.map(g => ({
    ...g,
    slotCount: slots.filter(s => (s.timetableGroup || 'default') === g.name).length,
  }));
  res.json({ success: true, data: enriched });
}));

// GET /admin/branches/:branchId/academic-years/:ayId/timetable/days
router.get('/branches/:branchId/academic-years/:ayId/timetable/days', asyncHandler(async (req: Request, res: Response) => {
  const group = (req.query.timetableGroup as string) || 'default';
  const days = await timetableDayConfigService.getDays(req.params.ayId, group);
  res.json({ success: true, data: days });
}));

// PUT /admin/branches/:branchId/academic-years/:ayId/timetable/days
router.put('/branches/:branchId/academic-years/:ayId/timetable/days', asyncHandler(async (req: Request, res: Response) => {
  const { timetableGroup, days } = req.body;
  const result = await timetableDayConfigService.setDays(req.params.ayId, timetableGroup || 'default', days || []);
  res.json({ success: true, data: result });
}));

// ═══════════════════════════════════════════════════════════════════
// TIMETABLE ENTRIES — Per-section subject/teacher assignment
// ═══════════════════════════════════════════════════════════════════

// GET /admin/branches/:branchId/sections/:sectionId/timetable
router.get('/branches/:branchId/sections/:sectionId/timetable', asyncHandler(async (req: Request, res: Response) => {
  const entries = await timetableEntryService.findByGroup(req.params.sectionId);
  // Also return all slots so frontend can show empty rows
  const slot = entries[0]?.slot;
  // Fetch all slots for day matching
  res.json({ success: true, data: entries });
}));

// PUT /admin/branches/:branchId/sections/:sectionId/timetable/:slotId
router.put('/branches/:branchId/sections/:sectionId/timetable/:slotId', asyncHandler(async (req: Request, res: Response) => {
  const { subjectId, teacherId } = req.body;
  const entry = await timetableEntryService.upsert(req.params.slotId, req.params.sectionId, { subjectId, teacherId });
  res.json({ success: true, data: entry });
}));

export default router;
