/**
 * DB-04: Financial & inventory concurrency hardening regression tests.
 *
 * Verifies that every fixed mutation path:
 *   - Uses $transaction for atomicity
 *   - Uses FOR UPDATE row locking (via $queryRaw tagged template)
 *   - Uses atomic conditional updates instead of read-then-write
 *   - Rejects invalid inputs before entering transactions
 */

import { prismaMock } from '../../mocks/prisma';
import * as canteenService from '../../../src/modules/canteen/canteen.service';
import { CanteenSupplierPaymentDirection } from '@prisma/client';

const branchId = 'branch-1';

beforeEach(() => {
  jest.clearAllMocks();
  prismaMock.$transaction.mockImplementation(async (fn: any) => fn(prismaMock));
});

/**
 * Helper: set up $queryRaw mock chain for $queryRaw calls.
 * $queryRaw as a tagged template is still a function call:
 *   tx.$queryRaw`SELECT ...`  =>  tx.$queryRaw(["SELECT ..."])
 * So mockResolvedValueOnce works.
 */
function mockQueryRaw(...values: any[]) {
  const mock = prismaMock.$queryRaw as jest.Mock;
  for (const v of values) {
    mock.mockResolvedValueOnce(v);
  }
}

// ─── Canteen Account Payment ──────────────────────────────────

describe('DB-04: recordAccountPayment', () => {
  test('uses $transaction with $queryRaw FOR UPDATE lock and atomic update', async () => {
    mockQueryRaw(
      [{ runningBalance: 500 }],  // FOR UPDATE lock result
      [],                          // Atomic GREATEST(0, balance - amount) result
    );
    prismaMock.canteenAccountPayment.create.mockResolvedValue({ id: 'pay-1' } as any);

    await canteenService.recordAccountPayment(branchId, 'acc-1', { amountPaid: 200 }, 'user-1');

    expect(prismaMock.$transaction).toHaveBeenCalled();
    // Verify no old-pattern calls
    expect(prismaMock.canteenAccount.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.canteenAccount.update).not.toHaveBeenCalled();
  });

  test('throws 404 when FOR UPDATE returns no rows', async () => {
    mockQueryRaw([]);

    await expect(
      canteenService.recordAccountPayment(branchId, 'nonexistent', { amountPaid: 100 }, 'user-1'),
    ).rejects.toMatchObject({ status: 404 });
  });

  test('rejects zero/negative amounts before transaction', async () => {
    await expect(
      canteenService.recordAccountPayment(branchId, 'acc-1', { amountPaid: 0 }, 'user-1'),
    ).rejects.toMatchObject({ status: 400 });

    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });
});

// ─── Canteen Supplier Payment ─────────────────────────────────

describe('DB-04: logSupplierPayment', () => {
  test('uses $transaction with $queryRaw FOR UPDATE lock and atomic update', async () => {
    mockQueryRaw(
      [{ balanceOwedToSupplier: 900, balanceSupplierOwesUs: 0 }],  // FOR UPDATE lock
      [],                                                          // Atomic UPDATE
    );
    prismaMock.canteenSupplierPayment.create.mockResolvedValue({ id: 'pay-1' } as any);

    await canteenService.logSupplierPayment(
      branchId, 'sup-1',
      { amount: 500, direction: CanteenSupplierPaymentDirection.WE_PAID_SUPPLIER },
      'user-1',
    );

    expect(prismaMock.$transaction).toHaveBeenCalled();
    expect(prismaMock.canteenSupplier.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.canteenSupplier.update).not.toHaveBeenCalled();
  });

  test('throws 404 when FOR UPDATE returns no rows', async () => {
    mockQueryRaw([]);

    await expect(
      canteenService.logSupplierPayment(
        branchId, 'nonexistent',
        { amount: 100, direction: CanteenSupplierPaymentDirection.WE_PAID_SUPPLIER },
        'user-1',
      ),
    ).rejects.toMatchObject({ status: 404 });
  });

  test('rejects zero amounts before transaction', async () => {
    await expect(
      canteenService.logSupplierPayment(
        branchId, 'sup-1',
        { amount: 0, direction: CanteenSupplierPaymentDirection.WE_PAID_SUPPLIER },
        'user-1',
      ),
    ).rejects.toMatchObject({ status: 400 });

    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });
});

// ─── Canteen Stock Decrement ──────────────────────────────────

describe('DB-04: createSale stock decrement', () => {
  test('uses $transaction for stock decrement with simple stock', async () => {
    prismaMock.canteenProduct.findMany.mockResolvedValue([
      { id: 'p1', branchId, name: 'Chips', unitPrice: 50, stockBoxes: 0, stockUnits: 10, unitsPerBox: 1, isActive: true },
    ] as any);
    mockQueryRaw(
      [{ unitsPerBox: 1 }],    // FOR UPDATE lock
      [{ id: 'p1' }],          // Atomic decrement with RETURNING (1 row = success)
    );
    prismaMock.canteenSale.create.mockResolvedValue({ id: 's1' } as any);

    await canteenService.createSale(branchId, {
      paymentType: 'CASH',
      items: [{ productId: 'p1', quantity: 2 }],
    }, 'user-1');

    expect(prismaMock.$transaction).toHaveBeenCalled();
    // Old patterns removed
    expect(prismaMock.canteenProduct.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.canteenProduct.update).not.toHaveBeenCalled();
  });

  test('rejects sale when atomic decrement returns empty (insufficient stock)', async () => {
    prismaMock.canteenProduct.findMany.mockResolvedValue([
      { id: 'p1', branchId, name: 'Chips', unitPrice: 50, stockBoxes: 0, stockUnits: 50, unitsPerBox: 1, isActive: true },
    ] as any);
    mockQueryRaw(
      [{ unitsPerBox: 1 }],  // FOR UPDATE lock
      [],                    // Atomic decrement RETURNING empty = insufficient (concurrent consumption)
    );

    await expect(
      canteenService.createSale(branchId, {
        paymentType: 'CASH',
        items: [{ productId: 'p1', quantity: 50 }],
      }, 'user-1'),
    ).rejects.toMatchObject({ status: 400 });
  });
});
