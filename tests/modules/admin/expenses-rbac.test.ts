import { describe, expect, test } from '@jest/globals';
import { STAFF_MODULE_KEYS } from '../../../src/modules/admin/staff-permissions.constants';

describe('EXPENSES RBAC module', () => {
  test('EXPENSES is a valid staff module key', () => {
    expect(STAFF_MODULE_KEYS).toContain('EXPENSES');
  });
});
