/** Academic year statuses that block teacher portal writes. */
export const TEACHER_READ_ONLY_AY_STATUSES = new Set([
  'BUILD_STAGE',
  'ON_HOLD',
  'ARCHIVED',
]);

export const TEACHER_PORTAL_ACCESS = {
  FULL: 'FULL',
  READ_ONLY: 'READ_ONLY',
  FROZEN: 'FROZEN',
} as const;

export type TeacherPortalAccessValue =
  (typeof TEACHER_PORTAL_ACCESS)[keyof typeof TEACHER_PORTAL_ACCESS];

/** Roles allowed on the teacher portal API. */
export const TEACHER_PORTAL_ROLES = ['teacher'] as const;
