/**
 * Dev student portal logins — shared by seed files and scripts/seed-student-logins.ts
 *
 * Students are matched by name + group displayOrder (+ optional section / roll).
 * Passwords are for local / staging only.
 *
 * Group displayOrder in seeded MCS data (active AY):
 *   2 = Jr Montessori, 6 = Class 3, 10 = Class 7, 12 = Class 9 ARTS
 */

export interface StudentPortalLoginSeed {
  /** Display label in seed output */
  label: string;
  /** Must match the seeded student name in that group */
  studentName: string;
  username: string;
  password: string;
  /** Group displayOrder in the active academic year */
  groupDisplayOrder: number;
  groupSection?: string | null;
  /** Disambiguate when multiple students share a name (optional) */
  rollNumber?: string;
}

export const DEFAULT_STUDENT_PORTAL_PASSWORD = 'Student@123';

export const SEED_STUDENT_PORTAL_LOGINS: StudentPortalLoginSeed[] = [
  {
    label: 'Jr Montessori — Ahmed',
    studentName: 'Ahmed',
    username: 'student_ahmed',
    password: DEFAULT_STUDENT_PORTAL_PASSWORD,
    groupDisplayOrder: 2,
    rollNumber: '1',
  },
  {
    label: 'Jr Montessori — Sara',
    studentName: 'Sara',
    username: 'student_sara',
    password: DEFAULT_STUDENT_PORTAL_PASSWORD,
    groupDisplayOrder: 2,
    rollNumber: '3',
  },
  {
    label: 'Class 3 — Aiman',
    studentName: 'Aiman',
    username: 'student_aiman',
    password: DEFAULT_STUDENT_PORTAL_PASSWORD,
    groupDisplayOrder: 6,
    rollNumber: '1',
  },
  {
    label: 'Class 7 — Abrar',
    studentName: 'Abrar',
    username: 'student_abrar',
    password: DEFAULT_STUDENT_PORTAL_PASSWORD,
    groupDisplayOrder: 10,
    rollNumber: '1',
  },
  {
    label: 'Class 9 ARTS — Adnan',
    studentName: 'Adnan',
    username: 'student_adnan',
    password: DEFAULT_STUDENT_PORTAL_PASSWORD,
    groupDisplayOrder: 12,
    groupSection: 'ARTS',
    rollNumber: '1',
  },
];
