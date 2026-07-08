/**
 * Result & Grade admin routes — integration tests (supertest + mocked services + prismaMock).
 * Covers exam-session, exam-type, exam, exam-structure, marks-entry, subject-result,
 * report-card, and result-analytics HTTP routes.
 */

jest.mock('bcryptjs', () => ({
  hash: jest.fn().mockResolvedValue('$2a$12$mocked_hash_for_testing'),
  compare: jest.fn().mockResolvedValue(true),
}));

jest.mock('../../../src/middleware/security/rateLimiter', () => ({
  passwordSetLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
  uploadLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

jest.mock('../../../src/services/audit.service', () => ({
  logAudit: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../../src/modules/admin/services/staff.service', () => ({
  staffService: {
    resolveUserAccess: jest.fn().mockResolvedValue({ isRestricted: false, isFullAdmin: true, permissions: [] }),
  },
}));

jest.mock('../../../src/modules/admin/services/exam-session.service', () => ({
  examSessionService: {
    findAll: jest.fn().mockResolvedValue([{ id: 'sess1', name: 'Mid Term' }]),
    findById: jest.fn().mockResolvedValue({ id: 'sess1', name: 'Mid Term' }),
    getSummary: jest.fn().mockResolvedValue({ session: { id: 'sess1' }, marksProgress: { total: 0, filled: 0, percent: 0 } }),
    create: jest.fn().mockResolvedValue({ id: 'sess-new', name: 'Final Term' }),
    update: jest.fn().mockResolvedValue({ id: 'sess1', name: 'Updated Session' }),
    delete: jest.fn().mockResolvedValue({ message: 'Exam session deleted' }),
  },
}));

jest.mock('../../../src/modules/admin/services/exam-type.service', () => ({
  examTypeService: {
    findAll: jest.fn().mockResolvedValue([{ id: 'type1', name: 'Written' }]),
    create: jest.fn().mockResolvedValue({ id: 'type-new', name: 'Oral' }),
    update: jest.fn().mockResolvedValue({ id: 'type1', name: 'Updated Type' }),
    delete: jest.fn().mockResolvedValue({ message: 'Exam type deleted' }),
  },
}));

jest.mock('../../../src/modules/admin/services/exam.service', () => ({
  examService: {
    findAllBySession: jest.fn().mockResolvedValue([{ id: 'exam1', name: 'Math Final' }]),
    findById: jest.fn().mockResolvedValue({ id: 'exam1', name: 'Math Final' }),
    create: jest.fn().mockResolvedValue({ id: 'exam-new', name: 'Science Quiz' }),
    update: jest.fn().mockResolvedValue({ id: 'exam1', name: 'Updated Exam' }),
    delete: jest.fn().mockResolvedValue({ message: 'Exam deleted' }),
  },
}));

jest.mock('../../../src/modules/admin/services/exam-structure.service', () => ({
  examStructureService: {
    generateStructure: jest.fn().mockResolvedValue({ examId: 'exam1', classes: [] }),
    getStructure: jest.fn().mockResolvedValue({ examId: 'exam1', classes: [] }),
    toggleClass: jest.fn().mockResolvedValue({ id: 'ec-link1', isActive: false }),
    toggleSubject: jest.fn().mockResolvedValue({ id: 'ecs-link1', isActive: false }),
  },
}));

jest.mock('../../../src/modules/admin/services/marks-entry.service', () => ({
  marksEntryService: {
    getMarksGrid: jest.fn().mockResolvedValue({ totalMarks: 100, students: [] }),
    saveMarks: jest.fn().mockResolvedValue({ totalMarks: 100, students: [{ id: 's1', marksObtained: 85 }] }),
    getEntryForScopeCheck: jest.fn().mockResolvedValue({ examClassSubjectId: 'ecs-link1' }),
    deleteMarksEntry: jest.fn().mockResolvedValue({ message: 'Marks entry deleted' }),
  },
}));

jest.mock('../../../src/modules/admin/services/subject-result.service', () => ({
  subjectResultService: {
    computeForSession: jest.fn().mockResolvedValue({ classSubjectCount: 2, studentCount: 10 }),
    computeForClass: jest.fn().mockResolvedValue([{ studentId: 's1', percentage: 85, grade: 'A' }]),
    getClassResults: jest.fn().mockResolvedValue({ class: { id: 'g1' }, subjects: [], students: [] }),
    getResult: jest.fn().mockResolvedValue({ studentId: 's1', percentage: 85, grade: 'A' }),
  },
}));

jest.mock('../../../src/modules/admin/services/report-card.service', () => ({
  reportCardService: {
    computeForSession: jest.fn().mockResolvedValue({ classCount: 2, reportCardCount: 20 }),
    computeForClass: jest.fn().mockResolvedValue([{ studentId: 's1', overallPercentage: 82 }]),
    getClassReportCards: jest.fn().mockResolvedValue([{ id: 'rc1', studentId: 's1' }]),
    publish: jest.fn().mockResolvedValue({ id: 'rc1', status: 'PUBLISHED' }),
    getReportCard: jest.fn().mockResolvedValue({ id: 'rc1', studentId: 's1', subjectResults: [] }),
  },
}));

jest.mock('../../../src/modules/admin/services/result-analytics.service', () => ({
  resultAnalyticsService: {
    getAnalytics: jest.fn().mockResolvedValue({
      filters: {},
      summary: { marksTotal: 10, marksFilled: 5, marksPercent: 50 },
      passFail: { passed: 8, failed: 2, pending: 0 },
      gradeBreakdown: [],
      subjectAvgs: [],
      sessionTrend: [],
      examTrend: [],
      classTrend: [],
    }),
  },
}));

import request from 'supertest';
import { prismaMock } from '../../mocks/prisma';
import app from '../../../src/app';
import { examSessionService } from '../../../src/modules/admin/services/exam-session.service';
import { examTypeService } from '../../../src/modules/admin/services/exam-type.service';
import { examService } from '../../../src/modules/admin/services/exam.service';
import { examStructureService } from '../../../src/modules/admin/services/exam-structure.service';
import { marksEntryService } from '../../../src/modules/admin/services/marks-entry.service';
import { subjectResultService } from '../../../src/modules/admin/services/subject-result.service';
import { reportCardService } from '../../../src/modules/admin/services/report-card.service';
import { resultAnalyticsService } from '../../../src/modules/admin/services/result-analytics.service';
import { staffService } from '../../../src/modules/admin/services/staff.service';
import { generateTestToken, getAuthHeader } from '../../helpers/auth';
import {
  adminAuth,
  mockActiveAcademicYear,
  scopeQuery,
  TEST_AY_ID,
  TEST_BRANCH_ID,
  type HttpMethod,
} from '../../helpers/integration';

const SESSION_ID = 'sess1';
const TYPE_ID = 'type1';
const EXAM_ID = 'exam1';
const LINK_CLASS_ID = 'ec-link1';
const LINK_SUBJECT_ID = 'ecs-link1';
const CLASS_ID = 'g1';
const SUBJECT_ID = 'sub1';
const STUDENT_ID = 's1';
const ENTRY_ID = 'me1';
const REPORT_CARD_ID = 'rc1';

const validSessionBody = {
  name: 'Mid Term 2026',
  startDate: '2026-01-01',
  endDate: '2026-03-01',
};

const validExamBody = {
  name: 'Math Final',
  examTypeId: TYPE_ID,
  startDate: '2026-02-01',
  endDate: '2026-02-15',
};

const validMarksBody = {
  totalMarks: 100,
  passingMarks: 40,
  entries: [{ studentId: STUDENT_ID, marksObtained: 85 }],
};

interface ResultEndpoint {
  label: string;
  method: HttpMethod;
  path: string;
  body?: Record<string, unknown>;
  successStatus: number;
  extraQuery?: Record<string, string>;
}

const EXAM_SESSION_ENDPOINTS: ResultEndpoint[] = [
  { label: 'GET list exam-sessions', method: 'get', path: '/admin/exam-sessions', successStatus: 200 },
  { label: 'POST create exam-session', method: 'post', path: '/admin/exam-sessions', body: validSessionBody, successStatus: 201 },
  { label: 'GET exam-session by id', method: 'get', path: `/admin/exam-sessions/${SESSION_ID}`, successStatus: 200 },
  { label: 'PATCH exam-session', method: 'patch', path: `/admin/exam-sessions/${SESSION_ID}`, body: { name: 'Updated' }, successStatus: 200 },
  { label: 'DELETE exam-session', method: 'delete', path: `/admin/exam-sessions/${SESSION_ID}`, successStatus: 200 },
];

const RESULT_ENDPOINTS: ResultEndpoint[] = [
  { label: 'GET exam types', method: 'get', path: `/admin/result/sessions/${SESSION_ID}/types`, successStatus: 200 },
  { label: 'POST exam type', method: 'post', path: `/admin/result/sessions/${SESSION_ID}/types`, body: { name: 'Written' }, successStatus: 201 },
  { label: 'PATCH exam type', method: 'patch', path: `/admin/result/sessions/${SESSION_ID}/types/${TYPE_ID}`, body: { name: 'Updated' }, successStatus: 200 },
  { label: 'DELETE exam type', method: 'delete', path: `/admin/result/sessions/${SESSION_ID}/types/${TYPE_ID}`, successStatus: 200 },
  { label: 'GET session summary', method: 'get', path: `/admin/result/sessions/${SESSION_ID}/summary`, successStatus: 200 },
  { label: 'GET session exams', method: 'get', path: `/admin/result/sessions/${SESSION_ID}/exams`, successStatus: 200 },
  { label: 'POST session exam', method: 'post', path: `/admin/result/sessions/${SESSION_ID}/exams`, body: validExamBody, successStatus: 201 },
  { label: 'GET exam by id', method: 'get', path: `/admin/result/exams/${EXAM_ID}`, successStatus: 200 },
  { label: 'PATCH exam', method: 'patch', path: `/admin/result/exams/${EXAM_ID}`, body: { name: 'Updated Exam' }, successStatus: 200 },
  { label: 'DELETE exam', method: 'delete', path: `/admin/result/exams/${EXAM_ID}`, successStatus: 200 },
  { label: 'POST generate structure', method: 'post', path: `/admin/result/exams/${EXAM_ID}/structure`, body: {}, successStatus: 201 },
  { label: 'GET exam structure', method: 'get', path: `/admin/result/exams/${EXAM_ID}/structure`, successStatus: 200 },
  { label: 'PATCH toggle class', method: 'patch', path: `/admin/result/structure/classes/${LINK_CLASS_ID}`, body: { isActive: false }, successStatus: 200 },
  { label: 'PATCH toggle subject', method: 'patch', path: `/admin/result/structure/subjects/${LINK_SUBJECT_ID}`, body: { isActive: false }, successStatus: 200 },
  { label: 'GET marks grid', method: 'get', path: `/admin/result/structure/subjects/${LINK_SUBJECT_ID}/marks-grid`, successStatus: 200 },
  { label: 'POST save marks', method: 'post', path: `/admin/result/structure/subjects/${LINK_SUBJECT_ID}/marks`, body: validMarksBody, successStatus: 200 },
  { label: 'DELETE marks entry', method: 'delete', path: `/admin/result/marks/${ENTRY_ID}`, successStatus: 200 },
  { label: 'POST compute session results', method: 'post', path: `/admin/result/sessions/${SESSION_ID}/compute-results`, successStatus: 200 },
  {
    label: 'POST compute class subject results',
    method: 'post',
    path: `/admin/result/sessions/${SESSION_ID}/classes/${CLASS_ID}/subjects/${SUBJECT_ID}/compute`,
    successStatus: 200,
  },
  { label: 'GET class results', method: 'get', path: `/admin/result/sessions/${SESSION_ID}/classes/${CLASS_ID}/results`, successStatus: 200 },
  {
    label: 'GET student subject result',
    method: 'get',
    path: `/admin/result/students/${STUDENT_ID}/sessions/${SESSION_ID}/subjects/${SUBJECT_ID}`,
    successStatus: 200,
  },
  { label: 'POST compute session report cards', method: 'post', path: `/admin/result/sessions/${SESSION_ID}/compute-report-cards`, successStatus: 200 },
  {
    label: 'POST compute class report cards',
    method: 'post',
    path: `/admin/result/sessions/${SESSION_ID}/classes/${CLASS_ID}/compute-report-cards`,
    successStatus: 200,
  },
  { label: 'GET class report cards', method: 'get', path: `/admin/result/sessions/${SESSION_ID}/classes/${CLASS_ID}/report-cards`, successStatus: 200 },
  { label: 'POST publish report card', method: 'post', path: `/admin/result/report-cards/${REPORT_CARD_ID}/publish`, successStatus: 200 },
  {
    label: 'GET student report card',
    method: 'get',
    path: `/admin/result/students/${STUDENT_ID}/sessions/${SESSION_ID}/report-card`,
    successStatus: 200,
  },
  { label: 'GET analytics', method: 'get', path: '/admin/result/analytics', successStatus: 200 },
  { label: 'GET analytics with session filter', method: 'get', path: '/admin/result/analytics', extraQuery: { sessionId: SESSION_ID }, successStatus: 200 },
];

const ALL_ENDPOINTS = [...EXAM_SESSION_ENDPOINTS, ...RESULT_ENDPOINTS];

function managementAuth(branchIds: string[] = [TEST_BRANCH_ID]) {
  return getAuthHeader(
    generateTestToken('mgmt-1', 'management', { branchIds } as Record<string, unknown>),
  );
}

function mockExamSessionScope() {
  (prismaMock.examSession.findFirst as jest.Mock).mockResolvedValue({
    id: SESSION_ID,
    name: 'Mid Term',
    academicYear: { branchId: TEST_BRANCH_ID },
  });
}

function mockExamInScope() {
  (prismaMock.exam.findFirst as jest.Mock).mockResolvedValue({
    id: EXAM_ID,
    examSessionId: SESSION_ID,
    name: 'Math Final',
  });
}

function mockExamClassInScope() {
  (prismaMock.examClass.findFirst as jest.Mock).mockResolvedValue({ id: LINK_CLASS_ID });
}

function mockExamClassSubjectInScope() {
  (prismaMock.examClassSubject.findFirst as jest.Mock).mockResolvedValue({
    id: LINK_SUBJECT_ID,
    subjectId: SUBJECT_ID,
    examClass: { classId: CLASS_ID, exam: { id: EXAM_ID, examSessionId: SESSION_ID } },
  });
}

function mockGroupInScope() {
  (prismaMock.group.findFirst as jest.Mock).mockResolvedValue({ id: CLASS_ID, name: 'Class 5', section: 'A' });
}

function mockSubjectInScope() {
  (prismaMock.subject.findFirst as jest.Mock).mockResolvedValue({ id: SUBJECT_ID, name: 'Math', code: 'MTH' });
}

function mockAllScopeEntities() {
  mockExamSessionScope();
  mockExamInScope();
  mockExamClassInScope();
  mockExamClassSubjectInScope();
  mockGroupInScope();
  mockSubjectInScope();
}

function resetServiceMocks() {
  (staffService.resolveUserAccess as jest.Mock).mockResolvedValue({
    isRestricted: false,
    isFullAdmin: true,
    permissions: [],
  });

  (examSessionService.findAll as jest.Mock).mockResolvedValue([{ id: SESSION_ID, name: 'Mid Term' }]);
  (examSessionService.findById as jest.Mock).mockResolvedValue({ id: SESSION_ID, name: 'Mid Term' });
  (examSessionService.getSummary as jest.Mock).mockResolvedValue({
    session: { id: SESSION_ID },
    marksProgress: { total: 0, filled: 0, percent: 0 },
  });
  (examSessionService.create as jest.Mock).mockResolvedValue({ id: 'sess-new', name: 'Final Term' });
  (examSessionService.update as jest.Mock).mockResolvedValue({ id: SESSION_ID, name: 'Updated Session' });
  (examSessionService.delete as jest.Mock).mockResolvedValue({ message: 'Exam session deleted' });

  (examTypeService.findAll as jest.Mock).mockResolvedValue([{ id: TYPE_ID, name: 'Written' }]);
  (examTypeService.create as jest.Mock).mockResolvedValue({ id: 'type-new', name: 'Oral' });
  (examTypeService.update as jest.Mock).mockResolvedValue({ id: TYPE_ID, name: 'Updated Type' });
  (examTypeService.delete as jest.Mock).mockResolvedValue({ message: 'Exam type deleted' });

  (examService.findAllBySession as jest.Mock).mockResolvedValue([{ id: EXAM_ID, name: 'Math Final' }]);
  (examService.findById as jest.Mock).mockResolvedValue({ id: EXAM_ID, name: 'Math Final' });
  (examService.create as jest.Mock).mockResolvedValue({ id: 'exam-new', name: 'Science Quiz' });
  (examService.update as jest.Mock).mockResolvedValue({ id: EXAM_ID, name: 'Updated Exam' });
  (examService.delete as jest.Mock).mockResolvedValue({ message: 'Exam deleted' });

  (examStructureService.generateStructure as jest.Mock).mockResolvedValue({ examId: EXAM_ID, classes: [] });
  (examStructureService.getStructure as jest.Mock).mockResolvedValue({ examId: EXAM_ID, classes: [] });
  (examStructureService.toggleClass as jest.Mock).mockResolvedValue({ id: LINK_CLASS_ID, isActive: false });
  (examStructureService.toggleSubject as jest.Mock).mockResolvedValue({ id: LINK_SUBJECT_ID, isActive: false });

  (marksEntryService.getMarksGrid as jest.Mock).mockResolvedValue({ totalMarks: 100, students: [] });
  (marksEntryService.saveMarks as jest.Mock).mockResolvedValue({ totalMarks: 100, students: [{ id: STUDENT_ID, marksObtained: 85 }] });
  (marksEntryService.getEntryForScopeCheck as jest.Mock).mockResolvedValue({ examClassSubjectId: LINK_SUBJECT_ID });
  (marksEntryService.deleteMarksEntry as jest.Mock).mockResolvedValue({ message: 'Marks entry deleted' });

  (subjectResultService.computeForSession as jest.Mock).mockResolvedValue({ classSubjectCount: 2, studentCount: 10 });
  (subjectResultService.computeForClass as jest.Mock).mockResolvedValue([{ studentId: STUDENT_ID, percentage: 85, grade: 'A' }]);
  (subjectResultService.getClassResults as jest.Mock).mockResolvedValue({ class: { id: CLASS_ID }, subjects: [], students: [] });
  (subjectResultService.getResult as jest.Mock).mockResolvedValue({ studentId: STUDENT_ID, percentage: 85, grade: 'A' });

  (reportCardService.computeForSession as jest.Mock).mockResolvedValue({ classCount: 2, reportCardCount: 20 });
  (reportCardService.computeForClass as jest.Mock).mockResolvedValue([{ studentId: STUDENT_ID, overallPercentage: 82 }]);
  (reportCardService.getClassReportCards as jest.Mock).mockResolvedValue([{ id: REPORT_CARD_ID, studentId: STUDENT_ID }]);
  (reportCardService.publish as jest.Mock).mockResolvedValue({ id: REPORT_CARD_ID, status: 'PUBLISHED' });
  (reportCardService.getReportCard as jest.Mock).mockResolvedValue({ id: REPORT_CARD_ID, studentId: STUDENT_ID, subjectResults: [] });

  (resultAnalyticsService.getAnalytics as jest.Mock).mockResolvedValue({
    filters: {},
    summary: { marksTotal: 10, marksFilled: 5, marksPercent: 50 },
    passFail: { passed: 8, failed: 2, pending: 0 },
    gradeBreakdown: [],
    subjectAvgs: [],
    sessionTrend: [],
    examTrend: [],
    classTrend: [],
  });
}

function send(
  ep: ResultEndpoint,
  opts: {
    auth?: { Authorization: string };
    query?: Record<string, string>;
    body?: Record<string, unknown>;
    /** When true (default), merge scopeQuery (branchId + academicYearId). */
    withScope?: boolean;
  } = {},
) {
  const req = request(app)[ep.method](ep.path);
  const withScope = opts.withScope !== false;
  const query = withScope
    ? { ...scopeQuery, ...ep.extraQuery, ...opts.query }
    : { ...ep.extraQuery, ...opts.query };
  if (Object.keys(query).length > 0) req.query(query);
  if (opts.auth) req.set(opts.auth);
  const body = opts.body ?? ep.body;
  if (body && ep.method !== 'get') return req.send(body);
  return req;
}

describe('Result & exam-session admin integration routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetServiceMocks();
    mockActiveAcademicYear();
    mockAllScopeEntities();
  });

  // ─── 401 without auth ───────────────────────────────────────────────

  describe('401 — authentication required', () => {
    test.each(ALL_ENDPOINTS.map((ep) => [ep.label, ep]))('%s', async (_label, ep) => {
      const res = await send(ep, { withScope: false });
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });
  });

  // ─── 400 missing scope ──────────────────────────────────────────────

  describe('400 — missing scope (no academic year)', () => {
    beforeEach(() => {
      (prismaMock.academicYear.findUnique as jest.Mock).mockResolvedValue(null);
      (prismaMock.academicYear.findFirst as jest.Mock).mockResolvedValue(null);
    });

    test.each(ALL_ENDPOINTS.map((ep) => [ep.label, ep]))('%s', async (_label, ep) => {
      const res = await send(ep, {
        auth: adminAuth,
        withScope: false,
        query: { branchId: TEST_BRANCH_ID },
      });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/academic year/i);
    });
  });

  // ─── 404 academic year not found ────────────────────────────────────

  describe('404 — academic year not found', () => {
    beforeEach(() => {
      (prismaMock.academicYear.findUnique as jest.Mock).mockResolvedValue(null);
      (prismaMock.academicYear.findFirst as jest.Mock).mockResolvedValue(null);
    });

    test.each(ALL_ENDPOINTS.map((ep) => [ep.label, ep]))('%s', async (_label, ep) => {
      const res = await send(ep, {
        auth: adminAuth,
        withScope: false,
        query: { branchId: TEST_BRANCH_ID, academicYearId: 'missing-ay' },
      });
      expect(res.status).toBe(404);
      expect(res.body.message).toMatch(/academic year not found/i);
    });
  });

  // ─── 400 branch mismatch ────────────────────────────────────────────

  describe('400 — branchId does not match academic year', () => {
    beforeEach(() => {
      mockActiveAcademicYear({ branchId: 'other-branch' });
    });

    test.each(ALL_ENDPOINTS.map((ep) => [ep.label, ep]))('%s', async (_label, ep) => {
      const res = await send(ep, { auth: adminAuth });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/does not belong/i);
    });
  });

  // ─── 403 management without branch ──────────────────────────────────

  describe('403 — management user without branch access', () => {
    test.each(ALL_ENDPOINTS.map((ep) => [ep.label, ep]))('%s', async (_label, ep) => {
      const res = await send(ep, { auth: managementAuth(['other-branch']) });
      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/access denied/i);
    });
  });

  // ─── 404 exam session not in scope ──────────────────────────────────

  describe('404 — exam session not in scope', () => {
    const sessionScopedEndpoints = ALL_ENDPOINTS.filter(
      (ep) =>
        (ep.path.includes(`/sessions/${SESSION_ID}`) || ep.extraQuery?.sessionId === SESSION_ID)
        && !ep.path.startsWith(`/admin/result/students/`),
    );

    beforeEach(() => {
      (prismaMock.examSession.findFirst as jest.Mock).mockResolvedValue(null);
    });

    test.each(sessionScopedEndpoints.map((ep) => [ep.label, ep]))('%s', async (_label, ep) => {
      const res = await send(ep, { auth: adminAuth });
      expect(res.status).toBe(404);
      expect(res.body.message).toMatch(/exam session not found/i);
    });
  });

  // ─── Success — all endpoints ────────────────────────────────────────

  describe('success — all endpoints with scope', () => {
    test.each(ALL_ENDPOINTS.map((ep) => [ep.label, ep]))('%s', async (_label, ep) => {
      const res = await send(ep, { auth: adminAuth });
      expect(res.status).toBe(ep.successStatus);
      expect(res.body.success).toBe(true);
    });
  });

  // ─── Exam session validation ──────────────────────────────────────────

  describe('POST /admin/exam-sessions — validation', () => {
    const createEp = EXAM_SESSION_ENDPOINTS.find((e) => e.label === 'POST create exam-session')!;

    test.each([
      ['missing name', { startDate: '2026-01-01', endDate: '2026-03-01' }],
      ['empty name', { name: '', startDate: '2026-01-01', endDate: '2026-03-01' }],
      ['whitespace name', { name: '   ', startDate: '2026-01-01', endDate: '2026-03-01' }],
      ['missing startDate', { name: 'Term', endDate: '2026-03-01' }],
      ['missing endDate', { name: 'Term', startDate: '2026-01-01' }],
      ['start after end', { name: 'Term', startDate: '2026-06-01', endDate: '2026-01-01' }],
    ])('400 — %s', async (_label, body) => {
      const res = await send(createEp, { auth: adminAuth, body });
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  describe('PATCH /admin/exam-sessions/:id — validation', () => {
    const patchEp = EXAM_SESSION_ENDPOINTS.find((e) => e.label === 'PATCH exam-session')!;

    test.each([
      ['empty name', { name: '' }],
      ['whitespace name', { name: '  \t  ' }],
      ['start after end', { startDate: '2026-06-01', endDate: '2026-01-01' }],
    ])('400 — %s', async (_label, body) => {
      const res = await send(patchEp, { auth: adminAuth, body });
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  // ─── Exam type validation ───────────────────────────────────────────

  describe('POST /admin/result/sessions/:id/types — validation', () => {
    const createEp = RESULT_ENDPOINTS.find((e) => e.label === 'POST exam type')!;

    test.each([
      ['missing name', {}],
      ['empty name', { name: '' }],
      ['whitespace name', { name: '   ' }],
      ['weight below 0', { name: 'Written', defaultWeight: -1 }],
      ['weight above 100', { name: 'Written', defaultWeight: 101 }],
      ['weight NaN', { name: 'Written', defaultWeight: 'bad' }],
    ])('400 — %s', async (_label, body) => {
      const res = await send(createEp, { auth: adminAuth, body });
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  describe('PATCH /admin/result/sessions/:id/types/:typeId — validation', () => {
    const patchEp = RESULT_ENDPOINTS.find((e) => e.label === 'PATCH exam type')!;

    test.each([
      ['empty name', { name: '' }],
      ['whitespace name', { name: '  ' }],
      ['weight below 0', { defaultWeight: -5 }],
      ['weight above 100', { defaultWeight: 150 }],
    ])('400 — %s', async (_label, body) => {
      const res = await send(patchEp, { auth: adminAuth, body });
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  // ─── Exam validation ────────────────────────────────────────────────

  describe('POST /admin/result/sessions/:id/exams — validation', () => {
    const createEp = RESULT_ENDPOINTS.find((e) => e.label === 'POST session exam')!;

    test.each([
      ['missing name', { examTypeId: TYPE_ID, startDate: '2026-02-01' }],
      ['empty name', { name: '', examTypeId: TYPE_ID, startDate: '2026-02-01' }],
      ['missing examTypeId', { name: 'Quiz', startDate: '2026-02-01' }],
      ['missing startDate', { name: 'Quiz', examTypeId: TYPE_ID }],
      ['end before start', { name: 'Quiz', examTypeId: TYPE_ID, startDate: '2026-03-01', endDate: '2026-02-01' }],
      ['weight below 0', { name: 'Quiz', examTypeId: TYPE_ID, startDate: '2026-02-01', weightOverride: -1 }],
      ['weight above 100', { name: 'Quiz', examTypeId: TYPE_ID, startDate: '2026-02-01', weightOverride: 200 }],
    ])('400 — %s', async (_label, body) => {
      const res = await send(createEp, { auth: adminAuth, body });
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  describe('PATCH /admin/result/exams/:id — validation', () => {
    const patchEp = RESULT_ENDPOINTS.find((e) => e.label === 'PATCH exam')!;

    test.each([
      ['empty name', { name: '' }],
      ['end before start', { startDate: '2026-03-01', endDate: '2026-02-01' }],
      ['weight below 0', { weightOverride: -10 }],
      ['weight above 100', { weightOverride: 110 }],
    ])('400 — %s', async (_label, body) => {
      const res = await send(patchEp, { auth: adminAuth, body });
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  // ─── Structure validation ───────────────────────────────────────────

  describe('PATCH /admin/result/structure/classes/:linkId — validation', () => {
    const patchEp = RESULT_ENDPOINTS.find((e) => e.label === 'PATCH toggle class')!;

    test.each([
      ['missing isActive', {}],
      ['isActive string', { isActive: 'true' }],
      ['isActive number', { isActive: 1 }],
    ])('400 — %s', async (_label, body) => {
      const res = await send(patchEp, { auth: adminAuth, body });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/boolean/i);
    });
  });

  describe('PATCH /admin/result/structure/subjects/:linkId — validation', () => {
    const patchEp = RESULT_ENDPOINTS.find((e) => e.label === 'PATCH toggle subject')!;

    test.each([
      ['missing isActive', {}],
      ['isActive string', { isActive: 'false' }],
      ['isActive null', { isActive: null }],
    ])('400 — %s', async (_label, body) => {
      const res = await send(patchEp, { auth: adminAuth, body });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/boolean/i);
    });
  });

  // ─── Marks entry validation ─────────────────────────────────────────

  describe('POST /admin/result/structure/subjects/:linkId/marks — validation', () => {
    const saveEp = RESULT_ENDPOINTS.find((e) => e.label === 'POST save marks')!;

    test.each([
      ['totalMarks zero', { totalMarks: 0, entries: [{ studentId: STUDENT_ID, marksObtained: 50 }] }],
      ['totalMarks negative', { totalMarks: -10, entries: [{ studentId: STUDENT_ID, marksObtained: 50 }] }],
      ['totalMarks float', { totalMarks: 99.5, entries: [{ studentId: STUDENT_ID, marksObtained: 50 }] }],
      ['empty entries', { totalMarks: 100, entries: [] }],
      ['missing entries', { totalMarks: 100 }],
      ['entries not array', { totalMarks: 100, entries: 'bad' }],
    ])('400 — %s', async (_label, body) => {
      const res = await send(saveEp, { auth: adminAuth, body });
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  describe('DELETE /admin/result/marks/:entryId — not found', () => {
    test('404 when marks entry missing', async () => {
      (marksEntryService.getEntryForScopeCheck as jest.Mock).mockResolvedValue(null);
      const res = await request(app)
        .delete(`/admin/result/marks/${ENTRY_ID}`)
        .query(scopeQuery)
        .set(adminAuth);
      expect(res.status).toBe(404);
      expect(res.body.message).toMatch(/marks entry not found/i);
    });
  });

  // ─── Service invocation checks ──────────────────────────────────────

  describe('service calls on success', () => {
    test('examSessionService.findAll called for list', async () => {
      const res = await send(EXAM_SESSION_ENDPOINTS[0], { auth: adminAuth });
      expect(res.status).toBe(200);
      expect(examSessionService.findAll).toHaveBeenCalledWith(TEST_AY_ID);
    });

    test('examTypeService.create called with session id', async () => {
      const res = await send(RESULT_ENDPOINTS[1], { auth: adminAuth });
      expect(res.status).toBe(201);
      expect(examTypeService.create).toHaveBeenCalledWith(
        SESSION_ID,
        expect.objectContaining({ name: 'Written' }),
        'admin-1',
      );
    });

    test('examService.create called with dates', async () => {
      const res = await send(RESULT_ENDPOINTS[6], { auth: adminAuth });
      expect(res.status).toBe(201);
      expect(examService.create).toHaveBeenCalledWith(
        SESSION_ID,
        expect.objectContaining({ name: 'Math Final', examTypeId: TYPE_ID }),
        'admin-1',
      );
    });

    test('examStructureService.generateStructure called', async () => {
      const res = await send(RESULT_ENDPOINTS[10], { auth: adminAuth });
      expect(res.status).toBe(201);
      expect(examStructureService.generateStructure).toHaveBeenCalledWith(EXAM_ID, 'admin-1', undefined);
    });

    test('marksEntryService.saveMarks called with user id', async () => {
      const res = await send(RESULT_ENDPOINTS[15], { auth: adminAuth });
      expect(res.status).toBe(200);
      expect(marksEntryService.saveMarks).toHaveBeenCalledWith(
        LINK_SUBJECT_ID,
        expect.objectContaining({ totalMarks: 100 }),
        'admin-1',
      );
    });

    test('subjectResultService.computeForSession called', async () => {
      const res = await send(RESULT_ENDPOINTS[17], { auth: adminAuth });
      expect(res.status).toBe(200);
      expect(subjectResultService.computeForSession).toHaveBeenCalledWith(
        SESSION_ID,
        expect.objectContaining({ academicYearId: TEST_AY_ID, branchId: TEST_BRANCH_ID }),
      );
    });

    test('reportCardService.publish called', async () => {
      const res = await send(RESULT_ENDPOINTS[24], { auth: adminAuth });
      expect(res.status).toBe(200);
      expect(reportCardService.publish).toHaveBeenCalledWith(
        REPORT_CARD_ID,
        expect.objectContaining({ academicYearId: TEST_AY_ID }),
      );
    });

    test('resultAnalyticsService.getAnalytics called with filters', async () => {
      const res = await send(RESULT_ENDPOINTS[27], { auth: adminAuth });
      expect(res.status).toBe(200);
      expect(resultAnalyticsService.getAnalytics).toHaveBeenCalledWith(
        expect.objectContaining({ academicYearId: TEST_AY_ID }),
        expect.objectContaining({ sessionId: SESSION_ID }),
      );
    });
  });

  // ─── Analytics query filter variants ────────────────────────────────

  describe('GET /admin/result/analytics — query filters', () => {
    test.each([
      ['no filters', {}],
      ['sessionId only', { sessionId: SESSION_ID }],
      ['examId filter', { examId: EXAM_ID }],
      ['classId filter', { classId: CLASS_ID }],
      ['subjectId filter', { subjectId: SUBJECT_ID }],
      ['session + class', { sessionId: SESSION_ID, classId: CLASS_ID }],
      ['all filters', { sessionId: SESSION_ID, examId: EXAM_ID, classId: CLASS_ID, subjectId: SUBJECT_ID }],
    ])('200 — %s', async (_label, extraQuery) => {
      const res = await request(app)
        .get('/admin/result/analytics')
        .query({ ...scopeQuery, ...extraQuery })
        .set(adminAuth);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(resultAnalyticsService.getAnalytics).toHaveBeenCalled();
    });
  });

  // ─── Exam session supplement tests ────────────────────────────────────

  describe('exam-session routes — supplemental coverage', () => {
    test('GET list returns session array from service', async () => {
      const sessions = [
        { id: 'sess1', name: 'Mid Term' },
        { id: 'sess2', name: 'Final' },
      ];
      (examSessionService.findAll as jest.Mock).mockResolvedValue(sessions);
      const res = await request(app)
        .get('/admin/exam-sessions')
        .query(scopeQuery)
        .set(adminAuth);
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual(sessions);
    });

    test('POST create returns 201 with new session', async () => {
      const created = { id: 'sess-new', name: 'Annual Exam' };
      (examSessionService.create as jest.Mock).mockResolvedValue(created);
      const res = await request(app)
        .post('/admin/exam-sessions')
        .query(scopeQuery)
        .set(adminAuth)
        .send(validSessionBody);
      expect(res.status).toBe(201);
      expect(res.body.data).toEqual(created);
      expect(examSessionService.create).toHaveBeenCalledWith(
        TEST_AY_ID,
        expect.objectContaining({ name: validSessionBody.name }),
        'admin-1',
      );
    });

    test('DELETE returns success message', async () => {
      const res = await request(app)
        .delete(`/admin/exam-sessions/${SESSION_ID}`)
        .query(scopeQuery)
        .set(adminAuth);
      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/deleted/i);
      expect(examSessionService.delete).toHaveBeenCalledWith(SESSION_ID);
    });

    test.each(['sess1', 'sess2', 'sess3', 'sess4', 'sess5'])('GET by id for session %s', async (sessionId) => {
      (examSessionService.findById as jest.Mock).mockResolvedValue({ id: sessionId, name: 'Session' });
      const res = await request(app)
        .get(`/admin/exam-sessions/${sessionId}`)
        .query(scopeQuery)
        .set(adminAuth);
      expect(res.status).toBe(200);
      expect(examSessionService.findById).toHaveBeenCalledWith(sessionId);
    });
  });
});
