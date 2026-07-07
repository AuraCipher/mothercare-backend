import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../../../lib/prisma';
import { requireScope } from '../utils/scope-context';
import {
  assertStudentsInBranchAy,
  assertStudentsInScope,
  validateAttendanceDate,
} from '../utils/attendance-scope';
import {
  assertStaffInScopeWithTenure,
  assertTeachersInScopeWithTenure,
} from '../utils/employee-attendance';

const router = Router();
const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => { fn(req, res, next).catch(next); };

// GET /attendance?date=...&groupId=...&academicYearId=...&branchId=...
router.get('/attendance', asyncHandler(async (req: Request, res: Response) => {
  const scope = await requireScope(req, res);
  if (!scope) return;
  const { academicYearId, branchId } = scope;
  const { date, from, to, groupId } = req.query;

  let dateFilter: any = {};
  if (from && to) {
    dateFilter = { gte: new Date(from as string), lte: new Date(to as string) };
  } else if (date) {
    dateFilter = { equals: new Date(date as string) };
  }

  if (groupId) {
    const group = await prisma.group.findFirst({
      where: { id: groupId as string, academicYearId },
      select: { id: true },
    });
    if (!group) {
      res.status(400).json({ success: false, message: 'Group not found in the selected academic year' });
      return;
    }
  }

  const attendanceWhere: any = { academicYearId };
  if (Object.keys(dateFilter).length) attendanceWhere.date = dateFilter;

  const studentWhere: any = {
    isActive: true,
    status: 'ACTIVE',
    academicYearId,
    academicYear: { branchId },
  };
  if (groupId) studentWhere.groupId = groupId as string;

  const students = await prisma.student.findMany({
    where: studentWhere,
    select: {
      id: true, name: true, rollNumber: true, admissionNumber: true,
      groupId: true,
      attendances: {
        where: attendanceWhere,
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
  const scope = await requireScope(req, res);
  if (!scope) return;

  const { date, groupId, records } = req.body;
  if (!date || !groupId || !records || !Array.isArray(records)) {
    res.status(400).json({ success: false, message: 'date, groupId, and records[] are required' });
    return;
  }

  const dateObj = new Date(date as string);
  const dateErr = await validateAttendanceDate(scope.academicYearId, dateObj);
  if (dateErr) {
    res.status(400).json({ success: false, message: dateErr });
    return;
  }

  const studentIds = records.map((r: { studentId?: string }) => r.studentId).filter(Boolean) as string[];
  const scopeErr = await assertStudentsInScope(studentIds, groupId, scope);
  if (scopeErr) {
    res.status(400).json({ success: false, message: scopeErr });
    return;
  }

  const userId = (req as any).user?.id;
  let saved = 0;

  for (const record of records) {
    if (!record.studentId || !record.status) continue;
    await prisma.attendance.upsert({
      where: { studentId_date: { studentId: record.studentId, date: dateObj } },
      update: { status: record.status, markedById: userId, note: record.note || null },
      create: {
        studentId: record.studentId,
        academicYearId: scope.academicYearId,
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
  const scope = await requireScope(req, res);
  if (!scope) return;
  const { academicYearId, branchId } = scope;
  const { id } = req.params;
  const { from, to } = req.query;

  const student = await prisma.student.findFirst({
    where: { id, academicYearId, academicYear: { branchId } },
    select: { id: true },
  });
  if (!student) {
    res.status(404).json({ success: false, message: 'Student not found in the selected academic year' });
    return;
  }

  const where: any = { studentId: id, academicYearId };
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

// GET /attendance/teachers?date=...&academicYearId=...&branchId=...
router.get('/attendance/teachers', asyncHandler(async (req: Request, res: Response) => {
  const scope = await requireScope(req, res);
  if (!scope) return;
  const { academicYearId, branchId } = scope;
  const { date, from, to } = req.query;

  let dateFilter: any = {};
  if (from && to) {
    dateFilter = { gte: new Date(from as string), lte: new Date(to as string) };
  } else if (date) {
    dateFilter = { equals: new Date(date as string) };
  }

  const attendanceWhere: any = { academicYearId };
  if (Object.keys(dateFilter).length) attendanceWhere.date = dateFilter;

  const teachers = await prisma.user.findMany({
    where: {
      role: 'teacher',
      status: 'active',
      branchMembers: { some: { branchId, isActive: true } },
    },
    select: {
      id: true, name: true,
      teacherAttendances: {
        where: attendanceWhere,
        select: { date: true, status: true, note: true },
        orderBy: { date: 'asc' },
      },
    },
    orderBy: { name: 'asc' },
  });

  const data = teachers.map(t => ({
    id: t.id, name: t.name,
    attendances: t.teacherAttendances.map(a => ({ date: a.date, status: a.status, note: a.note })),
  }));

  res.json({ success: true, data, total: data.length });
}));

// POST /attendance/teachers/batch — Save teacher attendance
router.post('/attendance/teachers/batch', asyncHandler(async (req: Request, res: Response) => {
  const scope = await requireScope(req, res);
  if (!scope) return;

  const { date, records } = req.body;
  if (!date || !records || !Array.isArray(records)) {
    res.status(400).json({ success: false, message: 'date and records[] are required' });
    return;
  }

  const dateObj = new Date(date as string);
  const dateErr = await validateAttendanceDate(scope.academicYearId, dateObj);
  if (dateErr) {
    res.status(400).json({ success: false, message: dateErr });
    return;
  }

  const teacherIds = records.map((r: { teacherId?: string }) => r.teacherId).filter(Boolean) as string[];
  const scopeErr = await assertTeachersInScopeWithTenure(
    teacherIds, scope.branchId, scope.academicYearId, dateObj,
  );
  if (scopeErr) {
    res.status(400).json({ success: false, message: scopeErr });
    return;
  }

  const userId = (req as any).user?.id;
  let saved = 0;

  for (const record of records) {
    if (!record.teacherId || !record.status) continue;
    await prisma.teacherAttendance.upsert({
      where: { teacherId_date: { teacherId: record.teacherId, date: dateObj } },
      update: { status: record.status, markedById: userId, note: record.note || null },
      create: {
        teacherId: record.teacherId,
        academicYearId: scope.academicYearId,
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

// ═══════════════════════════════════════════════════════════════════
// STAFF ATTENDANCE (workers, cleaners, management, canteen)
// ═══════════════════════════════════════════════════════════════════

router.get('/attendance/staff', asyncHandler(async (req: Request, res: Response) => {
  const scope = await requireScope(req, res);
  if (!scope) return;
  const { academicYearId, branchId } = scope;
  const { date, from, to } = req.query;

  let dateFilter: any = {};
  if (from && to) {
    dateFilter = { gte: new Date(from as string), lte: new Date(to as string) };
  } else if (date) {
    dateFilter = { equals: new Date(date as string) };
  }

  const attendanceWhere: any = { academicYearId };
  if (Object.keys(dateFilter).length) attendanceWhere.date = dateFilter;

  const payrollRoles = ['management', 'canteen_staff', 'worker'] as const;
  const staff = await prisma.user.findMany({
    where: {
      status: 'active',
      branchMembers: {
        some: { branchId, isActive: true, role: { in: [...payrollRoles] } },
      },
    },
    select: {
      id: true,
      name: true,
      staffProfile: { select: { employeeId: true } },
      branchMembers: { where: { branchId }, select: { role: true } },
      staffAttendances: {
        where: attendanceWhere,
        select: { date: true, status: true, note: true },
        orderBy: { date: 'asc' },
      },
    },
    orderBy: { name: 'asc' },
  });

  const data = staff.map((s) => ({
    id: s.id,
    name: s.name,
    employeeId: s.staffProfile?.employeeId ?? null,
    branchRole: s.branchMembers[0]?.role ?? 'management',
    attendances: s.staffAttendances.map((a) => ({
      date: a.date,
      status: a.status,
      note: a.note,
    })),
  }));

  res.json({ success: true, data, total: data.length });
}));

router.post('/attendance/staff/batch', asyncHandler(async (req: Request, res: Response) => {
  const scope = await requireScope(req, res);
  if (!scope) return;

  const { date, records } = req.body;
  if (!date || !records || !Array.isArray(records)) {
    res.status(400).json({ success: false, message: 'date and records[] are required' });
    return;
  }

  const dateObj = new Date(date as string);
  const dateErr = await validateAttendanceDate(scope.academicYearId, dateObj);
  if (dateErr) {
    res.status(400).json({ success: false, message: dateErr });
    return;
  }

  const staffIds = records.map((r: { staffUserId?: string }) => r.staffUserId).filter(Boolean) as string[];
  const scopeErr = await assertStaffInScopeWithTenure(
    staffIds, scope.branchId, scope.academicYearId, dateObj,
  );
  if (scopeErr) {
    res.status(400).json({ success: false, message: scopeErr });
    return;
  }

  const userId = (req as any).user?.id;
  let saved = 0;

  for (const record of records) {
    if (!record.staffUserId || !record.status) continue;
    await prisma.staffAttendance.upsert({
      where: { staffUserId_date: { staffUserId: record.staffUserId, date: dateObj } },
      update: { status: record.status, markedById: userId, note: record.note || null },
      create: {
        staffUserId: record.staffUserId,
        academicYearId: scope.academicYearId,
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
  const scope = await requireScope(req, res);
  if (!scope) return;

  const { date, records } = req.body;
  if (!date || !records || !Array.isArray(records)) {
    res.status(400).json({ success: false, message: 'date and records[] required' });
    return;
  }

  const studentIds = records.map((r: { studentId?: string }) => r.studentId).filter(Boolean) as string[];
  const scopeErr = await assertStudentsInBranchAy(studentIds, scope);
  if (scopeErr) {
    res.status(400).json({ success: false, message: scopeErr });
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
