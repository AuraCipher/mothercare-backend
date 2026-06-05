import { Router, Request, Response } from 'express';
import auth from '../../middleware/auth.middleware';
import { roleMiddleware } from '../../middleware/role.middleware';

const router = Router();

// All admin routes require super_admin or management
router.use(auth);
router.use(roleMiddleware(['super_admin', 'management']));

// ═══════════════════════════════════════════════════════════════════
// USERS (Create, Read, Delete)
// ═══════════════════════════════════════════════════════════════════

router.get('/users', async (req: Request, res: Response) => {
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
  return;
});

router.get('/users/:id', async (req: Request, res: Response) => {
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
});

router.post('/users', async (req: Request, res: Response) => {
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
});

router.delete('/users/:id', async (req: Request, res: Response) => {
  const { prisma } = (await import('../../lib/prisma'));
  // Soft delete: mark inactive
  const user = await prisma.user.update({
    where: { id: req.params.id },
    data: { status: 'inactive' },
  });
  res.json({ success: true, message: 'User deactivated', data: { id: user.id } });
});

// ═══════════════════════════════════════════════════════════════════
// GROUPS / CLASSES (Create, Read, Delete)
// ═══════════════════════════════════════════════════════════════════

router.get('/groups', async (req: Request, res: Response) => {
  const { prisma } = (await import('../../lib/prisma'));
  const { communityId, section } = req.query;

  const where: any = {};
  if (communityId) where.communityId = communityId;
  if (section) where.section = section;

  const groups = await prisma.group.findMany({
    where,
    orderBy: { displayOrder: 'asc' },
    include: {
      _count: { select: { members: true, students: true } },
      community: { select: { name: true } },
    },
  });

  res.json({ success: true, data: groups });
});

router.get('/groups/:id', async (req: Request, res: Response) => {
  const { prisma } = (await import('../../lib/prisma'));
  const group = await prisma.group.findUnique({
    where: { id: req.params.id },
    include: {
      members: { include: { user: { select: { id: true, name: true, role: true } } } },
      students: true,
      community: { select: { name: true } },
    },
  });
  if (!group) {
    res.status(404).json({ success: false, message: 'Group not found' });
    return;
  }
  res.json({ success: true, data: group });
});

router.post('/groups', async (req: Request, res: Response) => {
  const { prisma } = (await import('../../lib/prisma'));
  const { communityId, name, section, displayOrder, capacity } = req.body;

  const group = await prisma.group.create({
    data: {
      communityId,
      name,
      section: section || undefined,
      displayOrder: displayOrder || 1,
      capacity: capacity || 30,
    },
  });

  res.status(201).json({ success: true, data: group });
});

router.delete('/groups/:id', async (req: Request, res: Response) => {
  const { prisma } = (await import('../../lib/prisma'));
  await prisma.group.update({
    where: { id: req.params.id },
    data: { isActive: false },
  });
  res.json({ success: true, message: 'Group deactivated' });
});

// ═══════════════════════════════════════════════════════════════════
// STUDENTS (Create, Read, Delete)
// ═══════════════════════════════════════════════════════════════════

router.get('/students', async (req: Request, res: Response) => {
  const { prisma } = (await import('../../lib/prisma'));
  const { groupId, isActive } = req.query;
  const where: any = {};
  if (groupId) where.groupId = groupId;
  if (isActive !== undefined) where.isActive = isActive === 'true';

  const students = await prisma.student.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: {
      group: { select: { name: true, section: true } },
    },
  });

  res.json({ success: true, data: students });
});

router.get('/students/:id', async (req: Request, res: Response) => {
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
});

router.post('/students', async (req: Request, res: Response) => {
  const { prisma } = (await import('../../lib/prisma'));
  const { name, gender, dateOfBirth, groupId } = req.body;

  const student = await prisma.student.create({
    data: {
      name,
      gender,
      dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null,
      groupId,
    },
  });

  res.status(201).json({ success: true, data: student });
});

router.delete('/students/:id', async (req: Request, res: Response) => {
  const { prisma } = (await import('../../lib/prisma'));
  const student = await prisma.student.update({
    where: { id: req.params.id },
    data: { isActive: false },
  });
  res.json({ success: true, message: 'Student deactivated', data: { id: student.id } });
});

// ═══════════════════════════════════════════════════════════════════
// COMMUNITIES (Create, Read, Delete)
// ═══════════════════════════════════════════════════════════════════

router.get('/communities', async (req: Request, res: Response) => {
  const { prisma } = (await import('../../lib/prisma'));
  const communities = await prisma.community.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      _count: { select: { members: true, groups: true } },
    },
  });
  res.json({ success: true, data: communities });
});

router.get('/communities/:id', async (req: Request, res: Response) => {
  const { prisma } = (await import('../../lib/prisma'));
  const community = await prisma.community.findUnique({
    where: { id: req.params.id },
    include: {
      members: { include: { user: { select: { id: true, name: true, role: true } } } },
      groups: true,
      announcements: { take: 10, orderBy: { createdAt: 'desc' } },
    },
  });
  if (!community) {
    res.status(404).json({ success: false, message: 'Community not found' });
    return;
  }
  res.json({ success: true, data: community });
});

router.post('/communities', async (req: Request, res: Response) => {
  const { prisma } = (await import('../../lib/prisma'));
  const { name, description, academicYear } = req.body;

  const community = await prisma.community.create({
    data: {
      name,
      description,
      academicYear: academicYear || '2025-2026',
    },
  });

  res.status(201).json({ success: true, data: community });
});

router.delete('/communities/:id', async (req: Request, res: Response) => {
  const { prisma } = (await import('../../lib/prisma'));
  // Hard delete with cascade (groups, members, announcements)
  await prisma.community.delete({ where: { id: req.params.id } });
  res.json({ success: true, message: 'Community deleted' });
});

// ═══════════════════════════════════════════════════════════════════
// STATS (Dashboard data)
// ═══════════════════════════════════════════════════════════════════

router.get('/stats', async (req: Request, res: Response) => {
  const { prisma } = (await import('../../lib/prisma'));

  const [users, groups, students, communities, apiKeys] = await Promise.all([
    prisma.user.count({ where: { status: 'active' } }),
    prisma.group.count(),
    prisma.student.count({ where: { isActive: true } }),
    prisma.community.count(),
    prisma.apiKey.count({ where: { revokedAt: null } }),
  ]);

  const userBreakdown = await prisma.user.groupBy({
    by: ['role'],
    where: { status: 'active' },
    _count: { role: true },
  });

  const roleCounts = userBreakdown.reduce((acc: any, item: any) => {
    acc[item.role] = item._count;
    return acc;
  }, {});

  res.json({
    success: true,
    data: {
      totalUsers: users,
      totalGroups: groups,
      totalStudents: students,
      totalCommunities: communities,
      activeApiKeys: apiKeys,
      byRole: roleCounts,
    },
  });
});

export default router;