import { prismaMock } from '../../mocks/prisma';
import * as canteenService from '../../../src/modules/canteen/canteen.service';
import { CanteenPersonType, CanteenSupplierPaymentDirection } from '@prisma/client';

const branchId = 'branch-1';

describe('CanteenService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prismaMock.$transaction.mockImplementation(async (fn: any) => fn(prismaMock));
  });

  describe('createCategory', () => {
    test('creates a new category', async () => {
      prismaMock.canteenProductCategory.findFirst.mockResolvedValue(null);
      prismaMock.canteenProductCategory.create.mockResolvedValue({
        id: 'cat-1',
        branchId,
        name: 'Snacks',
        isActive: true,
      } as any);

      const result = await canteenService.createCategory(branchId, 'Snacks');
      expect(result.name).toBe('Snacks');
      expect(prismaMock.canteenProductCategory.create).toHaveBeenCalled();
    });

    test('reactivates inactive category with same name', async () => {
      prismaMock.canteenProductCategory.findFirst.mockResolvedValue({
        id: 'cat-1',
        branchId,
        name: 'Snacks',
        isActive: false,
      } as any);
      prismaMock.canteenProductCategory.update.mockResolvedValue({
        id: 'cat-1',
        name: 'Snacks',
        isActive: true,
      } as any);

      const result = await canteenService.createCategory(branchId, 'Snacks');
      expect(result.isActive).toBe(true);
      expect(prismaMock.canteenProductCategory.create).not.toHaveBeenCalled();
    });

    test('throws 409 when active category already exists', async () => {
      prismaMock.canteenProductCategory.findFirst.mockResolvedValue({
        id: 'cat-1',
        branchId,
        name: 'Snacks',
        isActive: true,
      } as any);

      await expect(canteenService.createCategory(branchId, 'Snacks')).rejects.toMatchObject({
        status: 409,
        message: expect.stringContaining('already exists'),
      });
    });

    test('throws 400 for empty name', async () => {
      await expect(canteenService.createCategory(branchId, '   ')).rejects.toMatchObject({
        status: 400,
      });
    });
  });

  describe('createSupplier', () => {
    test('throws 409 when supplier name already exists', async () => {
      prismaMock.canteenSupplier.findFirst.mockResolvedValue({
        id: 'sup-1',
        branchId,
        name: 'Ali Foods',
        isActive: true,
      } as any);

      await expect(
        canteenService.createSupplier(branchId, { name: 'Ali Foods' }),
      ).rejects.toMatchObject({ status: 409 });
    });
  });

  describe('createProduct', () => {
    test('throws 409 when product exists in category', async () => {
      prismaMock.canteenProductCategory.findFirst.mockResolvedValue({
        id: 'cat-1',
        branchId,
      } as any);
      prismaMock.canteenProduct.findFirst.mockResolvedValue({
        id: 'p1',
        branchId,
        categoryId: 'cat-1',
        name: 'Chips',
        isActive: true,
      } as any);

      await expect(
        canteenService.createProduct(branchId, {
          categoryId: 'cat-1',
          name: 'Chips',
          unitPrice: 50,
        }),
      ).rejects.toMatchObject({ status: 409 });
    });
  });

  describe('computeSupplierBalancesFromLedger', () => {
    test('shows they owe us when we overpay', () => {
      const balances = canteenService.computeSupplierBalancesFromLedger(90240, [
        { direction: CanteenSupplierPaymentDirection.WE_PAID_SUPPLIER, amount: 91000 },
      ]);
      expect(balances.balanceOwedToSupplier).toBe(0);
      expect(balances.balanceSupplierOwesUs).toBe(760);
    });

    test('shows remaining owed when underpaid', () => {
      const balances = canteenService.computeSupplierBalancesFromLedger(1000, [
        { direction: CanteenSupplierPaymentDirection.WE_PAID_SUPPLIER, amount: 400 },
      ]);
      expect(balances.balanceOwedToSupplier).toBe(600);
      expect(balances.balanceSupplierOwesUs).toBe(0);
    });

    test('reduces credit when supplier pays us back', () => {
      const balances = canteenService.computeSupplierBalancesFromLedger(1000, [
        { direction: CanteenSupplierPaymentDirection.WE_PAID_SUPPLIER, amount: 1200 },
        { direction: CanteenSupplierPaymentDirection.SUPPLIER_PAID_US, amount: 150 },
      ]);
      expect(balances.balanceOwedToSupplier).toBe(0);
      expect(balances.balanceSupplierOwesUs).toBe(50);
    });
  });

  describe('logSupplierPayment', () => {
    test('moves overpayment to balanceSupplierOwesUs', async () => {
      // Mock $queryRaw for FOR UPDATE lock — returns the locked supplier row
      (prismaMock.$queryRaw as any).mockResolvedValueOnce([
        { balanceOwedToSupplier: { valueOf: () => 90240 }, balanceSupplierOwesUs: { valueOf: () => 0 } },
      ]);
      prismaMock.canteenSupplierPayment.create.mockResolvedValue({ id: 'pay-1' } as any);
      // Mock $queryRaw for the atomic UPDATE
      (prismaMock.$queryRaw as any).mockResolvedValueOnce([]);

      await canteenService.logSupplierPayment(
        branchId,
        'sup-1',
        { amount: 91000, direction: CanteenSupplierPaymentDirection.WE_PAID_SUPPLIER },
        'user-1',
      );

      // Verify the atomic UPDATE was called (second $queryRaw call)
      expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(2);
      // The UPDATE SQL should compute GREATEST(0, owed - amount) and overflow
      const updateCall = (prismaMock.$queryRaw as any).mock.calls[1];
      expect(updateCall[0].join('')).toContain('balanceOwedToSupplier');
      expect(updateCall[0].join('')).toContain('balanceSupplierOwesUs');
    });
  });

  describe('listSuppliers', () => {
    test('reconciles balances from purchase and payment ledger', async () => {
      prismaMock.canteenSupplier.findMany.mockResolvedValue([
        {
          id: 'sup-1',
          branchId,
          name: 'Hassan',
          balanceOwedToSupplier: { valueOf: () => 0 },
          balanceSupplierOwesUs: { valueOf: () => 0 },
        },
      ] as any);
      (prismaMock.canteenRestockPurchase.groupBy as jest.Mock).mockResolvedValue([
        { supplierId: 'sup-1', _sum: { totalCost: { valueOf: () => 90240 } } },
      ] as any);
      prismaMock.canteenSupplierPayment.findMany.mockResolvedValue([
        {
          supplierId: 'sup-1',
          direction: CanteenSupplierPaymentDirection.WE_PAID_SUPPLIER,
          amount: { valueOf: () => 91000 },
        },
      ] as any);
      prismaMock.canteenSupplier.update.mockResolvedValue({} as any);

      const result = await canteenService.listSuppliers(branchId);

      expect(Number(result[0].balanceSupplierOwesUs)).toBe(760);
      expect(Number(result[0].balanceOwedToSupplier)).toBe(0);
      expect(prismaMock.canteenSupplier.update).toHaveBeenCalled();
    });
  });

  describe('splitSaleItemsByCashAmount', () => {
    test('puts full amount on cash when budget covers all units', () => {
      const split = canteenService.splitSaleItemsByCashAmount(
        [{ productId: 'p1', quantity: 3, unitPrice: 50 }],
        150,
      );
      expect(split.cashItems).toEqual([{ productId: 'p1', quantity: 3 }]);
      expect(split.creditItems).toEqual([]);
    });

    test('splits units between cash and credit', () => {
      const split = canteenService.splitSaleItemsByCashAmount(
        [
          { productId: 'p1', quantity: 6, unitPrice: 100 },
          { productId: 'p2', quantity: 4, unitPrice: 100 },
        ],
        600,
      );
      expect(split.cashItems).toEqual([{ productId: 'p1', quantity: 6 }]);
      expect(split.creditItems).toEqual([{ productId: 'p2', quantity: 4 }]);
    });
  });

  describe('createSale', () => {
    test('rejects sale when stock is insufficient', async () => {
      prismaMock.canteenProduct.findMany.mockResolvedValue([
        {
          id: 'p1',
          name: 'Chips',
          unitPrice: { valueOf: () => 50 },
          stockBoxes: 0,
          stockUnits: 1,
          isActive: true,
        },
      ] as any);

      await expect(
        canteenService.createSale(
          branchId,
          { paymentType: 'CASH', items: [{ productId: 'p1', quantity: 5 }] },
          'user-1',
        ),
      ).rejects.toMatchObject({ status: 400, message: expect.stringContaining('Insufficient stock') });
    });

    test('decrements stock with total-based box re-normalization', async () => {
      prismaMock.canteenProduct.findMany.mockResolvedValue([
        {
          id: 'p1',
          name: 'Coke',
          unitPrice: { valueOf: () => 50 },
          stockBoxes: 1,
          stockUnits: 1,
          unitsPerBox: 6,
          isActive: true,
        },
      ] as any);
      prismaMock.canteenSale.create.mockResolvedValue({
        id: 's1',
        paymentType: 'CASH',
        totalAmount: 350,
        items: [],
      } as any);
      // FOR UPDATE lock, then the single atomic decrement
      (prismaMock.$queryRaw as any)
        .mockResolvedValueOnce([{ unitsPerBox: 6 }])
        .mockResolvedValueOnce([{ id: 'p1' }]);

      await canteenService.createSale(
        branchId,
        { paymentType: 'CASH', items: [{ productId: 'p1', quantity: 7 }] },
        'user-1',
      );

      expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(2);
      const sql = (prismaMock.$queryRaw as any).mock.calls[1][0].join('');
      // Total-based re-normalization: (boxes*upb + units - qty) div/mod upb
      expect(sql).toContain('("stockBoxes" * ');
      expect(sql).toContain(') % ');
      expect(sql).toContain('RETURNING "id"');
      // The old two-step box-break (stockUnits + upb - qty, i.e. crediting back
      // only ONE box no matter how many the quantity needed) lost
      // (ceil(qty/upb)-1)*upb units per sale and drove stock negative.
      expect(sql).not.toContain('"stockUnits" + ');
      expect(sql).not.toContain('"stockBoxes" - ');
    });
  });

  describe('createSaleWithPaymentSplit', () => {
    // Two units (Rs 40 + Rs 60) so cash/credit amounts like 60/40 cannot be formed by
    // summing whole units in line order — the exact case that used to return 400.
    const items = [
      { productId: 'p1', quantity: 1 },
      { productId: 'p2', quantity: 1 },
    ];

    function mockProducts() {
      prismaMock.canteenProduct.findMany.mockResolvedValue([
        { id: 'p1', name: 'Chips', unitPrice: { valueOf: () => 40 }, stockBoxes: 0, stockUnits: 10, unitsPerBox: null, isActive: true },
        { id: 'p2', name: 'Juice', unitPrice: { valueOf: () => 60 }, stockBoxes: 0, stockUnits: 10, unitsPerBox: null, isActive: true },
      ] as any);
    }

    function saleCreateArgs(index: number) {
      return (prismaMock.canteenSale.create as jest.Mock).mock.calls[index][0];
    }

    beforeEach(() => {
      prismaMock.canteenSale.create.mockResolvedValue({ id: 'sale-1' } as any);
      // applySaleStockDeltas: FOR UPDATE lock select + atomic decrement per product
      prismaMock.$queryRaw.mockResolvedValue([{ id: 'row-1', unitsPerBox: 1 }] as any);
    });

    test('accepts a cash/credit split that whole units cannot match exactly', async () => {
      mockProducts();
      prismaMock.canteenAccount.findFirst.mockResolvedValue({ id: 'acc-1', branchId } as any);
      prismaMock.canteenAccount.update.mockResolvedValue({} as any);

      const sales = await canteenService.createSaleWithPaymentSplit(
        branchId,
        { items, cashAmount: 60, creditAmount: 40, accountId: 'acc-1' },
        'user-1',
      );

      expect(sales).toHaveLength(2);
      expect(prismaMock.canteenSale.create).toHaveBeenCalledTimes(2);
      // Records carry the entered money, not the whole-unit sums (40/60).
      expect(saleCreateArgs(0).data.paymentType).toBe('CASH');
      expect(Number(saleCreateArgs(0).data.totalAmount)).toBe(60);
      expect(saleCreateArgs(1).data.paymentType).toBe('CREDIT');
      expect(Number(saleCreateArgs(1).data.totalAmount)).toBe(40);
      expect(saleCreateArgs(1).data.canteenAccountId).toBe('acc-1');
      // Account balance grows by the entered credit amount.
      const updateArgs = prismaMock.canteenAccount.update.mock.calls[0]?.[0] as any;
      expect(Number(updateArgs.data.runningBalance.increment)).toBe(40);
      // Every unit is still attached to exactly one record.
      const attached = [0, 1].flatMap((i) => (saleCreateArgs(i).data.items.create as any[]).map((li) => `${li.productId}:${li.quantity}`));
      expect(attached.sort()).toEqual(['p1:1', 'p2:1']);
    });

    test('accepts credit allocations that whole units cannot match exactly', async () => {
      mockProducts();
      prismaMock.student.findFirst.mockResolvedValue({ id: 's1', name: 'Ali', phone: null } as any);
      prismaMock.canteenAccount.findFirst.mockResolvedValue(null);
      prismaMock.canteenAccount.create.mockResolvedValue({ id: 'acc-new' } as any);

      const sales = await canteenService.createSaleWithPaymentSplit(
        branchId,
        {
          items,
          cashAmount: 0,
          creditAmount: 100,
          creditAllocations: [
            { personType: CanteenPersonType.STUDENT, studentId: 's1', amount: 50 },
            { personType: CanteenPersonType.STUDENT, studentId: 's2', amount: 50 },
          ],
        },
        'user-1',
      );

      expect(sales).toHaveLength(2);
      expect(prismaMock.canteenSale.create).toHaveBeenCalledTimes(2);
      expect(Number(saleCreateArgs(0).data.totalAmount)).toBe(50);
      expect(Number(saleCreateArgs(1).data.totalAmount)).toBe(50);
      expect(saleCreateArgs(0).data.paymentType).toBe('CREDIT');
      expect(saleCreateArgs(1).data.paymentType).toBe('CREDIT');
      // Leftover units fall on the final allocation so no unit is dropped from reports.
      const attached = [0, 1].flatMap((i) => (saleCreateArgs(i).data.items.create as any[]).map((li) => `${li.productId}:${li.quantity}`));
      expect(attached.sort()).toEqual(['p1:1', 'p2:1']);
      // Each person's balance grows by their allocated money.
      expect(prismaMock.canteenAccount.create).toHaveBeenCalledTimes(2);
      expect(Number((prismaMock.canteenAccount.create.mock.calls[0][0] as any).data.runningBalance)).toBe(50);
      expect(Number((prismaMock.canteenAccount.create.mock.calls[1][0] as any).data.runningBalance)).toBe(50);
    });

    test('still records an all-cash sale as a single cash record', async () => {
      mockProducts();

      const sales = await canteenService.createSaleWithPaymentSplit(
        branchId,
        { items, cashAmount: 100, creditAmount: 0 },
        'user-1',
      );

      expect(sales).toHaveLength(1);
      expect(prismaMock.canteenSale.create).toHaveBeenCalledTimes(1);
      expect(saleCreateArgs(0).data.paymentType).toBe('CASH');
      expect(Number(saleCreateArgs(0).data.totalAmount)).toBe(100);
      expect(prismaMock.canteenAccount.update).not.toHaveBeenCalled();
    });
  });
});
