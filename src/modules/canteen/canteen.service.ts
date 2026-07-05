import {
  CanteenPersonType,
  CanteenSalePaymentType,
  CanteenSupplierPaymentDirection,
  Prisma,
} from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { assertBranchCreditPerson } from './canteen-credit-rules';

function httpError(status: number, message: string): never {
  throw { status, message };
}

function money(n: number) {
  return new Prisma.Decimal(n);
}

function dayRange(dateStr: string) {
  const start = new Date(`${dateStr}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime())) httpError(400, 'Invalid date');
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end };
}

async function activeAcademicYearId(branchId: string) {
  const ay = await prisma.academicYear.findFirst({
    where: { branchId, status: 'ACTIVE' },
    select: { id: true },
    orderBy: { createdAt: 'desc' },
  });
  return ay?.id ?? null;
}

// ─── Categories ───────────────────────────────────────────────────

export async function listCategories(branchId: string) {
  return prisma.canteenProductCategory.findMany({
    where: { branchId },
    orderBy: { name: 'asc' },
  });
}

export async function createCategory(branchId: string, name: string) {
  return prisma.canteenProductCategory.create({
    data: { branchId, name: name.trim() },
  });
}

export async function updateCategory(
  branchId: string,
  id: string,
  data: { name?: string; isActive?: boolean },
) {
  const row = await prisma.canteenProductCategory.findFirst({ where: { id, branchId } });
  if (!row) httpError(404, 'Category not found');
  return prisma.canteenProductCategory.update({
    where: { id },
    data: {
      ...(data.name !== undefined ? { name: data.name.trim() } : {}),
      ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
    },
  });
}

// ─── Suppliers ────────────────────────────────────────────────────

export async function listSuppliers(branchId: string) {
  return prisma.canteenSupplier.findMany({
    where: { branchId },
    orderBy: { name: 'asc' },
  });
}

export async function createSupplier(
  branchId: string,
  data: { name: string; contactNumber?: string },
  createdById?: string,
) {
  return prisma.canteenSupplier.create({
    data: {
      branchId,
      name: data.name.trim(),
      contactNumber: data.contactNumber?.trim() || null,
      createdById,
    },
  });
}

export async function updateSupplier(
  branchId: string,
  id: string,
  data: { name?: string; contactNumber?: string; isActive?: boolean },
) {
  const row = await prisma.canteenSupplier.findFirst({ where: { id, branchId } });
  if (!row) httpError(404, 'Supplier not found');
  return prisma.canteenSupplier.update({
    where: { id },
    data: {
      ...(data.name !== undefined ? { name: data.name.trim() } : {}),
      ...(data.contactNumber !== undefined ? { contactNumber: data.contactNumber?.trim() || null } : {}),
      ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
    },
  });
}

export async function logSupplierPayment(
  branchId: string,
  supplierId: string,
  data: { amount: number; direction: CanteenSupplierPaymentDirection; note?: string },
  createdById?: string,
) {
  if (data.amount <= 0) httpError(400, 'Amount must be positive');
  const supplier = await prisma.canteenSupplier.findFirst({ where: { id: supplierId, branchId } });
  if (!supplier) httpError(404, 'Supplier not found');

  return prisma.$transaction(async (tx) => {
    const payment = await tx.canteenSupplierPayment.create({
      data: {
        supplierId,
        amount: money(data.amount),
        direction: data.direction,
        note: data.note?.trim() || null,
        createdById,
      },
    });

    if (data.direction === CanteenSupplierPaymentDirection.WE_PAID_SUPPLIER) {
      const owed = Number(supplier.balanceOwedToSupplier);
      await tx.canteenSupplier.update({
        where: { id: supplierId },
        data: { balanceOwedToSupplier: money(Math.max(0, owed - data.amount)) },
      });
    } else {
      const owesUs = Number(supplier.balanceSupplierOwesUs);
      await tx.canteenSupplier.update({
        where: { id: supplierId },
        data: { balanceSupplierOwesUs: money(Math.max(0, owesUs - data.amount)) },
      });
    }

    return payment;
  });
}

export async function listSupplierPayments(branchId: string, supplierId: string) {
  const supplier = await prisma.canteenSupplier.findFirst({ where: { id: supplierId, branchId } });
  if (!supplier) httpError(404, 'Supplier not found');
  return prisma.canteenSupplierPayment.findMany({
    where: { supplierId },
    orderBy: { paidAt: 'desc' },
  });
}

// ─── Products ─────────────────────────────────────────────────────

export async function listProducts(branchId: string, activeOnly = false) {
  return prisma.canteenProduct.findMany({
    where: { branchId, ...(activeOnly ? { isActive: true } : {}) },
    include: { category: true, supplier: true },
    orderBy: [{ category: { name: 'asc' } }, { name: 'asc' }],
  });
}

export async function createProduct(
  branchId: string,
  data: {
    categoryId: string;
    supplierId?: string;
    name: string;
    unitPrice: number;
    stockQuantity?: number;
    lowStockThreshold?: number;
  },
  createdById?: string,
) {
  const category = await prisma.canteenProductCategory.findFirst({
    where: { id: data.categoryId, branchId },
  });
  if (!category) httpError(400, 'Category not found in this branch');
  if (data.supplierId) {
    const supplier = await prisma.canteenSupplier.findFirst({
      where: { id: data.supplierId, branchId },
    });
    if (!supplier) httpError(400, 'Supplier not found in this branch');
  }

  return prisma.canteenProduct.create({
    data: {
      branchId,
      categoryId: data.categoryId,
      supplierId: data.supplierId || null,
      name: data.name.trim(),
      unitPrice: money(data.unitPrice),
      stockQuantity: data.stockQuantity ?? 0,
      lowStockThreshold: data.lowStockThreshold ?? 5,
      createdById,
    },
    include: { category: true, supplier: true },
  });
}

export async function updateProduct(
  branchId: string,
  id: string,
  data: {
    categoryId?: string;
    supplierId?: string | null;
    name?: string;
    unitPrice?: number;
    lowStockThreshold?: number;
    isActive?: boolean;
  },
) {
  const product = await prisma.canteenProduct.findFirst({ where: { id, branchId } });
  if (!product) httpError(404, 'Product not found');

  if (data.categoryId) {
    const category = await prisma.canteenProductCategory.findFirst({
      where: { id: data.categoryId, branchId },
    });
    if (!category) httpError(400, 'Category not found in this branch');
  }
  if (data.supplierId) {
    const supplier = await prisma.canteenSupplier.findFirst({
      where: { id: data.supplierId, branchId },
    });
    if (!supplier) httpError(400, 'Supplier not found in this branch');
  }

  return prisma.canteenProduct.update({
    where: { id },
    data: {
      ...(data.categoryId !== undefined ? { categoryId: data.categoryId } : {}),
      ...(data.supplierId !== undefined ? { supplierId: data.supplierId } : {}),
      ...(data.name !== undefined ? { name: data.name.trim() } : {}),
      ...(data.unitPrice !== undefined ? { unitPrice: money(data.unitPrice) } : {}),
      ...(data.lowStockThreshold !== undefined ? { lowStockThreshold: data.lowStockThreshold } : {}),
      ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
    },
    include: { category: true, supplier: true },
  });
}

export async function deactivateProduct(branchId: string, id: string) {
  return updateProduct(branchId, id, { isActive: false });
}

// ─── Restock ──────────────────────────────────────────────────────

export async function createRestockPurchase(
  branchId: string,
  data: {
    supplierId: string;
    items: { productId: string; quantity: number; unitCost: number }[];
    note?: string;
    paidImmediately?: boolean;
  },
  createdById?: string,
) {
  if (!data.items.length) httpError(400, 'At least one line item is required');

  const supplier = await prisma.canteenSupplier.findFirst({
    where: { id: data.supplierId, branchId, isActive: true },
  });
  if (!supplier) httpError(404, 'Supplier not found');

  const productIds = data.items.map((i) => i.productId);
  const products = await prisma.canteenProduct.findMany({
    where: { id: { in: productIds }, branchId },
  });
  if (products.length !== productIds.length) httpError(400, 'One or more products not found in this branch');

  const totalCost = data.items.reduce((s, i) => s + i.quantity * i.unitCost, 0);

  return prisma.$transaction(async (tx) => {
    const purchase = await tx.canteenRestockPurchase.create({
      data: {
        branchId,
        supplierId: data.supplierId,
        totalCost: money(totalCost),
        note: data.note?.trim() || null,
        createdById,
        items: {
          create: data.items.map((i) => ({
            productId: i.productId,
            quantity: i.quantity,
            unitCost: money(i.unitCost),
          })),
        },
      },
      include: { items: true },
    });

    for (const item of data.items) {
      await tx.canteenProduct.update({
        where: { id: item.productId },
        data: { stockQuantity: { increment: item.quantity } },
      });
    }

    await tx.canteenSupplier.update({
      where: { id: data.supplierId },
      data: {
        balanceOwedToSupplier: { increment: money(totalCost) },
      },
    });

    if (data.paidImmediately && totalCost > 0) {
      await tx.canteenSupplierPayment.create({
        data: {
          supplierId: data.supplierId,
          amount: money(totalCost),
          direction: CanteenSupplierPaymentDirection.WE_PAID_SUPPLIER,
          note: 'Paid on restock',
          createdById,
        },
      });
      await tx.canteenSupplier.update({
        where: { id: data.supplierId },
        data: { balanceOwedToSupplier: { decrement: money(totalCost) } },
      });
    }

    return purchase;
  });
}

export async function listRestockPurchases(branchId: string) {
  return prisma.canteenRestockPurchase.findMany({
    where: { branchId },
    include: { supplier: true, items: { include: { product: true } } },
    orderBy: { purchaseDate: 'desc' },
  });
}

// ─── Credit accounts ──────────────────────────────────────────────

export async function listAccounts(branchId: string) {
  return prisma.canteenAccount.findMany({
    where: { branchId, isActive: true },
    orderBy: { displayName: 'asc' },
  });
}

export async function getAccount(branchId: string, id: string) {
  const account = await prisma.canteenAccount.findFirst({
    where: { id, branchId },
    include: {
      student: { select: { id: true, name: true, rollNumber: true } },
      user: { select: { id: true, name: true, role: true } },
    },
  });
  if (!account) httpError(404, 'Account not found');
  return account;
}

export async function createAccount(
  branchId: string,
  data: { personType: CanteenPersonType; studentId?: string; userId?: string },
  createdById?: string,
) {
  const person = await assertBranchCreditPerson({
    branchId,
    personType: data.personType,
    studentId: data.studentId,
    userId: data.userId,
  });

  const existing = await prisma.canteenAccount.findFirst({
    where: {
      branchId,
      OR: [
        person.studentId ? { studentId: person.studentId } : {},
        person.userId ? { userId: person.userId } : {},
      ].filter((o) => Object.keys(o).length > 0),
    },
  });
  if (existing) return existing;

  return prisma.canteenAccount.create({
    data: {
      branchId,
      personType: data.personType,
      studentId: person.studentId,
      userId: person.userId,
      displayName: person.displayName,
      displayPhone: person.displayPhone,
      createdById,
    },
  });
}

export async function recordAccountPayment(
  branchId: string,
  accountId: string,
  data: { amountPaid: number; note?: string },
  createdById?: string,
) {
  if (data.amountPaid <= 0) httpError(400, 'Amount must be positive');
  const account = await prisma.canteenAccount.findFirst({ where: { id: accountId, branchId } });
  if (!account) httpError(404, 'Account not found');

  return prisma.$transaction(async (tx) => {
    const payment = await tx.canteenAccountPayment.create({
      data: {
        canteenAccountId: accountId,
        amountPaid: money(data.amountPaid),
        note: data.note?.trim() || null,
        createdById,
      },
    });
    const balance = Number(account.runningBalance);
    await tx.canteenAccount.update({
      where: { id: accountId },
      data: { runningBalance: money(Math.max(0, balance - data.amountPaid)) },
    });
    return payment;
  });
}

export async function listAccountSales(branchId: string, accountId: string) {
  const account = await prisma.canteenAccount.findFirst({ where: { id: accountId, branchId } });
  if (!account) httpError(404, 'Account not found');
  return prisma.canteenSale.findMany({
    where: { branchId, canteenAccountId: accountId },
    include: { items: { include: { product: true } } },
    orderBy: { soldAt: 'desc' },
  });
}

// ─── Credit person search (branch students / teachers / staff) ───

export async function searchCreditPersons(
  branchId: string,
  type: CanteenPersonType,
  q?: string,
) {
  const term = q?.trim();

  if (type === CanteenPersonType.STUDENT) {
    const ayId = await activeAcademicYearId(branchId);
    if (!ayId) return [];
    return prisma.student.findMany({
      where: {
        academicYearId: ayId,
        isActive: true,
        status: 'ACTIVE',
        ...(term
          ? {
              OR: [
                { name: { contains: term, mode: 'insensitive' } },
                { rollNumber: { contains: term, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      select: { id: true, name: true, rollNumber: true, phone: true },
      take: 30,
      orderBy: { name: 'asc' },
    });
  }

  if (type === CanteenPersonType.TEACHER) {
    const members = await prisma.branchMember.findMany({
      where: { branchId, isActive: true, role: 'teacher' },
      include: {
        user: {
          select: { id: true, name: true, phone: true, role: true, status: true },
        },
      },
      take: 50,
    });
    return members
      .filter((m) => m.user?.status === 'active' && m.user.role === 'teacher')
      .filter((m) => !term || m.user!.name.toLowerCase().includes(term.toLowerCase()))
      .map((m) => ({ id: m.user!.id, name: m.user!.name, phone: m.user!.phone }));
  }

  const members = await prisma.branchMember.findMany({
    where: {
      branchId,
      isActive: true,
      role: { in: ['branch_admin', 'sub_admin', 'management', 'canteen_staff'] },
    },
    include: {
      user: {
        select: { id: true, name: true, phone: true, role: true, status: true },
      },
    },
    take: 50,
  });
  return members
    .filter((m) => m.user?.status === 'active' && m.user.role !== 'teacher')
    .filter((m) => !term || m.user!.name.toLowerCase().includes(term.toLowerCase()))
    .map((m) => ({ id: m.user!.id, name: m.user!.name, phone: m.user!.phone }));
}

// ─── Sales ────────────────────────────────────────────────────────

type SaleItemInput = { productId: string; quantity: number };

export async function createSale(
  branchId: string,
  data: {
    paymentType: CanteenSalePaymentType;
    items: SaleItemInput[];
    accountId?: string;
    personType?: CanteenPersonType;
    studentId?: string;
    userId?: string;
  },
  createdById?: string,
) {
  if (!data.items.length) httpError(400, 'At least one item is required');

  const products = await prisma.canteenProduct.findMany({
    where: {
      branchId,
      id: { in: data.items.map((i) => i.productId) },
      isActive: true,
    },
  });
  if (products.length !== data.items.length) {
    httpError(400, 'One or more products are invalid or inactive');
  }

  const productMap = new Map(products.map((p) => [p.id, p]));
  let totalAmount = 0;
  const lineItems: { productId: string; quantity: number; unitPriceAtSale: Prisma.Decimal }[] = [];

  for (const item of data.items) {
    if (item.quantity <= 0) httpError(400, 'Quantity must be positive');
    const product = productMap.get(item.productId)!;
    if (product.stockQuantity < item.quantity) {
      httpError(400, `Insufficient stock for ${product.name}`);
    }
    const unitPrice = product.unitPrice;
    totalAmount += Number(unitPrice) * item.quantity;
    lineItems.push({
      productId: item.productId,
      quantity: item.quantity,
      unitPriceAtSale: unitPrice,
    });
  }

  return prisma.$transaction(async (tx) => {
    let canteenAccountId: string | null = null;

    if (data.paymentType === CanteenSalePaymentType.CREDIT) {
      if (data.accountId) {
        const account = await tx.canteenAccount.findFirst({
          where: { id: data.accountId, branchId, isActive: true },
        });
        if (!account) httpError(404, 'Credit account not found');
        canteenAccountId = account.id;
        await tx.canteenAccount.update({
          where: { id: account.id },
          data: { runningBalance: { increment: money(totalAmount) } },
        });
      } else {
        if (!data.personType) httpError(400, 'personType is required for new credit sale');
        const person = await assertBranchCreditPerson({
          branchId,
          personType: data.personType,
          studentId: data.studentId,
          userId: data.userId,
        });
        let account = await tx.canteenAccount.findFirst({
          where: {
            branchId,
            OR: [
              person.studentId ? { studentId: person.studentId } : {},
              person.userId ? { userId: person.userId } : {},
            ].filter((o) => Object.keys(o).length > 0),
          },
        });
        if (!account) {
          account = await tx.canteenAccount.create({
            data: {
              branchId,
              personType: data.personType,
              studentId: person.studentId,
              userId: person.userId,
              displayName: person.displayName,
              displayPhone: person.displayPhone,
              runningBalance: money(totalAmount),
              createdById,
            },
          });
        } else {
          await tx.canteenAccount.update({
            where: { id: account.id },
            data: { runningBalance: { increment: money(totalAmount) } },
          });
        }
        canteenAccountId = account.id;
      }
    }

    const sale = await tx.canteenSale.create({
      data: {
        branchId,
        canteenAccountId,
        paymentType: data.paymentType,
        totalAmount: money(totalAmount),
        createdById,
        items: {
          create: lineItems.map((li) => ({
            branchId,
            productId: li.productId,
            quantity: li.quantity,
            unitPriceAtSale: li.unitPriceAtSale,
          })),
        },
      },
      include: { items: { include: { product: true } }, account: true },
    });

    for (const item of data.items) {
      await tx.canteenProduct.update({
        where: { id: item.productId },
        data: { stockQuantity: { decrement: item.quantity } },
      });
    }

    return sale;
  });
}

export async function listSales(branchId: string, dateStr?: string) {
  const where: Prisma.CanteenSaleWhereInput = { branchId };
  if (dateStr) {
    const { start, end } = dayRange(dateStr);
    where.soldAt = { gte: start, lt: end };
  }
  return prisma.canteenSale.findMany({
    where,
    include: {
      items: { include: { product: true } },
      account: true,
      createdBy: { select: { id: true, name: true } },
    },
    orderBy: { soldAt: 'desc' },
  });
}

export async function getDailySummary(branchId: string, dateStr: string) {
  const { start, end } = dayRange(dateStr);
  const sales = await prisma.canteenSale.findMany({
    where: { branchId, soldAt: { gte: start, lt: end } },
    include: { items: { include: { product: true } } },
  });

  let cashTotal = 0;
  let creditTotal = 0;
  const breakdown = new Map<string, { productName: string; qtySold: number; revenue: number }>();

  for (const sale of sales) {
    const amount = Number(sale.totalAmount);
    if (sale.paymentType === CanteenSalePaymentType.CASH) cashTotal += amount;
    else creditTotal += amount;

    for (const item of sale.items) {
      const key = item.productId;
      const rev = Number(item.unitPriceAtSale) * item.quantity;
      const prev = breakdown.get(key) ?? {
        productName: item.product.name,
        qtySold: 0,
        revenue: 0,
      };
      prev.qtySold += item.quantity;
      prev.revenue += rev;
      breakdown.set(key, prev);
    }
  }

  return {
    date: dateStr,
    totalSales: cashTotal + creditTotal,
    cashTotal,
    creditTotal,
    saleCount: sales.length,
    itemsSoldBreakdown: Array.from(breakdown.values()).sort((a, b) => b.revenue - a.revenue),
  };
}
