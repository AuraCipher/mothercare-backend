/**
 * Dev teacher portal logins — shared by seed files and scripts/seed-teacher-logins.ts
 *
 * These five teachers already exist in typical MCS seed data (TCH-001 … TCH-005, TCH-102).
 * Passwords are for local / staging only.
 */

export interface TeacherPortalLoginSeed {
  name: string;
  username: string;
  password: string;
  employeeId: string;
  qualification: string;
  specialization: string;
  phone: string;
  joiningDate?: Date;
  /** Group displayOrder (1 = Playgroup, 5 = Class 2, 9 = Class 6, …) */
  groupDisplayOrder?: number;
  groupSection?: string | null;
  /** Assign every subject on the matched group */
  allGroupSubjects?: boolean;
  /** Single-subject assignment when allGroupSubjects is false */
  subjectCode?: string;
  isClassTeacher?: boolean;
}

export const DEFAULT_BRANCH_CODE = 'MCS-SOHAN';

export const SEED_TEACHER_PORTAL_LOGINS: TeacherPortalLoginSeed[] = [
  {
    name: 'Ms. Fatima Ali',
    username: 'fatima_teacher',
    password: 'Fatima@123',
    employeeId: 'TCH-001',
    qualification: 'M.Sc. Mathematics',
    specialization: 'Mathematics',
    phone: '+92 300 1110001',
    groupDisplayOrder: 9,
    subjectCode: 'MATH',
    isClassTeacher: true,
  },
  {
    name: 'Mr. Usman Khan',
    username: 'usman_teacher',
    password: 'Usman@123',
    employeeId: 'TCH-002',
    qualification: 'M.A. English',
    specialization: 'English Literature',
    phone: '+92 300 1110002',
    groupDisplayOrder: 8,
    subjectCode: 'ENG',
    isClassTeacher: false,
  },
  {
    name: 'Ms. Ayesha Ahmed',
    username: 'ayesha_teacher',
    password: 'Ayesha@123',
    employeeId: 'TCH-003',
    qualification: 'M.Sc. Physics',
    specialization: 'Physics',
    phone: '+92 300 1110003',
    groupDisplayOrder: 9,
    subjectCode: 'PHY',
    isClassTeacher: false,
  },
  {
    name: 'Ms. Samina Akhtar',
    username: 'samina_playgroup',
    password: 'Samina@123',
    employeeId: 'TCH-004',
    qualification: 'B.Ed. (Early Childhood Education)',
    specialization: 'Playgroup Lead',
    phone: '+92 300 1111111',
    joiningDate: new Date('2025-08-01'),
    groupDisplayOrder: 1,
    allGroupSubjects: true,
    isClassTeacher: true,
  },
  {
    name: 'Mr. Kamran Haider',
    username: 'kamran_class2',
    password: 'Kamran@123',
    employeeId: 'TCH-102',
    qualification: 'B.Ed. (Primary)',
    specialization: 'Class 2 Head',
    phone: '+92 300 2222222',
    joiningDate: new Date('2025-08-01'),
    groupDisplayOrder: 5,
    allGroupSubjects: true,
    isClassTeacher: true,
  },
];
