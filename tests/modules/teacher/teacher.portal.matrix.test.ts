/**
 * Teacher portal — high-volume integration matrix (Phase D validation).
 * Parametrized scenarios for access control across routes, AY states, and portal modes.
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

const teacherToken = getAuthHeader(
  generateTestToken('teacher-u1', 'teacher', {
    name: 'Ms. Sarah',
    branchIds: [TEST_BRANCH_ID],
  }),
);

const mockTeacherUser = {
  id: 'teacher-u1',
  name: 'Ms. Sarah',
  email: 'sarah@school.com',
  username: 'sarah',
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

type AyStatus = 'ACTIVE' | 'ARCHIVED' | 'ON_HOLD' | 'BUILD_STAGE';
type PortalAccess = 'FULL' | 'READ_ONLY' | 'FROZEN';
type ReadRoute =
  | 'bootstrap'
  | 'announcements'
  | 'profile'
  | 'timetable'
  | 'students'
  | 'attendance'
  | 'marks_subjects'
  | 'marks_grid';
type WriteRoute = 'attendance_post' | 'marks_post';

function todayDateString() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function mockTeacherProfile(portalAccess: PortalAccess = 'FULL') {
  return {
    id: 'tp-1',
    userId: 'teacher-u1',
    employeeId: 'TCH-001',
    portalAccess,
    canViewParentContact: false,
    hodParentContactScope: 'ASSIGNED_ONLY',
  };
}

function mockAy(status: AyStatus) {
  mockActiveAcademicYear({ status });
}

function mockTeacherBase(portalAccess: PortalAccess) {
  (prismaMock.user.findUnique as jest.Mock).mockResolvedValue(mockTeacherUser);
  (prismaMock.teacherProfile.findUnique as jest.Mock).mockResolvedValue(mockTeacherProfile(portalAccess));
  (prismaMock.branchMember.findUnique as jest.Mock).mockResolvedValue(mockBranchMember);
  (prismaMock.teacherAssignment.findMany as jest.Mock).mockResolvedValue(
    portalAccess === 'FROZEN' ? [] : mockAssignments,
  );
  (prismaMock.subject.findMany as jest.Mock).mockResolvedValue([]);
  (prismaMock.timetable.findFirst as jest.Mock).mockResolvedValue({
    id: 'tt1',
    name: 'Regular Timetable',
    dayConfigs: [{ dayOfWeek: 1 }],
  });
  (prismaMock.timetableEntry.findMany as jest.Mock).mockResolvedValue([]);
  (prismaMock.student.findMany as jest.Mock).mockResolvedValue([
    {
      id: 's1',
      name: 'Ali',
      rollNumber: '1',
      admissionNumber: 'ADM-1',
      gender: 'male',
      examMarks: [],
      attendances: [],
    },
  ]);
  (prismaMock.attendance.findMany as jest.Mock).mockResolvedValue([]);
  (prismaMock.group.findFirst as jest.Mock).mockResolvedValue({
    id: 'g1',
    name: 'Class 5',
    section: 'A',
  });
  (prismaMock.announcement.findMany as jest.Mock).mockResolvedValue([
    {
      id: 'ann-1',
      title: 'Exam week',
      content: 'Mid-term begins Monday',
      mediaUrl: null,
      isPinned: true,
      createdAt: new Date('2026-01-01'),
      senderId: 'admin-1',
      groupId: null,
      group: null,
    },
  ]);
  (prismaMock.user.findMany as jest.Mock).mockResolvedValue([
    { id: 'admin-1', name: 'Principal', role: 'management' },
  ]);
  (prismaMock.examClassSubject.findMany as jest.Mock).mockResolvedValue([]);
  (prismaMock.examClassSubject.findFirst as jest.Mock).mockResolvedValue(null);
  (prismaMock.reportCard.count as jest.Mock).mockResolvedValue(0);
}

async function callReadRoute(route: ReadRoute) {
  switch (route) {
    case 'bootstrap':
      return request(app).get('/teacher/bootstrap').query(scopeQuery).set(teacherToken);
    case 'announcements':
      return request(app).get('/teacher/announcements').query(scopeQuery).set(teacherToken);
    case 'profile':
      return request(app).get('/teacher/profile').query(scopeQuery).set(teacherToken);
    case 'timetable':
      return request(app).get('/teacher/timetable').query(scopeQuery).set(teacherToken);
    case 'students':
      return request(app).get('/teacher/classes/g1/students').query(scopeQuery).set(teacherToken);
    case 'attendance':
      return request(app)
        .get('/teacher/attendance')
        .query({ ...scopeQuery, groupId: 'g1', date: todayDateString() })
        .set(teacherToken);
    case 'marks_subjects':
      return request(app).get('/teacher/marks/subjects').query(scopeQuery).set(teacherToken);
    case 'marks_grid':
      return request(app).get('/teacher/marks/grid/ecs1').query(scopeQuery).set(teacherToken);
    default:
      throw new Error(`Unknown route ${route}`);
  }
}

async function callWriteRoute(route: WriteRoute) {
  if (route === 'attendance_post') {
    return request(app)
      .post('/teacher/attendance/batch')
      .query(scopeQuery)
      .set(teacherToken)
      .send({
        groupId: 'g1',
        date: todayDateString(),
        records: [{ studentId: 's1', status: 'present' }],
      });
  }
  return request(app)
    .post('/teacher/marks/grid/ecs1')
    .query(scopeQuery)
    .set(teacherToken)
    .send({
      totalMarks: 100,
      entries: [{ studentId: 's1', marksObtained: 80, isAbsent: false }],
    });
}

function expectedReadStatus(route: ReadRoute, ay: AyStatus, portal: PortalAccess) {
  if (route === 'bootstrap') return 200;
  if (portal === 'FROZEN') return 403;
  if (route === 'marks_grid') return 404;
  return 200;
}

function expectedWriteBlocked(ay: AyStatus, portal: PortalAccess) {
  if (portal === 'FROZEN') return true;
  if (portal === 'READ_ONLY') return true;
  if (ay !== 'ACTIVE') return true;
  return false;
}

const ayStatuses: AyStatus[] = ['ACTIVE', 'ARCHIVED', 'ON_HOLD', 'BUILD_STAGE'];
const portalModes: PortalAccess[] = ['FULL', 'READ_ONLY', 'FROZEN'];
const readRoutes: ReadRoute[] = [
  'bootstrap',
  'announcements',
  'profile',
  'timetable',
  'students',
  'attendance',
  'marks_subjects',
  'marks_grid',
];
const writeRoutes: WriteRoute[] = ['attendance_post', 'marks_post'];
const iterations = Array.from({ length: 6 }, (_, i) => i + 1);

describe('Teacher portal — read route matrix', () => {
  beforeEach(() => jest.clearAllMocks());

  for (const ay of ayStatuses) {
    for (const portal of portalModes) {
      for (const route of readRoutes) {
        for (const n of iterations) {
          test(`GET ${route} ay=${ay} portal=${portal} [${n}]`, async () => {
            mockAy(ay);
            mockTeacherBase(portal);
            const res = await callReadRoute(route);
            expect(res.status).toBe(expectedReadStatus(route, ay, portal));
            if (route === 'bootstrap' && res.status === 200) {
              expect(res.body.data.portal.portalAccess).toBe(portal);
              if (portal === 'FROZEN') {
                expect(res.body.data.portal.isFrozen).toBe(true);
                expect(res.body.data.assignments).toHaveLength(0);
              }
            }
          });
        }
      }
    }
  }
});

describe('Teacher portal — write route matrix', () => {
  beforeEach(() => jest.clearAllMocks());

  for (const ay of ayStatuses) {
    for (const portal of portalModes) {
      for (const route of writeRoutes) {
        for (const n of iterations) {
          test(`POST ${route} ay=${ay} portal=${portal} [${n}]`, async () => {
            mockAy(ay);
            mockTeacherBase(portal);
            if (route === 'marks_post') {
              (prismaMock.examClassSubject.findFirst as jest.Mock).mockResolvedValue({
                id: 'ecs1',
                subjectId: 'sub1',
                subject: { id: 'sub1', name: 'Math', code: 'MATH' },
                examClass: {
                  classId: 'g1',
                  class: { id: 'g1', name: 'Class 5', section: 'A' },
                  exam: {
                    id: 'exam1',
                    name: 'Mid',
                    status: 'DRAFT',
                    teacherMarksEntry: true,
                    examSessionId: 'sess1',
                  },
                },
              });
            }
            if (route === 'attendance_post' && portal === 'FULL' && ay === 'ACTIVE') {
              (prismaMock.attendance.upsert as jest.Mock).mockResolvedValue({});
            }
            const res = await callWriteRoute(route);
            if (expectedWriteBlocked(ay, portal)) {
              expect(res.status).toBe(403);
            } else {
              expect(res.status).not.toBe(403);
            }
            if (portal === 'FROZEN') {
              expect(res.body.message).toMatch(/frozen/i);
            }
          });
        }
      }
    }
  }
});

describe('Teacher portal — announcements payload matrix', () => {
  beforeEach(() => jest.clearAllMocks());

  for (const n of Array.from({ length: 50 }, (_, i) => i + 1)) {
    test(`announcements list shape [${n}]`, async () => {
      mockAy('ACTIVE');
      mockTeacherBase('FULL');
      const res = await request(app).get('/teacher/announcements').query(scopeQuery).set(teacherToken);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      if (res.body.data.length > 0) {
        expect(res.body.data[0]).toMatchObject({
          id: expect.any(String),
          title: expect.any(String),
          scope: 'school',
          sender: expect.objectContaining({ name: expect.any(String) }),
        });
      }
    });
  }
});

describe('Teacher portal — IDOR matrix', () => {
  beforeEach(() => jest.clearAllMocks());

  const foreignGroups = ['g2', 'g3', 'g4', 'g5', 'other-group'];
  for (const groupId of foreignGroups) {
    for (const n of iterations) {
      test(`students forbidden for ${groupId} [${n}]`, async () => {
        mockAy('ACTIVE');
        mockTeacherBase('FULL');
        const res = await request(app)
          .get(`/teacher/classes/${groupId}/students`)
          .query(scopeQuery)
          .set(teacherToken);
        expect(res.status).toBe(403);
      });
    }
  }
});
