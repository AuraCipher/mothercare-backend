import {
  STAFF_MODULE_KEYS,
  resolveModuleForPath,
  normalizePermissionInput,
  actionAllowed,
} from '../../../src/modules/admin/staff-permissions.constants';

describe('Stationary RBAC wiring', () => {
  test('includes STATIONARY module key', () => {
    expect(STAFF_MODULE_KEYS).toContain('STATIONARY');
  });

  test('maps stationary api path to STATIONARY module', () => {
    expect(resolveModuleForPath('/admin/stationary/products')).toBe('STATIONARY');
    expect(resolveModuleForPath('/admin/stationary/inventory/adjust')).toBe('STATIONARY');
  });

  test('allows CRUD when stationary permissions granted', () => {
    const rows = normalizePermissionInput([
      {
        module: 'STATIONARY',
        canCreate: true,
        canRead: true,
        canUpdate: true,
        canDelete: false,
      },
    ]);
    expect(actionAllowed(rows, 'STATIONARY', 'read')).toBe(true);
    expect(actionAllowed(rows, 'STATIONARY', 'create')).toBe(true);
    expect(actionAllowed(rows, 'STATIONARY', 'update')).toBe(true);
    expect(actionAllowed(rows, 'STATIONARY', 'delete')).toBe(false);
  });
});
