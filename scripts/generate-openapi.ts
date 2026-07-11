#!/usr/bin/env npx ts-node
/**
 * Generates backend/openapi.yaml from Express route files.
 * Run: cd backend && npx ts-node scripts/generate-openapi.ts
 */
import fs from 'fs';
import path from 'path';

const SRC = path.join(__dirname, '../src');

/** File path suffix → API mount prefix (from app.ts + admin.routes.ts) */
const MOUNT_BY_FILE: Record<string, string> = {
  'modules/auth/auth.routes.ts': '/auth',
  'modules/api-key/api-key.routes.ts': '/api-keys',
  'modules/setup/setup.routes.ts': '/setup',
  'modules/admin/routes/invitation.routes.ts': '/admin/invitations',
  'modules/canteen/canteen.routes.ts': '/admin/canteen',
  'modules/admin/routes/admin.routes.ts': '/admin',
  'modules/admin/routes/branch.routes.ts': '/admin/branches',
  'modules/admin/routes/branch-member.routes.ts': '/admin/branches',
  'modules/admin/routes/academic-calendar.routes.ts': '/admin/calendars',
  'modules/admin/routes/academic-year.routes.ts': '/admin',
  'modules/admin/routes/batch-promotion.routes.ts': '/admin',
  'modules/admin/routes/teacher.routes.ts': '/admin',
  'modules/admin/routes/section.routes.ts': '/admin',
  'modules/admin/routes/subject.routes.ts': '/admin',
  'modules/admin/routes/timetable.routes.ts': '/admin',
  'modules/admin/routes/attendance.routes.ts': '/admin',
  'modules/admin/routes/fee.routes.ts': '/admin',
  'modules/admin/routes/student.routes.ts': '/admin',
  'modules/admin/routes/exam-session.routes.ts': '/admin',
  'modules/admin/routes/exam.routes.ts': '/admin',
  'modules/admin/routes/exam-type.routes.ts': '/admin',
  'modules/admin/routes/exam-structure.routes.ts': '/admin',
  'modules/admin/routes/marks-entry.routes.ts': '/admin',
  'modules/admin/routes/subject-result.routes.ts': '/admin',
  'modules/admin/routes/report-card.routes.ts': '/admin',
  'modules/admin/routes/result-analytics.routes.ts': '/admin',
  'modules/admin/routes/result.routes.ts': '/admin/result',
  'modules/admin/routes/staff.routes.ts': '/admin/staff',
  'modules/admin/routes/tenure.routes.ts': '/admin',
  'modules/admin/routes/stationary.routes.ts': '/admin',
  'modules/admin/routes/expenses.routes.ts': '/admin',
  'modules/admin/routes/community-class-role.routes.ts': '/admin/communities',
  'modules/admin/routes/me.routes.ts': '/me',
  'modules/admin/routes/branch-admin.routes.ts': '/branches',
  'modules/teacher/routes/teacher.routes.ts': '/teacher',
  'modules/student/routes/student.routes.ts': '/student',
  'modules/staff/routes/staff.routes.ts': '/staff',
  'modules/chat/routes/chat.routes.ts': '/chat',
  'modules/upload/upload.routes.ts': '/api',
};

const TAG_BY_PREFIX: [string, string][] = [
  ['/auth', 'Authentication'],
  ['/setup', 'Setup'],
  ['/api-keys', 'API Keys'],
  ['/admin/invitations', 'CEO Invitations'],
  ['/admin/canteen', 'Canteen'],
  ['/admin/result', 'Results'],
  ['/admin/staff', 'Staff RBAC'],
  ['/admin/communities', 'Chat Class Roles'],
  ['/admin/branches', 'Branches'],
  ['/admin/calendars', 'Academic Calendars'],
  ['/admin', 'Admin ERP'],
  ['/teacher', 'Teacher Portal'],
  ['/student', 'Student Portal'],
  ['/staff', 'Staff Portal'],
  ['/chat', 'Chat'],
  ['/me', 'Current User'],
  ['/branches', 'Branch Admin'],
  ['/api', 'Uploads'],
];

function walk(dir: string, acc: string[] = []): string[] {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(full, acc);
    else if (ent.name.endsWith('.routes.ts')) acc.push(full);
  }
  return acc;
}

function rel(file: string): string {
  return path.relative(SRC, file).replace(/\\/g, '/');
}

function normalizeExpressPath(routePath: string): string {
  let p = routePath;
  if (!p.startsWith('/')) p = `/${p}`;
  return p.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
}

function joinPaths(prefix: string, route: string): string {
  const r = route.startsWith('/') ? route : `/${route}`;
  if (prefix === '/') return normalizeExpressPath(r);
  const combined = `${prefix}${r}`.replace(/\/+/g, '/');
  return normalizeExpressPath(combined);
}

function tagFor(apiPath: string): string {
  for (const [prefix, tag] of TAG_BY_PREFIX) {
    if (apiPath === prefix || apiPath.startsWith(`${prefix}/`)) return tag;
  }
  return 'System';
}

function authFor(tag: string, apiPath: string): string | null {
  if (apiPath === '/health' || apiPath === '/' || apiPath.startsWith('/setup')) return null;
  if (apiPath === '/auth/login') return null;
  if (apiPath.includes('/admin/invitations/{token}') && !apiPath.includes('complete')) return null;
  if (tag === 'Setup') return null;
  return 'bearerAuth';
}

function collectRoutes(): { method: string; path: string; tag: string; file: string }[] {
  const routes: { method: string; path: string; tag: string; file: string }[] = [];
  const re = /router\.(get|post|put|patch|delete)\(\s*['"`]([^'"`]+)['"`]/gi;

  for (const file of walk(SRC)) {
    const key = rel(file);
    const mount = MOUNT_BY_FILE[key];
    if (!mount) continue;
    const content = fs.readFileSync(file, 'utf8');
    let m: RegExpExecArray | null;
    re.lastIndex = 0;
    while ((m = re.exec(content)) !== null) {
      const method = m[1].toLowerCase();
      const apiPath = joinPaths(mount, m[2]);
      routes.push({ method, path: apiPath, tag: tagFor(apiPath), file: key });
    }
  }

  // app.ts public routes
  routes.push({ method: 'get', path: '/', tag: 'System', file: 'app.ts' });
  routes.push({ method: 'get', path: '/health', tag: 'System', file: 'app.ts' });

  return routes;
}

function yamlEscape(s: string): string {
  return s.replace(/'/g, "''");
}

function buildOpenApi(routes: ReturnType<typeof collectRoutes>): string {
  const byPath = new Map<string, { method: string; tag: string }[]>();
  for (const r of routes) {
    const list = byPath.get(r.path) ?? [];
    list.push({ method: r.method, tag: r.tag });
    byPath.set(r.path, list);
  }

  const sortedPaths = [...byPath.keys()].sort();
  const tags = [...new Set(TAG_BY_PREFIX.map(([, t]) => t).concat(['System']))];

  const lines: string[] = [
    'openapi: 3.1.0',
    'info:',
    '  title: Mother Care School API',
    '  version: 1.0.0',
    '  description: |',
    '    REST API for Mother Care School ERP — admin, teacher, student, staff portals, chat, and file uploads.',
    '    Responses use `{ success: true, data: … }` on success and `{ success: false, message: "…" }` on error.',
    '    Admin routes require `branchId` and `academicYearId` query params unless embedded in the path.',
    '    Generated from Express route files — run `npm run openapi:generate` to refresh.',
    '  contact:',
    '    name: MCS Development',
    'servers:',
    '  - url: http://localhost:5000',
    '    description: Local development',
    '  - url: https://api.example.com',
    '    description: Production (replace with your API host)',
    '',
    'tags:',
    ...tags.map((t) => `  - name: ${t}`),
    '',
    'components:',
    '  securitySchemes:',
    '    bearerAuth:',
    '      type: http',
    '      scheme: bearer',
    '      bearerFormat: JWT',
    '      description: JWT from POST /auth/login — send as `Authorization: Bearer <token>`',
    '  schemas:',
    '    SuccessEnvelope:',
    '      type: object',
    '      properties:',
    '        success:',
    '          type: boolean',
    '          example: true',
    '        data:',
    '          type: object',
    '          additionalProperties: true',
    '    ErrorEnvelope:',
    '      type: object',
    '      properties:',
    '        success:',
    '          type: boolean',
    '          example: false',
    '        message:',
    '          type: string',
    '    LoginRequest:',
    '      type: object',
    '      required: [identifier, password]',
    '      properties:',
    '        identifier:',
    '          type: string',
    '          description: Username, email, or phone',
    '        password:',
    '          type: string',
    '        rememberMe:',
    '          type: boolean',
    '          default: false',
    '  parameters:',
    '    branchId:',
    '      name: branchId',
    '      in: query',
    '      schema:',
    '        type: string',
    '      description: Active branch scope (most admin ERP routes)',
    '    academicYearId:',
    '      name: academicYearId',
    '      in: query',
    '      schema:',
    '        type: string',
    '      description: Active academic year scope (most admin ERP routes)',
    '',
    'paths:',
  ];

  for (const apiPath of sortedPaths) {
    lines.push(`  '${yamlEscape(apiPath)}':`);
    const ops = byPath.get(apiPath)!;
    const opTag = ops[0]?.tag ?? 'System';
    for (const { method } of ops) {
      const sec = authFor(opTag, apiPath);
      lines.push(`    ${method}:`);
      lines.push(`      tags: [${opTag}]`);
      lines.push(`      summary: ${method.toUpperCase()} ${apiPath}`);
      if (sec) lines.push(`      security: [{ bearerAuth: [] }]`);
      if (apiPath === '/auth/login' && method === 'post') {
        lines.push('      requestBody:');
        lines.push('        required: true');
        lines.push('        content:');
        lines.push('          application/json:');
        lines.push('            schema:');
        lines.push('              $ref: "#/components/schemas/LoginRequest"');
      }
      if (apiPath.startsWith('/admin') && !apiPath.includes('{')) {
        lines.push('      parameters:');
        lines.push('        - $ref: "#/components/parameters/branchId"');
        lines.push('        - $ref: "#/components/parameters/academicYearId"');
      }
      lines.push('      responses:');
      lines.push("        '200':");
      lines.push('          description: Success');
      lines.push('          content:');
      lines.push('            application/json:');
      lines.push('              schema:');
      lines.push('                $ref: "#/components/schemas/SuccessEnvelope"');
      lines.push("        '400':");
      lines.push('          description: Validation or business rule error');
      lines.push('          content:');
      lines.push('            application/json:');
      lines.push('              schema:');
      lines.push('                $ref: "#/components/schemas/ErrorEnvelope"');
      lines.push("        '401':");
      lines.push('          description: Missing or invalid JWT');
      lines.push("        '403':");
      lines.push('          description: Forbidden — role or module permission');
      lines.push("        '404':");
      lines.push('          description: Resource not found');
    }
  }

  return `${lines.join('\n')}\n`;
}

const routes = collectRoutes();
const yaml = buildOpenApi(routes);
const out = path.join(__dirname, '../openapi.yaml');
fs.writeFileSync(out, yaml, 'utf8');
console.log(`Wrote ${out} (${routes.length} operations, ${new Set(routes.map((r) => r.path)).size} paths)`);
