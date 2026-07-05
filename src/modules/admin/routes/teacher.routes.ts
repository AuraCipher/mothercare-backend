import { Router, Request, Response, NextFunction } from 'express';
import { teacherProfileService, teacherAssignmentService } from '../services/teacher.service';
import { passwordSetLimiter } from '../../../middleware/security/rateLimiter';
import { requireScope } from '../utils/scope-context';

const router = Router();

const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };

// ═══════════════════════════════════════════════════════════════════
// TEACHER PROFILE ROUTES
// ═══════════════════════════════════════════════════════════════════

// TC-011: POST /admin/teachers — Create teacher profile
// Accepts either: userId (existing user) OR name+username+password (auto-create user)
router.post('/teachers', asyncHandler(async (req: Request, res: Response) => {
  const { userId, name, username, password, email, branchId, employeeId, qualification, specialization, joiningDate, salary, phone, emergencyContact, address, dateOfBirth, gender, bloodGroup, fatherName, cardId, severeDisease, experience, bio, profilePhotoId } = req.body;

  if (!userId && (!name || !username)) {
    res.status(400).json({ success: false, message: 'Provide either userId (existing user) or name+username (create new user)' });
    return;
  }

  const profile = await teacherProfileService.create({
    userId, name, username, password, email, branchId, employeeId, qualification, specialization, joiningDate, salary, phone, emergencyContact, address, dateOfBirth, gender, bloodGroup, fatherName, cardId, severeDisease, experience, bio,
    createdById: (req as any).user?.id,
  });

  res.status(201).json({ success: true, data: profile });
}));

// TC-012: GET /admin/teachers — List teachers (branch-scoped when branchId provided)
router.get('/teachers', asyncHandler(async (req: Request, res: Response) => {
  const { search, qualification, page, limit, branchId } = req.query;

  const result = await teacherProfileService.findAll({
    search: search as string,
    qualification: qualification as string,
    page: page ? parseInt(page as string, 10) : 1,
    limit: limit ? parseInt(limit as string, 10) : 20,
    branchId: branchId as string | undefined,
  });

  res.json({ success: true, ...result });
}));

// TC-013: GET /admin/teachers/:id — Get teacher profile with assignments
router.get('/teachers/:id', asyncHandler(async (req: Request, res: Response) => {
  const profile = await teacherProfileService.findById(req.params.id);
  res.json({ success: true, data: profile });
}));

// TC-014: PUT /admin/teachers/:id — Update teacher profile
router.put('/teachers/:id', asyncHandler(async (req: Request, res: Response) => {
  const { employeeId, qualification, specialization, joiningDate, salary, phone, emergencyContact, address, dateOfBirth, gender, bloodGroup, fatherName, cardId, severeDisease, experience, bio, profilePhotoId } = req.body;

  const profile = await teacherProfileService.update(req.params.id, {
    employeeId, qualification, specialization, joiningDate, salary, phone, emergencyContact, address, dateOfBirth, gender, bloodGroup, fatherName, cardId, severeDisease, experience, bio, profilePhotoId,
    updatedById: (req as any).user?.id,
  });

  res.json({ success: true, data: profile });
}));

// TC-015: DELETE /admin/teachers/:id — Hard delete (only if zero assignments ever)
router.delete('/teachers/:id', asyncHandler(async (req: Request, res: Response) => {
  const result = await teacherProfileService.delete(req.params.id);
  res.json({ success: true, message: result.message });
}));

// POST /admin/teachers/:id/deactivate — Deactivate (ends assignments, preserves history)
router.post('/teachers/:id/deactivate', asyncHandler(async (req: Request, res: Response) => {
  const result = await teacherProfileService.deactivate(req.params.id);
  res.json({ success: true, message: result.message });
}));

// POST /admin/teachers/:id/reactivate — Reactivate a deactivated teacher
router.post('/teachers/:id/reactivate', asyncHandler(async (req: Request, res: Response) => {
  const result = await teacherProfileService.reactivate(req.params.id);
  res.json({ success: true, message: result.message });
}));

// POST /admin/teachers/:id/set-password — Set teacher password (admin must verify)
router.post('/teachers/:id/set-password', passwordSetLimiter, asyncHandler(async (req: Request, res: Response) => {
  const { newPassword, adminPassword } = req.body;
  const adminId = (req as any).user?.id;

  if (!newPassword || !adminPassword) {
    res.status(400).json({ success: false, message: 'newPassword and adminPassword are required' });
    return;
  }

  const result = await teacherProfileService.setPassword(req.params.id, newPassword, adminId, adminPassword, req.ip);
  res.json({ success: true, message: result.message });
}));

// POST /admin/teachers/:id/send-credentials — Send via WhatsApp
router.post('/teachers/:id/send-credentials', asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).user?.id;
  const result = await teacherProfileService.sendCredentials(req.params.id, userId, req.ip);
  res.json({ success: true, data: result });
}));

// TC-016: GET /admin/teachers/:id/assignments — Get teacher's assignments (AY scoped)
router.get('/teachers/:id/assignments', asyncHandler(async (req: Request, res: Response) => {
  const scope = await requireScope(req, res);
  if (!scope) return;
  const assignments = await teacherAssignmentService.findByTeacher(req.params.id, scope.academicYearId);
  res.json({ success: true, data: assignments });
}));

// ═══════════════════════════════════════════════════════════════════
// ASSIGNMENT ROUTES
// ═══════════════════════════════════════════════════════════════════

// TC-017: POST /admin/assignments — Create assignment
router.post('/assignments', asyncHandler(async (req: Request, res: Response) => {
  const { academicYearId, teacherId, groupId, subjectId, isClassTeacher } = req.body;

  if (!academicYearId || !teacherId || !groupId || !subjectId) {
    res.status(400).json({ success: false, message: 'academicYearId, teacherId, groupId, and subjectId are required' });
    return;
  }

  const assignment = await teacherAssignmentService.create({
    academicYearId, teacherId, groupId, subjectId, isClassTeacher,
  });

  res.status(201).json({ success: true, data: assignment });
}));

// TC-018: GET /admin/groups/:groupId/assignments — Get assignments for a group (AY scoped)
router.get('/groups/:groupId/assignments', asyncHandler(async (req: Request, res: Response) => {
  const scope = await requireScope(req, res);
  if (!scope) return;
  const assignments = await teacherAssignmentService.findByGroup(req.params.groupId, scope.academicYearId);
  res.json({ success: true, data: assignments });
}));

// TC-019: PUT /admin/assignments/:id — Update assignment (isClassTeacher)
router.put('/assignments/:id', asyncHandler(async (req: Request, res: Response) => {
  const { isClassTeacher } = req.body;

  const assignment = await teacherAssignmentService.update(req.params.id, { isClassTeacher });
  res.json({ success: true, data: assignment });
}));

// TC-020: DELETE /admin/assignments/:id — Delete assignment
router.delete('/assignments/:id', asyncHandler(async (req: Request, res: Response) => {
  const result = await teacherAssignmentService.delete(req.params.id);
  res.json({ success: true, message: result.message });
}));

export default router;
