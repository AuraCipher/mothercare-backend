/** Academic year statuses that block teacher portal writes. */
export const TEACHER_READ_ONLY_AY_STATUSES = new Set([
  'BUILD_STAGE',
  'ON_HOLD',
  'ARCHIVED',
]);

/** Roles allowed on the teacher portal API. */
export const TEACHER_PORTAL_ROLES = ['teacher'] as const;
