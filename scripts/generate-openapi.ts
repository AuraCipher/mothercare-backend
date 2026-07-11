#!/usr/bin/env npx ts-node
/**
 * Generates backend/openapi.yaml from Express route files + Zod/schema registry.
 * Run: cd backend && npm run openapi:generate
 */
import fs from 'fs';
import path from 'path';
import {
  buildComponentSchemas,
  countCoverage,
  emitSchemaObjectLines,
  extractPathParams,
  parseValidateSchemas,
  schemaRef,
  yamlEscape,
} from './openapi/openapi-utils';
import { resolveOperation, operationKey, type OperationSpec } from './openapi/schema-registry';

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

interface RouteEntry {
  method: string;
  path: string;
  tag: string;
  file: string;
  mount: string;
  routePath: string;
}

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
  const normalized = normalizeExpressPath(combined);
  // OpenAPI convention: no trailing slash except root
  if (normalized.length > 1 && normalized.endsWith('/')) {
    return normalized.slice(0, -1);
  }
  return normalized;
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

/** Per-file validate(schema) discoveries keyed by "method routePath" (express style) */
const validateByFile = new Map<string, Map<string, string>>();

function collectRoutes(): RouteEntry[] {
  const routes: RouteEntry[] = [];
  const re = /router\.(get|post|put|patch|delete)\(\s*['"`]([^'"`]+)['"`]/gi;

  for (const file of walk(SRC)) {
    const key = rel(file);
    const mount = MOUNT_BY_FILE[key];
    if (!mount) continue;
    const content = fs.readFileSync(file, 'utf8');
    validateByFile.set(key, parseValidateSchemas(content));
    let m: RegExpExecArray | null;
    re.lastIndex = 0;
    while ((m = re.exec(content)) !== null) {
      const method = m[1].toLowerCase();
      const routePath = m[2];
      const apiPath = joinPaths(mount, routePath);
      routes.push({ method, path: apiPath, tag: tagFor(apiPath), file: key, mount, routePath });
    }
  }

  routes.push({ method: 'get', path: '/', tag: 'System', file: 'app.ts', mount: '', routePath: '/' });
  routes.push({ method: 'get', path: '/health', tag: 'System', file: 'app.ts', mount: '', routePath: '/health' });

  return dedupeRoutes(routes);
}

/** Express uses the first registered handler for duplicate method+path pairs */
function dedupeRoutes(routes: RouteEntry[]): RouteEntry[] {
  const seen = new Map<string, RouteEntry>();
  for (const r of routes) {
    const key = `${r.method} ${r.path}`;
    if (!seen.has(key)) seen.set(key, r);
  }
  return [...seen.values()];
}

function resolveRouteSpec(route: RouteEntry): OperationSpec {
  const registrySpec = resolveOperation(route.method, route.path);
  const fileValidates = validateByFile.get(route.file);
  const validateKey = `${route.method} ${route.routePath}`;
  const validateRequest = fileValidates?.get(validateKey);
  if (validateRequest) {
    return { ...registrySpec, requestBody: registrySpec.requestBody === 'JsonObjectRequest' ? validateRequest : (registrySpec.requestBody ?? validateRequest) };
  }
  return registrySpec;
}

function needsAdminScope(apiPath: string, spec?: OperationSpec): boolean {
  if (spec?.skipAdminScope) return false;
  return apiPath.startsWith('/admin') && !apiPath.includes('{');
}

function emitParameters(apiPath: string, spec?: OperationSpec): string[] {
  const lines: string[] = [];
  const pathParams = extractPathParams(apiPath);
  const hasQuery = needsAdminScope(apiPath, spec) || (spec?.queryParams?.length ?? 0) > 0;

  if (pathParams.length === 0 && !hasQuery) return lines;

  lines.push('      parameters:');
  for (const name of pathParams) {
    lines.push(`        - name: ${name}`);
    lines.push('          in: path');
    lines.push('          required: true');
    lines.push('          schema:');
    lines.push('            type: string');
  }
  if (needsAdminScope(apiPath, spec)) {
    lines.push('        - $ref: "#/components/parameters/branchId"');
    lines.push('        - $ref: "#/components/parameters/academicYearId"');
  }
  for (const qp of spec?.queryParams ?? []) {
    lines.push(`        - name: ${qp.name}`);
    lines.push('          in: query');
    if (qp.required) lines.push('          required: true');
    lines.push('          schema:');
    if (qp.schema === 'integer') {
      lines.push('            type: integer');
    } else if (qp.schema === 'boolean') {
      lines.push('            type: boolean');
    } else {
      lines.push('            type: string');
    }
    if (qp.description) lines.push(`          description: ${qp.description}`);
  }
  return lines;
}

function emitRequestBody(schemaName: string): string[] {
  return [
    '      requestBody:',
    '        required: true',
    '        content:',
    '          application/json:',
    '            schema:',
    `              $ref: "${schemaRef(schemaName)}"`,
  ];
}

function emitResponses(spec: OperationSpec | undefined, method: string): string[] {
  const successStatus = spec?.successStatus ?? (method === 'post' ? 200 : 200);
  const statusKey = method === 'delete' && !spec?.response ? '204' : String(successStatus);
  const responseSchema = spec?.response;

  const lines: string[] = ['      responses:'];

  if (method === 'delete' && !responseSchema) {
    lines.push("        '204':");
    lines.push('          description: Deleted successfully');
  } else {
    lines.push(`        '${statusKey}':`);
    lines.push('          description: Success');
    if (responseSchema) {
      lines.push('          content:');
      lines.push('            application/json:');
      lines.push('              schema:');
      lines.push(`                $ref: "${schemaRef(responseSchema)}"`);
    }
  }

  lines.push("        '400':");
  lines.push('          description: Validation or business rule error');
  lines.push('          content:');
  lines.push('            application/json:');
  lines.push('              schema:');
  lines.push(`                $ref: "${schemaRef('ErrorEnvelope')}"`);
  lines.push("        '401':");
  lines.push('          description: Missing or invalid JWT');
  lines.push("        '403':");
  lines.push('          description: Forbidden — role or module permission');
  lines.push("        '404':");
  lines.push('          description: Resource not found');
  lines.push("        '422':");
  lines.push('          description: Zod validation error');
  lines.push('          content:');
  lines.push('            application/json:');
  lines.push('              schema:');
  lines.push(`                $ref: "${schemaRef('ErrorEnvelope')}"`);

  return lines;
}

function buildOpenApi(routes: RouteEntry[]): string {
  const byPath = new Map<string, { method: string; tag: string; route: RouteEntry }[]>();
  for (const r of routes) {
    const list = byPath.get(r.path) ?? [];
    list.push({ method: r.method, tag: r.tag, route: r });
    byPath.set(r.path, list);
  }

  const sortedPaths = [...byPath.keys()].sort();
  const tags = [...new Set(TAG_BY_PREFIX.map(([, t]) => t).concat(['System']))];
  const componentSchemas = buildComponentSchemas();

  const lines: string[] = [
    'openapi: 3.1.0',
    'info:',
    '  title: Mother Care School API',
    '  version: 1.0.0',
    '  description: |',
    '    REST API for Mother Care School ERP — admin, teacher, student, staff portals, chat, and file uploads.',
    '    Responses use `{ success: true, data: … }` on success and `{ success: false, message: "…" }` on error.',
    '    Admin routes require `branchId` and `academicYearId` query params unless embedded in the path.',
    '    Generated from Express route files + Zod/schema registry — run `npm run openapi:generate` to refresh.',
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
    '      description: JWT from POST /auth/login — send as Authorization Bearer token header',
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
    '  schemas:',
  ];

  const schemaNames = Object.keys(componentSchemas).sort();
  for (const name of schemaNames) {
    lines.push(`    ${name}:`);
    lines.push(...emitSchemaObjectLines(componentSchemas[name], 3));
  }

  lines.push('', 'paths:');

  for (const apiPath of sortedPaths) {
    lines.push(`  '${yamlEscape(apiPath)}':`);
    const ops = byPath.get(apiPath)!;
    const opTag = ops[0]?.tag ?? 'System';
    for (const { method, route } of ops) {
      const spec = resolveRouteSpec(route);
      const sec = authFor(opTag, apiPath);
      lines.push(`    ${method}:`);
      lines.push(`      tags: [${opTag}]`);
      const summary = spec?.summary ?? `${method.toUpperCase()} ${apiPath}`;
      lines.push(`      summary: ${summary}`);
      lines.push(`      operationId: ${method}_${apiPath.replace(/[^\w]+/g, '_').replace(/^_|_$/g, '')}`);
      if (sec) lines.push('      security: [{ bearerAuth: [] }]');
      lines.push(...emitParameters(apiPath, spec));
      if (spec?.requestBody && ['post', 'put', 'patch'].includes(method)) {
        lines.push(...emitRequestBody(spec.requestBody));
      }
      lines.push(...emitResponses(spec, method));
    }
  }

  return `${lines.join('\n')}\n`;
}

const routes = collectRoutes();
const yaml = buildOpenApi(routes);
const out = path.join(__dirname, '../openapi.yaml');
fs.writeFileSync(out, yaml, 'utf8');

const coverage = countCoverage(routes, (method, p) => {
  const route = routes.find((r) => r.method === method && r.path === p);
  return route ? resolveRouteSpec(route) : undefined;
});
const pct = Math.round((coverage.withAnySchema / coverage.total) * 100);
const typedReqPct = Math.round((coverage.withTypedRequest / coverage.total) * 100);
const typedResPct = Math.round((coverage.withTypedResponse / coverage.total) * 100);

console.log(`Wrote ${out} (${routes.length} operations, ${new Set(routes.map((r) => r.path)).size} paths)`);
console.log(`Schema coverage: ${coverage.withAnySchema}/${coverage.total} operations (${pct}%) have request or response schemas`);
console.log(`  - Request bodies: ${coverage.withRequestBody} (${coverage.withTypedRequest} typed, ${typedReqPct}%)`);
console.log(`  - Responses: ${coverage.withResponse} (${coverage.withTypedResponse} typed, ${typedResPct}%)`);
