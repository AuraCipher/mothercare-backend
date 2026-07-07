export type CarryOptions = {
  classes: boolean;
  subjects: boolean;
  students: boolean;
  teacherAssignments: boolean;
  timetableGrid: boolean;
  datesheets: boolean;
  feeStructures: boolean;
  attendance: boolean;
  examsResults: boolean;
  announcementsMessages: boolean;
};

export const DEFAULT_CARRY_OPTIONS: CarryOptions = {
  classes: true,
  subjects: true,
  students: true,
  teacherAssignments: true,
  timetableGrid: true,
  datesheets: false,
  feeStructures: true,
  attendance: false,
  examsResults: false,
  announcementsMessages: false,
};

export const CARRY_OPTION_LABELS: Record<keyof CarryOptions, string> = {
  classes: 'Classes / sections (+1 promote, lowest empty, highest graduates)',
  subjects: 'Subjects linked to classes',
  students: 'Active students (fixed promotion rules)',
  teacherAssignments: 'Teacher assignments (draft copy)',
  timetableGrid: 'Timetable periods & grid',
  datesheets: 'Datesheets (never carried — always empty)',
  feeStructures: 'Fee structure templates',
  attendance: 'Attendance records',
  examsResults: 'Exams & results',
  announcementsMessages: 'Announcements & messages',
};

/** Rules that cannot be toggled off when students/classes are carried */
export const FIXED_STUDENT_RULES = [
  'Lowest class stays empty in the new year',
  'Highest class students graduate (no new-year record)',
  'All other active students move up one class automatically',
  'Withdrawn / deceased / graduated students are skipped',
] as const;

export function mergeCarryOptions(input?: Partial<CarryOptions>): CarryOptions {
  const merged = { ...DEFAULT_CARRY_OPTIONS, ...input };
  merged.datesheets = false;
  return merged;
}
