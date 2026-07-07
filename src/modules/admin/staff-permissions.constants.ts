import type { StaffModule } from '@prisma/client';

export type CrudAction = 'create' | 'read' | 'update' | 'delete';

export const STAFF_MODULE_KEYS = [
  'STUDENTS',
  'OPERATIONS',
  'TIMETABLE',
  'ATTENDANCE',
  'FEES',
  'RESULT',
  'CANTEEN',
  'STATIONARY',
] as const satisfies readonly StaffModule[];

export type StaffModuleKey = (typeof STAFF_MODULE_KEYS)[number];

export const FULL_ADMIN_BRANCH_ROLES = new Set(['branch_admin', 'sub_admin']);

export type ModulePermissionInput = {
  module: StaffModuleKey;
  canCreate: boolean;
  canRead: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  archivedCanRead?: boolean;
  archivedCanCreate?: boolean;
  archivedCanUpdate?: boolean;
  archivedCanDelete?: boolean;
};

export type ResolvedModulePermission = ModulePermissionInput;

/** Map admin API path prefixes to staff modules. Longest match wins. */
export const API_PATH_MODULE_RULES: Array<{ prefix: string; module: StaffModuleKey }> = [
  { prefix: '/admin/students/operations', module: 'OPERATIONS' },
  { prefix: '/admin/students', module: 'STUDENTS' },
  { prefix: '/admin/timetable', module: 'TIMETABLE' },
  { prefix: '/admin/attendance', module: 'ATTENDANCE' },
  { prefix: '/admin/fees', module: 'FEES' },
  { prefix: '/admin/fee-', module: 'FEES' },
  { prefix: '/admin/payments', module: 'FEES' },
  { prefix: '/admin/student-fees', module: 'FEES' },
  { prefix: '/admin/families', module: 'FEES' },
  { prefix: '/admin/result', module: 'RESULT' },
  { prefix: '/admin/exam-sessions', module: 'RESULT' },
  { prefix: '/admin/canteen', module: 'CANTEEN' },
  { prefix: '/admin/stationary', module: 'STATIONARY' },
];

export function httpMethodToAction(method: string): CrudAction {
  const m = method.toUpperCase();
  if (m === 'GET' || m === 'HEAD') return 'read';
  if (m === 'POST') return 'create';
  if (m === 'PUT' || m === 'PATCH') return 'update';
  if (m === 'DELETE') return 'delete';
  return 'read';
}

export function resolveModuleForPath(path: string): StaffModuleKey | null {
  const normalized = path.split('?')[0];
  for (const rule of API_PATH_MODULE_RULES) {
    if (normalized.startsWith(rule.prefix)) return rule.module;
  }
  return null;
}

export function actionAllowed(
  perms: ResolvedModulePermission[],
  module: StaffModuleKey,
  action: CrudAction,
  opts?: { archived?: boolean },
): boolean {
  const row = perms.find((p) => p.module === module);
  if (!row) return false;
  const archived = opts?.archived === true;
  if (archived) {
    if (!row.archivedCanRead) return false;
    if (action === 'read') return true;
    if (action === 'create') return !!row.archivedCanCreate;
    if (action === 'update') return !!row.archivedCanUpdate;
    if (action === 'delete') return !!row.archivedCanDelete;
    return false;
  }
  if (action === 'read') return row.canRead;
  if (action === 'create') return row.canCreate;
  if (action === 'update') return row.canUpdate;
  if (action === 'delete') return row.canDelete;
  return false;
}

export function normalizePermissionInput(
  modules: ModulePermissionInput[],
): ModulePermissionInput[] {
  if (!modules.length) {
    throw { status: 400, message: 'Select at least one module' };
  }
  const seen = new Set<string>();
  const out: ModulePermissionInput[] = [];
  for (const m of modules) {
    if (!STAFF_MODULE_KEYS.includes(m.module)) {
      throw { status: 400, message: `Invalid module: ${m.module}` };
    }
    if (seen.has(m.module)) continue;
    seen.add(m.module);
    const archivedRead = m.archivedCanRead ?? !!(m.archivedCanCreate || m.archivedCanUpdate || m.archivedCanDelete);
    out.push({
      module: m.module,
      canCreate: !!m.canCreate,
      canRead: true,
      canUpdate: !!m.canUpdate,
      canDelete: !!m.canDelete,
      archivedCanRead: archivedRead,
      archivedCanCreate: !!m.archivedCanCreate,
      archivedCanUpdate: !!m.archivedCanUpdate,
      archivedCanDelete: !!m.archivedCanDelete,
    });
  }
  return out;
}
