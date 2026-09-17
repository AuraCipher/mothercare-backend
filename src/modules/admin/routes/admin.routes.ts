import { Router, Request, Response, NextFunction } from 'express';
import auth from '../../../middleware/auth/auth.middleware';
import { roleMiddleware } from '../../../middleware/auth/role.middleware';
import { branchScopeMiddleware } from '../../../middleware/auth/branch-scope.middleware';
import branchRoutes from './branch.routes';
import branchMemberRoutes from './branch-member.routes';
import calendarRoutes from './academic-calendar.routes';
import academicYearRoutes from './academic-year.routes';
import meRoutes from './me.routes';
import teacherRoutes from './teacher.routes';
import sectionRoutes from './section.routes';
import subjectRoutes from './subject.routes';
import timetableRoutes from './timetable.routes';
import attendanceRoutes from './attendance.routes';
import studentRoutes from './student.routes';
import feeRoutes from './fee.routes';
import examSessionRoutes from './exam-session.routes';
import resultRoutes from './result.routes';
import staffRoutes from './staff.routes';
import tenureRoutes from './tenure.routes';
import stationaryRoutes from './stationary.routes';
import expensesRoutes from './expenses.routes';
import communityClassRoleRoutes from './community-class-role.routes';
import { requireScope } from '../utils/scope-context';
import { staffPermissionMiddleware } from '../../../middleware/auth/staff-permission.middleware';

const router = Router();
const meRouter = Router();

// All admin routes require super_admin or management
router.use(auth);
router.use(roleMiddleware(['super_admin', 'management']));

// Branch scope enforcement on all admin routes
router.use(branchScopeMiddleware);

// Module RBAC for restricted staff (after branch scope)
router.use(staffPermissionMiddleware);

// ═══════════════════════════════════════════════════════════════════
// Phase 02: Branch + Academic Year System Routes
// ═══════════════════════════════════════════════════════════════════

router.use('/branches', branchRoutes);
router.use('/branches', branchMemberRoutes);
router.use('/calendars', calendarRoutes);
router.use(academicYearRoutes); // Contains /branches/:branchId/academic-years + /academic-years/:id + academic-year members

// ═══════════════════════════════════════════════════════════════════
// Phase 14: Backend Teachers — Profile + Assignments
// ═══════════════════════════════════════════════════════════════════

router.use(teacherRoutes); // Contains /teachers, /teachers/:id, /assignments, /groups/:groupId/assignments
router.use(sectionRoutes); // Contains /branches/:branchId/academic-years/:ayId/sections, /branches/:branchId/sections/:id
router.use(subjectRoutes); // Contains /branches/:branchId/academic-years/:ayId/subjects, /branches/:branchId/subjects/:id
router.use(timetableRoutes); // Contains /branches/:branchId/academic-years/:ayId/timetable/slots, /branches/:branchId/sections/:sectionId/timetable
router.use(attendanceRoutes); // Contains /attendance, /attendance/batch
router.use(feeRoutes); // Contains /fee-heads, /fee-structures, /student-fees, /payments, /families, /fees/*
router.use(studentRoutes); // Contains /students, /students/:id, /students/:id/emergency-contact, etc.
router.use(examSessionRoutes); // /exam-sessions — ExamSession CRUD
router.use('/result', resultRoutes); // /result/* — Result & Grade workflow
router.use('/staff', staffRoutes); // Staff RBAC — create staff + module permissions
router.use(tenureRoutes); // Tenure history — join/leave/rejoin, class movements
router.use(stationaryRoutes); // Stationary module (products, inventory, suppliers, sales records)
router.use(expensesRoutes); // Branch outgoing payments (payroll, utilities, others)
router.use('/communities', communityClassRoleRoutes); // Class chat role CRUD (Phase 4)

// ═══════════════════════════════════════════════════════════════════
// USERS (Create, Read, Delete)
// ═══════════════════════════════════════════════════════════════════

const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };

router.get('/users', asyncHandler(async (req: Request, res: Response) => {
  const { prisma } = (await import('../../../lib/prisma'));
  const { role, status, search, page: pageQ, limit: limitQ } = req.query;

  const where: any = {};
  if (role) where.role = role;
  if (status) where.status = status;
  if (search) {
    where.OR = [
      { name: { contains: search as string, mode: 'insensitive' } },
      { username: { contains: search as string, mode: 'insensitive' } },
      { email: { contains: search as string, mode: 'insensitive' } },
      { phone: { contains: search as string } },
    ];
  }

  const page = Math.max(1, parseInt(pageQ as string, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(limitQ as string, 10) || 50));
  const skip = (page - 1) * limit;

  const select = {
    id: true, name: true, username: true, email: true, phone: true,
    role: true, gender: true, status: true, lastLoginAt: true, createdAt: true,
  };

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      select,
      skip,
      take: limit,
    }),
    prisma.user.count({ where }),
  ]);

  res.json({ success: true, data: users, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 0 } });
}));

router.get('/users/:id', asyncHandler(async (req: Request, res: Response) => {
  const { prisma } = (await import('../../../lib/prisma'));
  const user = await prisma.user.findUnique({
    where: { id: req.params.id },
    select: {
      id: true, name: true, username: true, email: true, phone: true,
      role: true, gender: true, status: true, dateOfBirth: true, address: true,
      profilePhoto: true, lastLoginAt: true, lastSeen: true, createdAt: true,
    },
  });
  if (!user) {
    res.status(404).json({ success: false, message: 'User not found' });
    return;
  }
  res.json({ success: true, data: user });
}));

router.post('/users', asyncHandler(async (req: Request, res: Response) => {
  const { prisma } = (await import('../../../lib/prisma'));
  const { name, username, email, phone, password, role, gender, dateOfBirth, address } = req.body;

  if (!name?.trim() || !username?.trim() || !password) {
    res.status(400).json({ success: false, message: 'Name, username, and password are required' });
    return;
  }

  if (typeof password !== 'string' || password.length < 6) {
    res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });
    return;
  }

  // Privilege escalation guard: restrict which roles can be created
  const allowedRoles = ['parent', 'teacher', 'student', 'staff', 'canteen_staff'];
  const requestedRole = role || 'parent';
  const userRole = (req as any).user?.role;

  if (!allowedRoles.includes(requestedRole)) {
    // Only super_admin can create management users; nobody can create super_admin via this endpoint
    if (requestedRole === 'management' && userRole === 'super_admin') {
      // allowed — proceed
    } else if (requestedRole === 'super_admin') {
      res.status(403).json({ success: false, message: 'Cannot create super_admin users via this endpoint' });
      return;
    } else {
      res.status(400).json({ success: false, message: `Invalid role. Allowed: ${allowedRoles.join(', ')}` });
      return;
    }
  }

  const bc = await import('bcryptjs');
  const passwordHash = await bc.hash(password, 12);

  const user = await prisma.user.create({
    data: {
      name: name.trim(),
      username: username.trim().toLowerCase(),
      email: email?.trim()?.toLowerCase() || null,
      phone: phone?.trim() || null,
      passwordHash,
      role: requestedRole,
      gender,
      dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null,
      address,
      status: 'active',
    },
  });

  res.status(201).json({ success: true, data: { id: user.id, name: user.name, role: user.role } });
}));

router.delete('/users/:id', asyncHandler(async (req: Request, res: Response) => {
  const { prisma } = (await import('../../../lib/prisma'));
  const user = await prisma.user.update({
    where: { id: req.params.id },
    data: { status: 'inactive' },
  });
  res.json({ success: true, message: 'User deactivated', data: { id: user.id } });
}));

// ═══════════════════════════════════════════════════════════════════
// GROUPS / CLASSES (Create, Read, Delete) — Updated for AcademicYear
// ═══════════════════════════════════════════════════════════════════

router.get('/groups', asyncHandler(async (req: Request, res: Response) => {
  const { prisma } = (await import('../../../lib/prisma'));
  const scope = await requireScope(req, res);
  if (!scope) return;
  const { academicYearId } = scope;
  const { section } = req.query;

  const where: any = { academicYearId };
  if (section) where.section = section;

  const groups = await prisma.group.findMany({
    where,
    orderBy: { displayOrder: 'asc' },
    include: {
      _count: { select: { members: true, students: true } },
      academicYear: { select: { id: true } },
    },
  });

  res.json({ success: true, data: groups });
}));

router.get('/groups/:id', asyncHandler(async (req: Request, res: Response) => {
  const { prisma } = (await import('../../../lib/prisma'));
  const group = await prisma.group.findUnique({
    where: { id: req.params.id },
    include: {
      members: { include: { user: { select: { id: true, name: true, role: true } } } },
      students: true,
      academicYear: { select: { id: true } },
    },
  });
  if (!group) {
    res.status(404).json({ success: false, message: 'Group not found' });
    return;
  }
  res.json({ success: true, data: group });
}));

router.post('/groups', asyncHandler(async (req: Request, res: Response) => {
  const { prisma } = (await import('../../../lib/prisma'));
  let { academicYearId, name, section, displayOrder, capacity } = req.body;

  // If no academicYearId provided, auto-assign to the current ACTIVE academic year
  if (!academicYearId) {
    const activeAy = await prisma.academicYear.findFirst({
      where: { status: 'ACTIVE' },
      select: { id: true },
      orderBy: { createdAt: 'desc' },
    });
    if (!activeAy) {
      res.status(400).json({ success: false, message: 'No active academic year found. Create and publish an academic year first.' });
      return;
    }
    academicYearId = activeAy.id;
  }

  const group = await prisma.group.create({
    data: {
      academicYearId,
      name,
      section: section || undefined,
      displayOrder: displayOrder || 1,
      capacity: capacity || 30,
      createdById: (req as any).user?.id,
    },
  });

  res.status(201).json({ success: true, data: group });
}));

router.delete('/groups/:id', asyncHandler(async (req: Request, res: Response) => {
  const { prisma } = (await import('../../../lib/prisma'));
  await prisma.group.update({
    where: { id: req.params.id },
    data: { isActive: false },
  });
  res.json({ success: true, message: 'Group deactivated' });
}));

// ═══════════════════════════════════════════════════════════════════
// STATS (Dashboard data) — Updated: Community → AcademicYear
// ═══════════════════════════════════════════════════════════════════

router.get('/stats', asyncHandler(async (req: Request, res: Response) => {
  const { prisma } = (await import('../../../lib/prisma'));
  const scope = await requireScope(req, res);
  if (!scope) return;
  const { academicYearId, branchId } = scope;

  const [groups, students, teachers, staff, academicYears, branches, apiKeys] = await Promise.all([
    prisma.group.count({ where: { academicYearId, isActive: true } }),
    prisma.student.count({ where: { academicYearId, isActive: true, status: 'ACTIVE' } }),
    prisma.user.count({
      where: {
        role: 'teacher',
        status: 'active',
        branchMembers: { some: { branchId, isActive: true } },
      },
    }),
    prisma.branchMember.count({ where: { branchId, isActive: true } }),
    prisma.academicYear.count({ where: { branchId } }),
    prisma.branch.count({ where: { isActive: true } }),
    prisma.apiKey.count({ where: { revokedAt: null } }),
  ]);

  res.json({
    success: true,
    data: {
      totalGroups: groups,
      totalStudents: students,
      totalTeachers: teachers,
      totalStaff: staff,
      totalAcademicYears: academicYears,
      totalBranches: branches,
      activeApiKeys: apiKeys,
      academicYearId,
      branchId,
    },
  });
}));

export default router;

// ═══════════════════════════════════════════════════════════════════
// /me routes (authenticated but no admin role check)
// ═══════════════════════════════════════════════════════════════════

// Mount /me with its own auth (no admin role requirement)
meRouter.use(auth);
meRouter.use(meRoutes);

export { meRouter };
