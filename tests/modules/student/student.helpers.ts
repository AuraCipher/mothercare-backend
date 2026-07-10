/**
 * Shared fixtures for student portal integration tests.
 */
import { prismaMock } from '../../mocks/prisma';
import { generateTestToken, getAuthHeader } from '../../helpers/auth';
import { TEST_AY_ID, TEST_BRANCH_ID, mockActiveAcademicYear } from '../../helpers/integration';
import { mockChatAnnouncementFeed } from '../../helpers/chat-announcements';

export const STUDENT_USER_ID = 'student-u1';
export const STUDENT_RECORD_ID = 'stu-1';
export const STUDENT_GROUP_ID = 'g1';

export const studentToken = getAuthHeader(
  generateTestToken(STUDENT_USER_ID, 'student', {
    name: 'Ali Student',
    branchIds: [],
  }),
);

export const adminToken = getAuthHeader(generateTestToken('admin-1', 'super_admin'));

export const teacherToken = getAuthHeader(
  generateTestToken('teacher-u1', 'teacher', {
    name: 'Ms. Sarah',
    branchIds: [TEST_BRANCH_ID],
  }),
);

export const mockStudentUser = {
  id: STUDENT_USER_ID,
  name: 'Ali Student',
  email: null,
  username: 'ali.s',
  role: 'student',
  status: 'active',
  profilePhotoId: null,
};

export const mockStudentRecord = {
  id: STUDENT_RECORD_ID,
  name: 'Ali Student',
  rollNumber: '12',
  userId: STUDENT_USER_ID,
  academicYearId: TEST_AY_ID,
  isActive: true,
  status: 'ACTIVE',
  credentialTag: 'CRED_NONE',
  group: { id: STUDENT_GROUP_ID, name: 'Class 5', section: 'A' },
  academicYear: {
    id: TEST_AY_ID,
    branchId: TEST_BRANCH_ID,
    status: 'ACTIVE',
    calendar: { label: '2025-2026' },
    branch: { id: TEST_BRANCH_ID, name: 'Test Branch', code: 'TST' },
  },
};

export const mockStudentProfileRow = {
  id: STUDENT_RECORD_ID,
  name: 'Ali Student',
  rollNumber: '12',
  admissionDate: new Date('2024-04-01'),
  group: { id: STUDENT_GROUP_ID, name: 'Class 5', section: 'A' },
  academicYear: {
    id: TEST_AY_ID,
    status: 'ACTIVE',
    calendar: { label: '2025-2026' },
  },
  user: { email: null, username: 'ali.s', profilePhotoId: null },
};

export const mockStudentMarksEntry = {
  id: 'me-stu-1',
  marksObtained: 88,
  isAbsent: false,
  examClassSubject: {
    id: 'ecs1',
    totalMarks: 100,
    passingMarks: 40,
    subject: { id: 'sub1', name: 'Mathematics', code: 'MATH' },
    examClass: {
      exam: {
        id: 'exam1',
        name: 'Mid Term',
        examType: { id: 'et1', name: 'Written' },
        examSession: { id: 'sess1', name: 'Term 1' },
      },
    },
  },
};

export function mockStudentPortalReady(options?: { showCanteen?: boolean }) {
  mockActiveAcademicYear();
  (prismaMock.student.findFirst as jest.Mock).mockResolvedValue(mockStudentRecord);

  if (options?.showCanteen) {
    (prismaMock.canteenAccount.findFirst as jest.Mock).mockResolvedValue({
      id: 'ca-1',
      displayName: 'Ali Student',
      runningBalance: 150,
      payments: [],
      sales: [{ id: 'sale-1', totalAmount: 50, paymentType: 'CREDIT', soldAt: new Date() }],
    });
  } else {
    (prismaMock.canteenAccount.findFirst as jest.Mock).mockResolvedValue(null);
  }

  // Set after other mocks — clearAllMocks() in tests must precede this helper.
  (prismaMock.user.findUnique as jest.Mock).mockResolvedValue(mockStudentUser);
}

export function mockStudentReadRoutes() {
  (prismaMock.student.findUnique as jest.Mock).mockResolvedValue(mockStudentProfileRow);
  (prismaMock.studentFee.findMany as jest.Mock).mockResolvedValue([
    {
      id: 'sf-1',
      year: 2026,
      month: 1,
      status: 'PARTIAL',
      netAmount: 500000,
      totalAmount: 500000,
      paidAmount: 200000,
      extraItems: [],
      payments: [
        {
          id: 'pay-1',
          amount: 200000,
          createdAt: new Date('2026-01-10'),
          receiptNumber: 'R-001',
          paymentMethod: 'CASH',
        },
      ],
    },
  ]);
  (prismaMock.attendance.findMany as jest.Mock).mockResolvedValue([
    { date: new Date('2026-01-02'), status: 'present', note: null },
    { date: new Date('2026-01-03'), status: 'absent', note: 'Sick' },
  ]);
  (prismaMock.reportCard.findMany as jest.Mock).mockResolvedValue([
    { examSessionId: 'sess1' },
  ]);
  (prismaMock.marksEntry.findMany as jest.Mock).mockResolvedValue([mockStudentMarksEntry]);
  (prismaMock.timetable.findFirst as jest.Mock).mockResolvedValue({
    id: 'tt-1',
    name: 'Regular Timetable',
  });
  (prismaMock.timetable.findMany as jest.Mock).mockResolvedValue([
    { id: 'ds-1', name: 'Mid Term Datesheet' },
  ]);
  (prismaMock.timetableEntry.findMany as jest.Mock).mockResolvedValue([
    {
      note: null,
      slot: {
        lectureNumber: 1,
        startTime: '08:00',
        endTime: '08:45',
        dayOfWeek: 1,
      },
      subject: { id: 'sub1', name: 'Mathematics', code: 'MATH' },
      teacher: { id: 'teacher-u1', name: 'Ms. Sarah' },
    },
  ]);
  mockChatAnnouncementFeed([
    {
      id: 'ann-1',
      title: 'School holiday',
      content: 'Monday off',
      isPinned: true,
      createdAt: new Date('2026-01-05'),
      scope: 'school',
    },
  ]);
}
