#!/usr/bin/env npx ts-node
/**
 * Live E2E smoke — student + teacher portals against running backend.
 * Writes NDJSON to debug log for session 062214.
 */
import * as fs from 'fs';

const API = process.env.API_URL || 'http://127.0.0.1:5000';
const PUB_KEY =
  process.env.PUBLISHABLE_KEY ||
  'pk_mcs_global_5f93970556e4b7d849f4e6727cc04a690fe5416541f5eef645b541154c402da6';
const LOG_PATH = '/home/hasan/MCS-App/.cursor/debug-062214.log';
const SESSION = '062214';

type Row = {
  sessionId: string;
  runId: string;
  hypothesisId: string;
  location: string;
  message: string;
  data: Record<string, unknown>;
  timestamp: number;
};

function log(
  hypothesisId: string,
  location: string,
  message: string,
  data: Record<string, unknown> = {},
  runId = 'e2e-live',
) {
  const row: Row = { sessionId: SESSION, runId, hypothesisId, location, message, data, timestamp: Date.now() };
  fs.appendFileSync(LOG_PATH, JSON.stringify(row) + '\n');
  console.log(`[${hypothesisId}] ${message}`, data.ok !== undefined ? (data.ok ? 'OK' : 'FAIL') : '');
}

async function login(identifier: string, password: string) {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-publishable-api-key': PUB_KEY,
    },
    body: JSON.stringify({ identifier, password, rememberMe: false }),
  });
  const body = (await res.json()) as any;
  return { status: res.status, body };
}

async function get(path: string, token: string, extraQuery = '') {
  const q = extraQuery ? `?${extraQuery}` : '';
  const res = await fetch(`${API}${path}${q}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'x-publishable-api-key': PUB_KEY,
    },
  });
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

async function writeAttempt(path: string, token: string, method: string) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'x-publishable-api-key': PUB_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({}),
  });
  return res.status;
}

async function studentFlow(username: string, password: string) {
  const loginRes = await login(username, password);
  log('H1', 'e2e:student-login', `login ${username}`, {
    ok: loginRes.status === 200 && loginRes.body?.user?.role === 'student',
    status: loginRes.status,
    role: loginRes.body?.user?.role,
  });
  if (loginRes.status !== 200) return { ok: false };

  const token = loginRes.body.token as string;
  const scope = loginRes.body.scope || loginRes.body.user?.scope;
  const branchId = scope?.branchId || loginRes.body.user?.branchIds?.[0];
  const ayId = scope?.academicYearId || loginRes.body.user?.academicYearId;
  const qs = branchId && ayId ? `branchId=${branchId}&academicYearId=${ayId}` : '';

  const routes = [
    '/student/bootstrap',
    '/student/profile',
    '/student/fees',
    '/student/attendance',
    '/student/results/table',
    '/student/timetable',
    '/student/datesheets',
    '/student/announcements',
    '/student/canteen',
  ];

  let allOk = true;
  for (const route of routes) {
    const r = await get(route, token, qs);
    const ok = r.status === 200 && r.body?.success !== false;
    log('H2', `e2e:${route}`, `GET ${route}`, { ok, status: r.status, success: r.body?.success });
    if (!ok) allOk = false;
  }

  const postStatus = await writeAttempt('/student/fees', token, 'POST');
  log('H3', 'e2e:student-write-guard', 'POST /student/fees blocked', {
    ok: postStatus === 405,
    status: postStatus,
  });

  return { ok: allOk && postStatus === 405, token, qs };
}

async function teacherFlow() {
  const loginRes = await login('fatima_teacher', 'Fatima@123');
  log('H4', 'e2e:teacher-login', 'login fatima_teacher', {
    ok: loginRes.status === 200 && loginRes.body?.user?.role === 'teacher',
    status: loginRes.status,
    role: loginRes.body?.user?.role,
  });
  if (loginRes.status !== 200) return { ok: false };

  const token = loginRes.body.token as string;
  const scope = await resolveTeacherScope(loginRes.body);
  const qs = `branchId=${scope.branchId}&academicYearId=${scope.academicYearId}`;
  log('H4', 'e2e:teacher-scope', 'resolved teacher scope', { ok: Boolean(scope.branchId && scope.academicYearId), ...scope });

  const routes = [
    '/teacher/bootstrap',
    '/teacher/profile',
    '/teacher/timetable',
    '/teacher/announcements',
    '/teacher/notifications',
  ];

  let allOk = true;
  for (const route of routes) {
    const r = await get(route, token, qs);
    const ok = r.status === 200 && r.body?.success !== false;
    log('H4', `e2e:${route}`, `GET ${route}`, { ok, status: r.status });
    if (!ok) allOk = false;
  }
  return { ok: allOk };
}

async function resolveTeacherScope(loginBody: any) {
  const token = loginBody.token as string;
  const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
  const branchId = payload.branchIds?.[0] as string | undefined;
  const ayRes = await fetch(`${API}/me/academic-year`, {
    headers: { Authorization: `Bearer ${token}`, 'x-publishable-api-key': PUB_KEY },
  });
  if (!ayRes.ok) return { branchId: branchId || '', academicYearId: '' };
  const ayBody = (await ayRes.json()) as any;
  return {
    branchId: ayBody?.data?.branchId || branchId || '',
    academicYearId: ayBody?.data?.id || '',
  };
}

async function healthCheck() {
  const res = await fetch(`${API}/health`);
  const ok = res.status === 200;
  log('H0', 'e2e:health', 'backend health', { ok, status: res.status });
  return ok;
}

async function main() {
  try {
    fs.writeFileSync(LOG_PATH, '');
  } catch {
    /* fresh log */
  }

  const health = await healthCheck();
  if (!health) {
    console.error('Backend not healthy');
    process.exit(1);
  }

  const student = await studentFlow('student_ahmed', 'Student@123');
  const teacher = await teacherFlow();

  const summary = { student: student.ok, teacher: teacher.ok };
  log('SUMMARY', 'e2e:summary', 'live E2E complete', summary);

  if (!student.ok || !teacher.ok) process.exit(1);
}

main().catch((e) => {
  log('ERR', 'e2e:fatal', e.message, { ok: false });
  process.exit(1);
});
