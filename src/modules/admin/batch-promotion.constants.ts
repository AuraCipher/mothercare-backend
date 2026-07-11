export type CarryOptions = {
  classes: boolean;
  subjects: boolean;
  students: boolean;
  teacherAssignments: boolean;
  timetableGrid: boolean;
  datesheets: boolean;
  feeStructures: boolean;
  /** @deprecated Not implemented — kept for legacy run JSON only */
  attendance?: boolean;
  /** @deprecated Not implemented — kept for legacy run JSON only */
  examsResults?: boolean;
  /** @deprecated Not implemented — kept for legacy run JSON only */
  announcementsMessages?: boolean;
};

/** Carry toggles shown in the admin promotion wizard */
export const PROMOTION_UI_CARRY_KEYS = [
  'classes',
  'subjects',
  'students',
  'teacherAssignments',
  'timetableGrid',
  'feeStructures',
] as const;

export type PromotionUiCarryKey = (typeof PROMOTION_UI_CARRY_KEYS)[number];

export const DEFAULT_CARRY_OPTIONS: CarryOptions = {
  classes: true,
  subjects: true,
  students: true,
  teacherAssignments: true,
  timetableGrid: true,
  datesheets: false,
  feeStructures: true,
};

export const CARRY_OPTION_LABELS: Record<PromotionUiCarryKey | 'datesheets', string> = {
  classes: 'Classes / sections (+1 promote, lowest empty, highest graduates)',
  subjects: 'Subjects linked to classes',
  students: 'Active students (fixed promotion rules)',
  teacherAssignments: 'Teacher assignments (draft copy)',
  timetableGrid: 'Timetable periods & grid',
  datesheets: 'Datesheets (never carried — always empty)',
  feeStructures: 'Fee structure templates',
};

/** Rules that cannot be toggled off when students/classes are carried */
export const FIXED_STUDENT_RULES = [
  'Lowest class stays empty in the new year',
  'Highest class students graduate (no new-year record)',
  'All other active students move up one class automatically',
  'Promoted students keep their existing login credentials in the new year',
  'Withdrawn / deceased / graduated students are skipped',
] as const;

export function mergeCarryOptions(input?: Partial<CarryOptions>): CarryOptions {
  const merged = { ...DEFAULT_CARRY_OPTIONS, ...input };
  merged.datesheets = false;
  return merged;
}
