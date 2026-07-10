/**
 * Teacher portal — Phase E integration tests.
 */
import { prismaMock } from '../../mocks/prisma';
import request from 'supertest';
import app from '../../../src/app';
import { generateTestToken, getAuthHeader } from '../../helpers/auth';
import {
  TEST_AY_ID,
  TEST_BRANCH_ID,
  mockActiveAcademicYear,
  scopeQuery,
} from '../../helpers/integration';
import { mockChatPortalNotifications } from '../../helpers/chat-notifications';

const teacherToken = getAuthHeader(
  generateTestToken('teacher-u1', 'teacher', {
    name: 'Ms. Sarah',
    branchIds: [TEST_BRANCH_ID],
  }),
);

const mockTeacherUser = {
  id: 'teacher-u1',
  name: 'Ms. Sarah',
  role: 'teacher',
  status: 'active',
  profilePhotoId: null,
};

const mockBranchMember = {
  id: 'bm-t1',
  branchId: TEST_BRANCH_ID,
  userId: 'teacher-u1',
  role: 'teacher',
  isActive: true,
};

const mockAssignments = [
  {
    id: 'asgn-1',
    academicYearId: TEST_AY_ID,
    groupId: 'g1',
    subjectId: 'sub1',
    isClassTeacher: true,
    role: 'primary',
    group: { id: 'g1', name: 'Class 5', section: 'A' },
    subject: { id: 'sub1', name: 'Mathematics', code: 'MATH' },
  },
];

function mockTeacherBase(opts?: {
  portalAccess?: string;
  canViewParentContact?: boolean;
  hodSubjects?: string[];
}) {
  mockActiveAcademicYear({
    branch: {
      id: TEST_BRANCH_ID,
      name: 'Test Branch',
      code: 'TST',
      teacherParentContactEnabled: opts?.canViewParentContact ?? false,
      teachersCanMarkAttendance: true,
      teachersCanEnterMarks: true,
    },
  });
  (prismaMock.user.findUnique as jest.Mock).mockResolvedValue(mockTeacherUser);
  (prismaMock.teacherProfile.findUnique as jest.Mock).mockResolvedValue({
    id: 'tp-1',
    portalAccess: opts?.portalAccess ?? 'FULL',
    canViewParentContact: opts?.canViewParentContact ?? false,
    hodParentContactScope: 'ASSIGNED_ONLY',
  });
  (prismaMock.branchMember.findUnique as jest.Mock).mockResolvedValue(mockBranchMember);
  (prismaMock.teacherAssignment.findMany as jest.Mock).mockResolvedValue(mockAssignments);
  (prismaMock.subject.findMany as jest.Mock).mockResolvedValue(
    (opts?.hodSubjects || []).map((id) => ({ id })),
  );
}

describe('Teacher portal — Phase E', () => {
  beforeEach(() => jest.clearAllMocks());

  test('GET /teacher/notifications returns list', async () => {
    mockTeacherBase();
    mockChatPortalNotifications([
      {
        id: 'chat:n1',
        title: 'Test',
        body: 'Hello',
        type: 'announcement',
        isRead: false,
      },
    ]);

    const res = await request(app)
      .get('/teacher/notifications')
      .set(teacherToken)
      .query(scopeQuery);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.unreadCount).toBe(1);
    expect(res.body.data.items).toHaveLength(1);
  });

  test('GET /teacher/hod/department 403 for non-HOD', async () => {
    mockTeacherBase();
    const res = await request(app)
      .get('/teacher/hod/department')
      .set(teacherToken)
      .query(scopeQuery);
    expect(res.status).toBe(403);
  });

  test('GET /teacher/hod/department 200 for HOD', async () => {
    mockTeacherBase({ hodSubjects: ['sub1'] });
    (prismaMock.subject.findMany as jest.Mock)
      .mockResolvedValueOnce([{ id: 'sub1' }])
      .mockResolvedValueOnce([
        {
          id: 'sub1',
          name: 'Mathematics',
          code: 'MATH',
          _count: { teacherAssignments: 2, examClassSubjects: 3 },
        },
      ]);

    const res = await request(app)
      .get('/teacher/hod/department')
      .set(teacherToken)
      .query(scopeQuery);

    expect(res.status).toBe(200);
    expect(res.body.data.subjects).toHaveLength(1);
  });

  test('GET /teacher/classes/:groupId/students includes parent contacts when allowed', async () => {
    mockTeacherBase({ canViewParentContact: true });
    mockActiveAcademicYear({
      branch: {
        id: TEST_BRANCH_ID,
        name: 'Test Branch',
        code: 'TST',
        teacherParentContactEnabled: true,
        teachersCanMarkAttendance: true,
        teachersCanEnterMarks: true,
      },
    });
    (prismaMock.group.findFirst as jest.Mock).mockResolvedValue({
      id: 'g1',
      name: 'Class 5',
      section: 'A',
    });
    (prismaMock.student.findMany as jest.Mock).mockResolvedValue([
      {
        id: 's1',
        name: 'Ali',
        rollNumber: '1',
        admissionNumber: null,
        gender: 'male',
        attendances: [],
      },
    ]);
    (prismaMock.attendance.findMany as jest.Mock).mockResolvedValue([]);
    (prismaMock.studentParent.findMany as jest.Mock).mockResolvedValue([
      {
        studentId: 's1',
        relation: 'Father',
        isPrimary: true,
        parent: {
          phone: '03001234567',
          whatsapp: null,
          user: { name: 'Mr. Ali' },
        },
      },
    ]);

    const res = await request(app)
      .get('/teacher/classes/g1/students')
      .set(teacherToken)
      .query(scopeQuery);

    expect(res.status).toBe(200);
    expect(res.body.data.showParentContacts).toBe(true);
    expect(res.body.data.students[0].parentContacts[0].phone).toBe('03001234567');
  });

  test('PATCH /teacher/notifications/:id/read marks notification', async () => {
    mockTeacherBase();
    (prismaMock.chatMessage.findUnique as jest.Mock).mockResolvedValue({
      id: 'n1',
      roomId: 'room-1',
    });
    (prismaMock.chatRoomMember.findFirst as jest.Mock).mockResolvedValue({
      roomId: 'room-1',
      userId: 'teacher-u1',
      leftAt: null,
      canRead: true,
      room: { isActive: true, academicYearId: TEST_AY_ID },
    });
    (prismaMock.chatMessageReadState.upsert as jest.Mock).mockResolvedValue({});

    const res = await request(app)
      .patch('/teacher/notifications/chat:n1/read')
      .set(teacherToken)
      .query(scopeQuery);

    expect(res.status).toBe(200);
    expect(res.body.data.isRead).toBe(true);
  });
});
