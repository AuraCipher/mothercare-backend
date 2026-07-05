import { prismaMock } from '../../mocks/prisma';
import * as canteenService from '../../../src/modules/canteen/canteen.service';
import { CanteenSupplierPaymentDirection } from '@prisma/client';

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
      prismaMock.canteenSupplier.findFirst.mockResolvedValue({
        id: 'sup-1',
        branchId,
        balanceOwedToSupplier: { valueOf: () => 90240 },
        balanceSupplierOwesUs: { valueOf: () => 0 },
      } as any);
      prismaMock.canteenSupplierPayment.create.mockResolvedValue({ id: 'pay-1' } as any);
      prismaMock.canteenSupplier.update.mockResolvedValue({} as any);

      await canteenService.logSupplierPayment(
        branchId,
        'sup-1',
        { amount: 91000, direction: CanteenSupplierPaymentDirection.WE_PAID_SUPPLIER },
        'user-1',
      );

      const updateData = prismaMock.canteenSupplier.update.mock.calls[0][0].data;
      expect(Number(updateData.balanceOwedToSupplier)).toBe(0);
      expect(Number(updateData.balanceSupplierOwesUs)).toBe(760);
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
  });
});
