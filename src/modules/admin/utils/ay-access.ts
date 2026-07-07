import type { AcademicYearStatus } from '@prisma/client';
import type { ResolvedModulePermission } from '../staff-permissions.constants';
import { actionAllowed, type CrudAction, type StaffModuleKey } from '../staff-permissions.constants';

export function isArchivedAyStatus(status: AcademicYearStatus): boolean {
  return status === 'ARCHIVED';
}

export function canAccessArchivedAy(perms: ResolvedModulePermission[]): boolean {
  return perms.some((p) => p.archivedCanRead);
}

export function archivedActionAllowed(
  perms: ResolvedModulePermission[],
  module: StaffModuleKey,
  action: CrudAction,
): boolean {
  return actionAllowed(perms, module, action, { archived: true });
}

export function listAccessibleAyStatuses(opts: {
  isFullAdmin: boolean;
  isRestricted: boolean;
  permissions: ResolvedModulePermission[];
}): AcademicYearStatus[] {
  if (!opts.isRestricted || opts.isFullAdmin) {
    return ['ACTIVE', 'BUILD_STAGE', 'ON_HOLD', 'ARCHIVED'];
  }
  const statuses: AcademicYearStatus[] = ['ACTIVE', 'BUILD_STAGE', 'ON_HOLD'];
  if (canAccessArchivedAy(opts.permissions)) statuses.push('ARCHIVED');
  return statuses;
}
