import { Router, Request, Response, NextFunction } from 'express';
import { requireScope } from '../utils/scope-context';
import {
  assignClassRole,
  createClassRoleDefinition,
  deleteClassRoleDefinition,
  getActiveCommunityOrThrow,
  listClassRoleDefinitions,
  removeClassRoleAssignment,
  resolveCommunityByGroupId,
  updateClassRoleDefinition,
} from '../../chat/services/class-role.service';

const router = Router();

const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch((err) => {
      if (err?.status && err?.message) {
        res.status(err.status).json({ success: false, message: err.message });
        return;
      }
      next(err);
    });
  };

async function assertAdminCommunityScope(req: Request, res: Response, communityId: string) {
  const scope = await requireScope(req, res);
  if (!scope) return null;

  const community = await getActiveCommunityOrThrow(communityId);
  if (community.academicYearId !== scope.academicYearId) {
    res.status(400).json({
      success: false,
      message: 'Community does not belong to the selected academic year',
    });
    return null;
  }
  if (community.academicYear.branchId !== scope.branchId) {
    res.status(403).json({ success: false, message: 'Community is outside branch scope' });
    return null;
  }
  return { scope, community };
}

router.get(
  '/by-group/:groupId',
  asyncHandler(async (req, res) => {
    const scope = await requireScope(req, res);
    if (!scope) return;
    const data = await resolveCommunityByGroupId(req.params.groupId, scope.academicYearId);
    res.json({ success: true, data });
  }),
);

router.get(
  '/:communityId/roles',
  asyncHandler(async (req, res) => {
    const ctx = await assertAdminCommunityScope(req, res, req.params.communityId);
    if (!ctx) return;
    const data = await listClassRoleDefinitions(req.params.communityId);
    res.json({ success: true, data });
  }),
);

router.post(
  '/:communityId/roles',
  asyncHandler(async (req, res) => {
    const ctx = await assertAdminCommunityScope(req, res, req.params.communityId);
    if (!ctx) return;
    const user = (req as any).user;
    const { name, description, canPostInGroups, canReceiveDms, canInitiateDms } = req.body ?? {};
    const data = await createClassRoleDefinition({
      communityId: req.params.communityId,
      name,
      description,
      canPostInGroups,
      canReceiveDms,
      canInitiateDms,
      createdById: user.id,
    });
    res.status(201).json({ success: true, data });
  }),
);

router.patch(
  '/:communityId/roles/:roleId',
  asyncHandler(async (req, res) => {
    const ctx = await assertAdminCommunityScope(req, res, req.params.communityId);
    if (!ctx) return;
    const { name, description, canPostInGroups, canReceiveDms, canInitiateDms } = req.body ?? {};
    const data = await updateClassRoleDefinition({
      communityId: req.params.communityId,
      roleDefinitionId: req.params.roleId,
      name,
      description,
      canPostInGroups,
      canReceiveDms,
      canInitiateDms,
    });
    res.json({ success: true, data });
  }),
);

router.delete(
  '/:communityId/roles/:roleId',
  asyncHandler(async (req, res) => {
    const ctx = await assertAdminCommunityScope(req, res, req.params.communityId);
    if (!ctx) return;
    await deleteClassRoleDefinition({
      communityId: req.params.communityId,
      roleDefinitionId: req.params.roleId,
    });
    res.json({ success: true, message: 'Role deleted' });
  }),
);

router.post(
  '/:communityId/roles/:roleId/assign',
  asyncHandler(async (req, res) => {
    const ctx = await assertAdminCommunityScope(req, res, req.params.communityId);
    if (!ctx) return;
    const user = (req as any).user;
    const { studentId, publicDisplayName, isMessagingRestricted } = req.body ?? {};
    if (!studentId) {
      res.status(400).json({ success: false, message: 'studentId is required' });
      return;
    }
    const data = await assignClassRole({
      communityId: req.params.communityId,
      roleDefinitionId: req.params.roleId,
      studentId,
      publicDisplayName,
      isMessagingRestricted,
      assignedById: user.id,
    });
    res.status(201).json({ success: true, data });
  }),
);

router.delete(
  '/:communityId/assignments/:assignmentId',
  asyncHandler(async (req, res) => {
    const ctx = await assertAdminCommunityScope(req, res, req.params.communityId);
    if (!ctx) return;
    const user = (req as any).user;
    await removeClassRoleAssignment({
      communityId: req.params.communityId,
      assignmentId: req.params.assignmentId,
      removedById: user.id,
    });
    res.json({ success: true, message: 'Assignment removed' });
  }),
);

export default router;
