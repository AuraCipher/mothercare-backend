/**
 * Dev student portal logins — shared by seed files and scripts/seed-student-logins.ts
 *
 * Students are matched by name + group displayOrder (+ optional section / roll).
 * Passwords are for local / staging only.
 */

export interface StudentPortalLoginSeed {
  /** Display label in seed output */
  label: string;
  /** Must match the seeded student name in that group */
  studentName: string;
  username: string;
  password: string;
  /** Group displayOrder (1 = Playgroup, 5 = Class 2, 9 = Class 6, …) */
  groupDisplayOrder: number;
  groupSection?: string | null;
  /** Disambiguate when multiple students share a name (optional) */
  rollNumber?: string;
}

export const DEFAULT_STUDENT_PORTAL_PASSWORD = 'Student@123';

export const SEED_STUDENT_PORTAL_LOGINS: StudentPortalLoginSeed[] = [
  {
    label: 'Playgroup — Ahmed',
    studentName: 'Ahmed',
    username: 'student_ahmed',
    password: DEFAULT_STUDENT_PORTAL_PASSWORD,
    groupDisplayOrder: 1,
    rollNumber: '1',
  },
  {
    label: 'Playgroup — Sara',
    studentName: 'Sara',
    username: 'student_sara',
    password: DEFAULT_STUDENT_PORTAL_PASSWORD,
    groupDisplayOrder: 1,
    rollNumber: '3',
  },
  {
    label: 'Class 2 — Aiman',
    studentName: 'Aiman',
    username: 'student_aiman',
    password: DEFAULT_STUDENT_PORTAL_PASSWORD,
    groupDisplayOrder: 5,
    rollNumber: '1',
  },
  {
    label: 'Class 6 — Abrar',
    studentName: 'Abrar',
    username: 'student_abrar',
    password: DEFAULT_STUDENT_PORTAL_PASSWORD,
    groupDisplayOrder: 9,
    rollNumber: '1',
  },
  {
    label: 'Class 11 CS — Adnan',
    studentName: 'Adnan',
    username: 'student_adnan',
    password: DEFAULT_STUDENT_PORTAL_PASSWORD,
    groupDisplayOrder: 11,
    groupSection: 'CS',
    rollNumber: '1',
  },
];
