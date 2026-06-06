import { Router, Request, Response, NextFunction } from 'express';
import auth from '../../middleware/auth.middleware';
import { roleMiddleware } from '../../middleware/role.middleware';
import branchRoutes from './branch.routes';
import calendarRoutes from './academic-calendar.routes';
import academicYearRoutes from './academic-year.routes';
import meRoutes from './me.routes';

const router = Router();
const meRouter = Router();

// All admin routes require super_admin or management
router.use(auth);
router.use(roleMiddleware(['super_admin', 'management']));

// ═══════════════════════════════════════════════════════════════════
// Phase 02: Branch + Academic Year System Routes
// ═══════════════════════════════════════════════════════════════════

router.use('/branches', branchRoutes);
router.use('/calendars', calendarRoutes);
router.use(academicYearRoutes); // Contains /branches/:branchId/academic-years + /academic-years/:id + academic-year members

// ═══════════════════════════════════════════════════════════════════
// USERS (Create, Read, Delete)
// ═══════════════════════════════════════════════════════════════════

const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };

router.get('/users', asyncHandler(async (req: Request, res: Response) => {
  const { prisma } = (await import('../../lib/prisma'));
  const { role, status, search } = req.query;

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

  const users = await prisma.user.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    select: {
      id: true, name: true, username: true, email: true, phone: true,
      role: true, gender: true, status: true, lastLoginAt: true, createdAt: true,
    },
  });

  res.json({ success: true, data: users });
}));

router.get('/users/:id', asyncHandler(async (req: Request, res: Response) => {
  const { prisma } = (await import('../../lib/prisma'));
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
  const { prisma } = (await import('../../lib/prisma'));
  const { name, username, email, phone, password, role, gender, dateOfBirth, address } = req.body;

  if (!name || !username || !password) {
    res.status(400).json({ success: false, message: 'Name, username, and password are required' });
    return;
  }

  const bc = await import('bcryptjs');
  const passwordHash = await bc.hash(password, 12);

  const user = await prisma.user.create({
    data: {
      name,
      username,
      email,
      phone,
      passwordHash,
      role: role || 'parent',
      gender,
      dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null,
      address,
      status: 'active',
    },
  });

  res.status(201).json({ success: true, data: { id: user.id, name: user.name, role: user.role } });
}));

router.delete('/users/:id', asyncHandler(async (req: Request, res: Response) => {
  const { prisma } = (await import('../../lib/prisma'));
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
  const { prisma } = (await import('../../lib/prisma'));
  const { academicYearId, section } = req.query;

  const where: any = {};
  if (academicYearId) where.academicYearId = academicYearId;
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
  const { prisma } = (await import('../../lib/prisma'));
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
  const { prisma } = (await import('../../lib/prisma'));
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
    },
  });

  res.status(201).json({ success: true, data: group });
}));

router.delete('/groups/:id', asyncHandler(async (req: Request, res: Response) => {
  const { prisma } = (await import('../../lib/prisma'));
  await prisma.group.update({
    where: { id: req.params.id },
    data: { isActive: false },
  });
  res.json({ success: true, message: 'Group deactivated' });
}));

// ═══════════════════════════════════════════════════════════════════
// STUDENTS (Create, Read, Delete)
// ═══════════════════════════════════════════════════════════════════

router.get('/students', asyncHandler(async (req: Request, res: Response) => {
  const { prisma } = (await import('../../lib/prisma'));
  const { groupId, isActive, academicYearId } = req.query;
  const where: any = {};
  if (groupId) where.groupId = groupId;
  if (academicYearId) where.academicYearId = academicYearId;
  if (isActive !== undefined) where.isActive = isActive === 'true';

  const students = await prisma.student.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: {
      group: { select: { name: true, section: true } },
    },
  });

  res.json({ success: true, data: students });
}));

router.get('/students/:id', asyncHandler(async (req: Request, res: Response) => {
  const { prisma } = (await import('../../lib/prisma'));
  const student = await prisma.student.findUnique({
    where: { id: req.params.id },
    include: {
      group: true,
      parents: { include: { parent: { include: { user: true } } } },
    },
  });
  if (!student) {
    res.status(404).json({ success: false, message: 'Student not found' });
    return;
  }
  res.json({ success: true, data: student });
}));

router.post('/students', asyncHandler(async (req: Request, res: Response) => {
  const { prisma } = (await import('../../lib/prisma'));
  const { name, gender, dateOfBirth, groupId, academicYearId } = req.body;

  if (!name) {
    res.status(400).json({ success: false, message: 'Student name is required' });
    return;
  }

  // Auto-assign to ACTIVE academic year if not provided
  let targetAyId = academicYearId;
  if (!targetAyId) {
    const activeAy = await prisma.academicYear.findFirst({
      where: { status: 'ACTIVE' },
      select: { id: true },
    });
    if (!activeAy) {
      res.status(400).json({ success: false, message: 'No active academic year found. Create one first.' });
      return;
    }
    targetAyId = activeAy.id;
  }

  const student = await prisma.student.create({
    data: {
      name,
      gender,
      dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null,
      groupId,
      academicYearId: targetAyId,
    },
  });

  res.status(201).json({ success: true, data: student });
}));

router.delete('/students/:id', asyncHandler(async (req: Request, res: Response) => {
  const { prisma } = (await import('../../lib/prisma'));
  const student = await prisma.student.update({
    where: { id: req.params.id },
    data: { isActive: false },
  });
  res.json({ success: true, message: 'Student deactivated', data: { id: student.id } });
}));

// ═══════════════════════════════════════════════════════════════════
// STATS (Dashboard data) — Updated: Community → AcademicYear
// ═══════════════════════════════════════════════════════════════════

router.get('/stats', asyncHandler(async (req: Request, res: Response) => {
  const { prisma } = (await import('../../lib/prisma'));

  const [users, groups, students, academicYears, branches, apiKeys] = await Promise.all([
    prisma.user.count({ where: { status: 'active' } }),
    prisma.group.count(),
    prisma.student.count({ where: { isActive: true } }),
    prisma.academicYear.count(),
    prisma.branch.count({ where: { isActive: true } }),
    prisma.apiKey.count({ where: { revokedAt: null } }),
  ]);

  const userBreakdown = await prisma.user.groupBy({
    by: ['role'],
    where: { status: 'active' },
    _count: { role: true },
  });

  const roleCounts = userBreakdown.reduce((acc: any, item: any) => {
    acc[item.role] = item._count.role;
    return acc;
  }, {});

  res.json({
    success: true,
    data: {
      totalUsers: users,
      totalGroups: groups,
      totalStudents: students,
      totalAcademicYears: academicYears,
      totalBranches: branches,
      activeApiKeys: apiKeys,
      byRole: roleCounts,
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
