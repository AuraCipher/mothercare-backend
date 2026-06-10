import { Router, Request, Response, NextFunction } from 'express';
import { teacherProfileService, teacherAssignmentService } from '../services/teacher.service';

const router = Router();

const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };

// ═══════════════════════════════════════════════════════════════════
// TEACHER PROFILE ROUTES
// ═══════════════════════════════════════════════════════════════════

// TC-011: POST /admin/teachers — Create teacher profile
router.post('/teachers', asyncHandler(async (req: Request, res: Response) => {
  const { userId, employeeId, qualification, specialization, joiningDate, salary, phone, emergencyContact, address, dateOfBirth, gender, bloodGroup } = req.body;

  if (!userId) {
    res.status(400).json({ success: false, message: 'userId is required' });
    return;
  }

  const profile = await teacherProfileService.create({
    userId, employeeId, qualification, specialization, joiningDate, salary, phone, emergencyContact, address, dateOfBirth, gender, bloodGroup,
  });

  res.status(201).json({ success: true, data: profile });
}));

// TC-012: GET /admin/teachers — List teachers with search & filter
router.get('/teachers', asyncHandler(async (req: Request, res: Response) => {
  const { search, qualification, page, limit } = req.query;

  const result = await teacherProfileService.findAll({
    search: search as string,
    qualification: qualification as string,
    page: page ? parseInt(page as string, 10) : 1,
    limit: limit ? parseInt(limit as string, 10) : 20,
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
  const { employeeId, qualification, specialization, joiningDate, salary, phone, emergencyContact, address, dateOfBirth, gender, bloodGroup } = req.body;

  const profile = await teacherProfileService.update(req.params.id, {
    employeeId, qualification, specialization, joiningDate, salary, phone, emergencyContact, address, dateOfBirth, gender, bloodGroup,
  });

  res.json({ success: true, data: profile });
}));

// TC-015: DELETE /admin/teachers/:id — Soft delete (blocks if has assignments)
router.delete('/teachers/:id', asyncHandler(async (req: Request, res: Response) => {
  const result = await teacherProfileService.delete(req.params.id);
  res.json({ success: true, message: result.message });
}));

// TC-016: GET /admin/teachers/:id/assignments — Get teacher's assignments
router.get('/teachers/:id/assignments', asyncHandler(async (req: Request, res: Response) => {
  const assignments = await teacherAssignmentService.findByTeacher(req.params.id);
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

// TC-018: GET /admin/groups/:groupId/assignments — Get assignments for a group
router.get('/groups/:groupId/assignments', asyncHandler(async (req: Request, res: Response) => {
  const assignments = await teacherAssignmentService.findByGroup(req.params.groupId);
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
