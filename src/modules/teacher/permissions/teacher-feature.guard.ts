import type { TeacherContext } from '../services/teacher-context.service';
import { TeacherAccessError } from '../utils/teacher-assignment.guard';
import type { ResolvedTeacherPermissions } from './teacher-permissions.types';

export type TeacherFeatureKey = keyof ResolvedTeacherPermissions['features'];

export function assertFeatureAllowed(
  perms: ResolvedTeacherPermissions,
  feature: TeacherFeatureKey,
  action?: 'view' | 'write' | 'mark' | 'enter' | 'markRead' | 'changePassword',
): void {
  if (perms.isFrozen) {
    throw new TeacherAccessError(403, 'Teacher portal access is frozen');
  }

  const f = perms.features[feature];

  if (!f.allowed) {
    throw new TeacherAccessError(403, f.reason || `Access denied: ${feature}`);
  }

  if (!action) return;

  const actionMap: Record<string, boolean | undefined> = {
    view: 'canView' in f ? f.canView : f.allowed,
    write: undefined,
    mark: 'canMark' in f ? (f as { canMark: boolean }).canMark : undefined,
    enter: 'canEnter' in f ? (f as { canEnter: boolean }).canEnter : undefined,
    markRead: 'canMarkRead' in f ? (f as { canMarkRead: boolean }).canMarkRead : undefined,
    changePassword:
      'canChangePassword' in f ? (f as { canChangePassword: boolean }).canChangePassword : undefined,
  };

  const ok = actionMap[action];
  if (ok === false) {
    throw new TeacherAccessError(403, `Access denied: ${feature}.${action}`);
  }
}

export function canAccessRoute(
  perms: ResolvedTeacherPermissions,
  path: string,
): boolean {
  if (perms.isFrozen) return path === '/teacher' || path === '/teacher/profile';

  if (path === '/teacher' || path.startsWith('/teacher/my-classes') || path.startsWith('/teacher/classes/') || path.startsWith('/teacher/subjects/')) {
    return perms.features.classes.allowed;
  }
  if (path.startsWith('/teacher/timetable')) return perms.features.timetable.allowed;
  if (path.startsWith('/teacher/attendance')) return perms.features.attendance.allowed;
  if (path.startsWith('/teacher/hod')) return perms.features.hod.allowed;
  if (path.startsWith('/teacher/marks')) return perms.features.marks.allowed;
  if (path.startsWith('/teacher/announcements')) return perms.features.announcements.allowed;
  if (path.startsWith('/teacher/notifications')) return perms.features.notifications.allowed;
  if (path.startsWith('/teacher/profile')) return perms.features.profile.allowed;
  return true;
}

export function getTeacherPermissions(ctx: TeacherContext): ResolvedTeacherPermissions {
  return ctx.permissions;
}
