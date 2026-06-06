import { Router, Request, Response, NextFunction } from 'express';
import { academicCalendarService } from './services/academic-calendar.service';

const router = Router();

const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };

// POST /admin/calendars — Create calendar (BA-008)
router.post('/', asyncHandler(async (req: Request, res: Response) => {
  const { label, startDate, endDate, isCurrent } = req.body;

  if (!label || typeof label !== 'string' || label.trim().length === 0) {
    res.status(400).json({ success: false, message: 'Calendar label is required' });
    return;
  }
  if (!startDate) {
    res.status(400).json({ success: false, message: 'startDate is required' });
    return;
  }
  if (!endDate) {
    res.status(400).json({ success: false, message: 'endDate is required' });
    return;
  }

  const calendar = await academicCalendarService.create({
    label: label.trim(),
    startDate,
    endDate,
    isCurrent,
  });

  res.status(201).json({ success: true, data: calendar });
}));

// GET /admin/calendars — List calendars (BA-008)
router.get('/', asyncHandler(async (req: Request, res: Response) => {
  const calendars = await academicCalendarService.findAll();
  res.json({ success: true, data: calendars });
}));

// GET /admin/calendars/:id — Get calendar detail (BA-008)
router.get('/:id', asyncHandler(async (req: Request, res: Response) => {
  const calendar = await academicCalendarService.findById(req.params.id);
  res.json({ success: true, data: calendar });
}));

// PUT /admin/calendars/:id — Update calendar (BA-008)
router.put('/:id', asyncHandler(async (req: Request, res: Response) => {
  const { label, startDate, endDate, isCurrent } = req.body;
  const calendar = await academicCalendarService.update(req.params.id, { label, startDate, endDate, isCurrent });
  res.json({ success: true, data: calendar });
}));

// PATCH /admin/calendars/:id/set-current — Set as current calendar (BA-007)
router.patch('/:id/set-current', asyncHandler(async (req: Request, res: Response) => {
  const calendar = await academicCalendarService.setCurrent(req.params.id);
  res.json({ success: true, data: calendar });
}));

// DELETE /admin/calendars/:id — Delete calendar (BA-008)
router.delete('/:id', asyncHandler(async (req: Request, res: Response) => {
  await academicCalendarService.delete(req.params.id);
  res.status(204).json({ success: true, message: 'Calendar deleted' });
}));

export default router;
