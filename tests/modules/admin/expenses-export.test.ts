import { describe, expect, test } from '@jest/globals';
import { expensesService } from '../../../src/modules/admin/services/expenses.service';

describe('expenses export csv', () => {
  test('toCsv escapes commas and quotes', async () => {
    const svc = expensesService as any;
    const csv = svc.toCsv(['Name', 'Note'], [['Ali', 'paid, late'], ['Sara', 'said "ok"']]);
    expect(csv).toContain('"paid, late"');
    expect(csv).toContain('"said ""ok"""');
  });
});
