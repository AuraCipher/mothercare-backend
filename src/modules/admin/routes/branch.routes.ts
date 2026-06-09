import { Router, Request, Response, NextFunction } from 'express';
import { branchService } from '../services/branch.service';
import { prisma } from '../../../lib/prisma';

const router = Router();

// Helper to wrap async route handlers
const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };

// ─── Branch CRUD ──────────────────────────────────────────────

// POST /admin/branches — Create branch (BA-002)
router.post('/', asyncHandler(async (req: Request, res: Response) => {
  const { name, code, address, phone, email, logoUrl } = req.body;

  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    res.status(400).json({ success: false, message: 'Branch name is required' });
    return;
  }

  if (!code || typeof code !== 'string' || code.trim().length === 0) {
    res.status(400).json({ success: false, message: 'Branch code is required' });
    return;
  }

  const branch = await branchService.create({
    name: name.trim(),
    code: code.trim().toUpperCase(),
    address,
    phone,
    email,
    logoUrl,
  });

  res.status(201).json({ success: true, data: branch });
}));

// GET /admin/branches — List branches (BA-003)
router.get('/', asyncHandler(async (req: Request, res: Response) => {
  const branches = await branchService.findAll();
  res.json({ success: true, data: branches });
}));

// GET /admin/branches/:id — Get branch detail (BA-004)
router.get('/:id', asyncHandler(async (req: Request, res: Response) => {
  const branch = await branchService.findById(req.params.id);
  res.json({ success: true, data: branch });
}));

// PUT /admin/branches/:id — Update branch (BA-005)
router.put('/:id', asyncHandler(async (req: Request, res: Response) => {
  const { name, address, phone, email, logoUrl } = req.body;

  if (name !== undefined && (typeof name !== 'string' || name.trim().length === 0)) {
    res.status(400).json({ success: false, message: 'Branch name cannot be empty' });
    return;
  }

  const branch = await branchService.update(req.params.id, { name, address, phone, email, logoUrl });
  res.json({ success: true, data: branch });
}));

// DELETE /admin/branches/:id — Deactivate branch (BA-006)
router.delete('/:id', asyncHandler(async (req: Request, res: Response) => {
  const result = await branchService.deactivate(req.params.id);
  res.json({ success: true, message: result.message, data: { action: result.action } });
}));

// GET /admin/branches/:id/stats — Per-branch stats for CEO dashboard
router.get('/:id/stats', asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  const [branch, memberCounts, studentCount, groupCount] = await Promise.all([
    prisma.branch.findUnique({
      where: { id },
      select: {
        id: true, name: true, code: true, address: true, phone: true, email: true, isActive: true,
        _count: { select: { academicYears: true, branchMembers: true } },
      },
    }),
    prisma.branchMember.groupBy({
      by: ['role'],
      where: { branchId: id, isActive: true },
      _count: true,
    }),
    prisma.student.count({
      where: {
        academicYear: { branchId: id },
      },
    }),
    prisma.group.count({
      where: {
        academicYear: { branchId: id, status: 'ACTIVE' },
      },
    }),
  ]);

  if (!branch) {
    res.status(404).json({ success: false, message: 'Branch not found' });
    return;
  }

  // Count teachers from branch members
  const totalStaff = memberCounts.reduce((sum, r) => sum + r._count, 0);
  const teacherCount = memberCounts.find(r => r.role === 'teacher')?._count || 0;

  // Get admin info
  const admins = await prisma.branchMember.findMany({
    where: { branchId: id, role: 'branch_admin', isActive: true },
    select: {
      user: { select: { id: true, name: true, email: true, phone: true, status: true } },
      createdAt: true,
    },
  });

  res.json({
    success: true,
    data: {
      ...branch,
      stats: {
        totalStaff,
        totalStudents: studentCount,
        totalTeachers: teacherCount,
        totalClasses: groupCount,
        totalAcademicYears: branch._count.academicYears,
      },
      admins: admins.map(a => ({
        id: a.user.id,
        name: a.user.name,
        email: a.user.email,
        phone: a.user.phone,
        status: a.user.status,
        since: a.createdAt,
      })),
    },
  });
}));

export default router;
