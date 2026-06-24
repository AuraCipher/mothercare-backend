import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../../../lib/prisma';

const router = Router();
const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => { fn(req, res, next).catch(next); };

// GET /attendance?date=...&groupId=... — Get attendance (single day or range)
//   Single day: /attendance?date=2026-06-20&groupId=xxx
//   Range:      /attendance?from=2026-06-01&to=2026-06-30&groupId=xxx
router.get('/attendance', asyncHandler(async (req: Request, res: Response) => {
  const { date, from, to, groupId } = req.query;

  // Build date filter
  let dateFilter: any = {};
  if (from && to) {
    dateFilter = { gte: new Date(from as string), lte: new Date(to as string) };
  } else if (date) {
    dateFilter = { equals: new Date(date as string) };
  }

  const studentWhere: any = { isActive: true };
  if (groupId) studentWhere.groupId = groupId as string;

  const students = await prisma.student.findMany({
    where: studentWhere,
    select: {
      id: true, name: true, rollNumber: true, admissionNumber: true,
      groupId: true,
      attendances: {
        where: Object.keys(dateFilter).length ? { date: dateFilter } : undefined,
        select: { date: true, status: true, note: true },
        orderBy: { date: 'asc' },
      },
    },
    orderBy: groupId ? [{ rollNumber: 'asc' as const }] : [{ name: 'asc' as const }],
  });

  res.json({ success: true, data: students, total: students.length });
}));

// POST /attendance/batch — Save attendance for multiple students
router.post('/attendance/batch', asyncHandler(async (req: Request, res: Response) => {
  const { date, groupId, academicYearId, records } = req.body;
  if (!date || !groupId || !records || !Array.isArray(records)) {
    res.status(400).json({ success: false, message: 'date, groupId, and records[] are required' });
    return;
  }

  if (!academicYearId) {
    const activeAy = await prisma.academicYear.findFirst({ where: { status: 'ACTIVE' }, select: { id: true } });
    if (!activeAy) { res.status(400).json({ success: false, message: 'No active academic year' }); return; }
    req.body.academicYearId = activeAy.id;
  }

  const userId = (req as any).user?.id;
  const dateObj = new Date(date as string);
  // Block future dates
  const checkDate = new Date(); checkDate.setHours(23, 59, 59, 999);
  if (dateObj > checkDate) {
    res.status(400).json({ success: false, message: 'Cannot mark attendance for future dates' });
    return;
  }
  let saved = 0;

  for (const record of records) {
    if (!record.studentId || !record.status) continue;
    await prisma.attendance.upsert({
      where: { studentId_date: { studentId: record.studentId, date: dateObj } },
      update: { status: record.status, markedById: userId, note: record.note || null },
      create: {
        studentId: record.studentId,
        academicYearId: req.body.academicYearId,
        date: dateObj,
        status: record.status,
        note: record.note || null,
        markedById: userId,
      },
    });
    saved++;
  }

  res.json({ success: true, data: { saved, total: records.length } });
}));

// GET /students/:id/attendance — Student attendance report
router.get('/students/:id/attendance', asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const { from, to } = req.query;

  const where: any = { studentId: id };
  if (from) where.date = { ...where.date, gte: new Date(from as string) };
  if (to) where.date = { ...where.date, lte: new Date(to as string) };

  const records = await prisma.attendance.findMany({
    where,
    orderBy: { date: 'asc' },
    select: { date: true, status: true, note: true },
  });

  const present = records.filter(r => r.status === 'present').length;
  const absent = records.filter(r => r.status === 'absent').length;
  const late = records.filter(r => r.status === 'late').length;
  const total = records.length;

  res.json({
    success: true,
    data: {
      records,
      summary: { present, absent, late, total, percentage: total ? Math.round((present / total) * 100) : 0 },
    },
  });
}));

// ═══════════════════════════════════════════════════════════════════
// TEACHER ATTENDANCE
// ═══════════════════════════════════════════════════════════════════

// GET /attendance/teachers?date=... or ?from=...&to=... — Teacher attendance
router.get('/attendance/teachers', asyncHandler(async (req: Request, res: Response) => {
  const { date, from, to } = req.query;

  let dateFilter: any = {};
  if (from && to) {
    dateFilter = { gte: new Date(from as string), lte: new Date(to as string) };
  } else if (date) {
    dateFilter = { equals: new Date(date as string) };
  }

  const teachers = await prisma.user.findMany({
    where: { role: 'teacher', status: 'active' },
    select: {
      id: true, name: true,
      teacherAttendances: {
        where: Object.keys(dateFilter).length ? { date: dateFilter } : undefined,
        select: { date: true, status: true, note: true },
        orderBy: { date: 'asc' },
      },
    },
    orderBy: { name: 'asc' },
  });

  // Map to the same format as student attendance (rename teacherAttendances → attendances)
  const data = teachers.map(t => ({
    id: t.id, name: t.name,
    attendances: t.teacherAttendances.map(a => ({ date: a.date, status: a.status, note: a.note })),
  }));

  res.json({ success: true, data, total: data.length });
}));

// POST /attendance/teachers/batch — Save teacher attendance
router.post('/attendance/teachers/batch', asyncHandler(async (req: Request, res: Response) => {
  const { date, academicYearId, records } = req.body;
  if (!date || !records || !Array.isArray(records)) {
    res.status(400).json({ success: false, message: 'date and records[] are required' });
    return;
  }

  if (!academicYearId) {
    const activeAy = await prisma.academicYear.findFirst({ where: { status: 'ACTIVE' }, select: { id: true } });
    if (!activeAy) { res.status(400).json({ success: false, message: 'No active academic year' }); return; }
    req.body.academicYearId = activeAy.id;
  }

  const userId = (req as any).user?.id;
  const dateObj = new Date(date as string);
  const checkDate = new Date(); checkDate.setHours(23, 59, 59, 999);
  if (dateObj > checkDate) {
    res.status(400).json({ success: false, message: 'Cannot mark attendance for future dates' });
    return;
  }

  let saved = 0;
  for (const record of records) {
    if (!record.teacherId || !record.status) continue;
    await prisma.teacherAttendance.upsert({
      where: { teacherId_date: { teacherId: record.teacherId, date: dateObj } },
      update: { status: record.status, markedById: userId, note: record.note || null },
      create: {
        teacherId: record.teacherId,
        academicYearId: req.body.academicYearId,
        date: dateObj,
        status: record.status,
        note: record.note || null,
        markedById: userId,
      },
    });
    saved++;
  }

  res.json({ success: true, data: { saved, total: records.length } });
}));

// POST /attendance/notify — Queue attendance notifications for parents
router.post('/attendance/notify', asyncHandler(async (req: Request, res: Response) => {
  const { date, records } = req.body;
  if (!date || !records || !Array.isArray(records)) {
    res.status(400).json({ success: false, message: 'date and records[] required' });
    return;
  }
  const dateObj = new Date(date as string);
  let queued = 0;
  for (const r of records) {
    if (!r.studentId || !r.status) continue;
    const labels: Record<string, string> = { absent: 'was absent', late: 'arrived late', leave: 'is on leave' };
    const msg = `Your child ${labels[r.status] || r.status} on ${date}.`;
    const exists = await prisma.attendanceNotification.findFirst({
      where: { studentId: r.studentId, date: dateObj, status: r.status },
    });
    if (exists) continue;
    await prisma.attendanceNotification.create({
      data: { studentId: r.studentId, date: dateObj, status: r.status, message: msg },
    });
    queued++;
  }
  res.json({ success: true, data: { queued, message: 'Notifications queued. Will be sent via chat app.' } });
}));

export default router;
