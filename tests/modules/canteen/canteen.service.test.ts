import { prismaMock } from '../../mocks/prisma';
import * as canteenService from '../../../src/modules/canteen/canteen.service';

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

  describe('createSale', () => {
    test('rejects sale when stock is insufficient', async () => {
      prismaMock.canteenProduct.findMany.mockResolvedValue([
        {
          id: 'p1',
          name: 'Chips',
          unitPrice: { valueOf: () => 50 },
          stockQuantity: 1,
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
