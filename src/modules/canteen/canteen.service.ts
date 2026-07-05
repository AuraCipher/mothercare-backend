import {
  CanteenPersonType,
  CanteenSalePaymentType,
  CanteenSupplierPaymentDirection,
  Prisma,
} from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { assertBranchCreditPerson } from './canteen-credit-rules';
import { applyStockDelta, normalizeStock, totalStockUnits } from './canteen-stock';

function httpError(status: number, message: string): never {
  throw { status, message };
}

function money(n: number) {
  return new Prisma.Decimal(n);
}

/** Net supplier balance from purchase total and payment ledger. */
export function computeSupplierBalancesFromLedger(
  totalPurchased: number,
  payments: Array<{ direction: CanteenSupplierPaymentDirection; amount: Prisma.Decimal | number }>,
) {
  const wePaid = payments
    .filter((p) => p.direction === CanteenSupplierPaymentDirection.WE_PAID_SUPPLIER)
    .reduce((sum, p) => sum + Number(p.amount), 0);
  const theyPaid = payments
    .filter((p) => p.direction === CanteenSupplierPaymentDirection.SUPPLIER_PAID_US)
    .reduce((sum, p) => sum + Number(p.amount), 0);

  const netWeOwe = totalPurchased - wePaid + theyPaid;
  if (netWeOwe >= 0) {
    return { balanceOwedToSupplier: netWeOwe, balanceSupplierOwesUs: 0 };
  }
  return { balanceOwedToSupplier: 0, balanceSupplierOwesUs: -netWeOwe };
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

function normalizeName(name: string) {
  return name.trim();
}

async function findCategoryByName(branchId: string, name: string) {
  const trimmed = normalizeName(name);
  if (!trimmed) return null;
  return prisma.canteenProductCategory.findFirst({
    where: { branchId, name: trimmed },
  });
}

async function findSupplierByName(branchId: string, name: string) {
  const trimmed = normalizeName(name);
  if (!trimmed) return null;
  return prisma.canteenSupplier.findFirst({
    where: { branchId, name: trimmed },
  });
}

// ─── Categories ───────────────────────────────────────────────────

export async function listCategories(branchId: string) {
  return prisma.canteenProductCategory.findMany({
    where: { branchId },
    orderBy: { name: 'asc' },
  });
}

export async function createCategory(branchId: string, name: string) {
  const trimmed = normalizeName(name);
  if (!trimmed) httpError(400, 'name is required');

  const existing = await findCategoryByName(branchId, trimmed);
  if (existing) {
    if (!existing.isActive) {
      return prisma.canteenProductCategory.update({
        where: { id: existing.id },
        data: { isActive: true },
      });
    }
    httpError(409, `Category "${trimmed}" already exists`);
  }

  try {
    return await prisma.canteenProductCategory.create({
      data: { branchId, name: trimmed },
    });
  } catch (err: any) {
    if (err?.code === 'P2002') httpError(409, `Category "${trimmed}" already exists`);
    throw err;
  }
}

export async function updateCategory(
  branchId: string,
  id: string,
  data: { name?: string; isActive?: boolean },
) {
  const row = await prisma.canteenProductCategory.findFirst({ where: { id, branchId } });
  if (!row) httpError(404, 'Category not found');

  if (data.name !== undefined) {
    const trimmed = normalizeName(data.name);
    if (!trimmed) httpError(400, 'name is required');
    if (trimmed !== row.name) {
      const duplicate = await findCategoryByName(branchId, trimmed);
      if (duplicate && duplicate.id !== id) {
        httpError(409, `Category "${trimmed}" already exists`);
      }
    }
  }

  try {
    return await prisma.canteenProductCategory.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: normalizeName(data.name) } : {}),
        ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
      },
    });
  } catch (err: any) {
    if (err?.code === 'P2002' && data.name) {
      httpError(409, `Category "${normalizeName(data.name)}" already exists`);
    }
    throw err;
  }
}

// ─── Suppliers ────────────────────────────────────────────────────

export async function listSuppliers(branchId: string) {
  const suppliers = await prisma.canteenSupplier.findMany({
    where: { branchId },
    orderBy: { name: 'asc' },
  });
  if (suppliers.length === 0) return [];

  const supplierIds = suppliers.map((s) => s.id);
  const [purchaseSums, payments] = await Promise.all([
    prisma.canteenRestockPurchase.groupBy({
      by: ['supplierId'],
      where: { branchId, supplierId: { in: supplierIds } },
      _sum: { totalCost: true },
    }),
    prisma.canteenSupplierPayment.findMany({
      where: { supplierId: { in: supplierIds } },
    }),
  ]);

  const purchasedBySupplier = new Map(
    purchaseSums.map((p) => [p.supplierId, Number(p._sum.totalCost ?? 0)]),
  );
  const paymentsBySupplier = new Map<string, typeof payments>();
  for (const payment of payments) {
    const list = paymentsBySupplier.get(payment.supplierId) ?? [];
    list.push(payment);
    paymentsBySupplier.set(payment.supplierId, list);
  }

  const syncUpdates: Array<ReturnType<typeof prisma.canteenSupplier.update>> = [];

  const result = suppliers.map((supplier) => {
    const totalPurchased = purchasedBySupplier.get(supplier.id) ?? 0;
    const supplierPayments = paymentsBySupplier.get(supplier.id) ?? [];
    const balances = computeSupplierBalancesFromLedger(totalPurchased, supplierPayments);

    const storedOwed = Number(supplier.balanceOwedToSupplier);
    const storedOwesUs = Number(supplier.balanceSupplierOwesUs);
    if (
      Math.abs(storedOwed - balances.balanceOwedToSupplier) > 0.009
      || Math.abs(storedOwesUs - balances.balanceSupplierOwesUs) > 0.009
    ) {
      syncUpdates.push(
        prisma.canteenSupplier.update({
          where: { id: supplier.id },
          data: {
            balanceOwedToSupplier: money(balances.balanceOwedToSupplier),
            balanceSupplierOwesUs: money(balances.balanceSupplierOwesUs),
          },
        }),
      );
    }

    return {
      ...supplier,
      balanceOwedToSupplier: money(balances.balanceOwedToSupplier),
      balanceSupplierOwesUs: money(balances.balanceSupplierOwesUs),
    };
  });

  if (syncUpdates.length > 0) {
    await Promise.all(syncUpdates);
  }

  return result;
}

export async function getSupplier(branchId: string, id: string) {
  const supplier = await prisma.canteenSupplier.findFirst({ where: { id, branchId } });
  if (!supplier) httpError(404, 'Supplier not found');
  return supplier;
}

export async function listSupplierRestockPurchases(branchId: string, supplierId: string) {
  const supplier = await prisma.canteenSupplier.findFirst({ where: { id: supplierId, branchId } });
  if (!supplier) httpError(404, 'Supplier not found');
  return prisma.canteenRestockPurchase.findMany({
    where: { branchId, supplierId },
    include: {
      items: { include: { product: true } },
      createdBy: { select: { id: true, name: true } },
    },
    orderBy: { purchaseDate: 'desc' },
  });
}

export async function getSupplierDetail(branchId: string, supplierId: string) {
  const supplier = await getSupplier(branchId, supplierId);
  const [purchases, payments] = await Promise.all([
    listSupplierRestockPurchases(branchId, supplierId),
    listSupplierPayments(branchId, supplierId),
  ]);
  const totalPurchased = purchases.reduce((sum, p) => sum + Number(p.totalCost), 0);
  const totalPaid = payments
    .filter((p) => p.direction === CanteenSupplierPaymentDirection.WE_PAID_SUPPLIER)
    .reduce((sum, p) => sum + Number(p.amount), 0);
  const balances = computeSupplierBalancesFromLedger(totalPurchased, payments);

  const storedOwed = Number(supplier.balanceOwedToSupplier);
  const storedOwesUs = Number(supplier.balanceSupplierOwesUs);
  let currentSupplier = supplier;
  if (
    Math.abs(storedOwed - balances.balanceOwedToSupplier) > 0.009
    || Math.abs(storedOwesUs - balances.balanceSupplierOwesUs) > 0.009
  ) {
    currentSupplier = await prisma.canteenSupplier.update({
      where: { id: supplierId },
      data: {
        balanceOwedToSupplier: money(balances.balanceOwedToSupplier),
        balanceSupplierOwesUs: money(balances.balanceSupplierOwesUs),
      },
    });
  }

  return {
    supplier: currentSupplier,
    stats: {
      totalPurchased,
      totalPaid,
      remainingOwed: balances.balanceOwedToSupplier,
      theyOweUs: balances.balanceSupplierOwesUs,
      purchaseCount: purchases.length,
      paymentCount: payments.length,
    },
    purchases,
    payments,
  };
}

export async function createSupplier(
  branchId: string,
  data: { name: string; contactNumber?: string; note?: string },
  createdById?: string,
) {
  const trimmed = normalizeName(data.name);
  if (!trimmed) httpError(400, 'name is required');

  const existing = await findSupplierByName(branchId, trimmed);
  if (existing) {
    if (!existing.isActive) {
      return prisma.canteenSupplier.update({
        where: { id: existing.id },
        data: {
          isActive: true,
          contactNumber: data.contactNumber?.trim() || existing.contactNumber,
          note: data.note?.trim() || existing.note,
        },
      });
    }
    httpError(409, `Supplier "${trimmed}" already exists`);
  }

  try {
    return await prisma.canteenSupplier.create({
      data: {
        branchId,
        name: trimmed,
        contactNumber: data.contactNumber?.trim() || null,
        note: data.note?.trim() || null,
        createdById,
      },
    });
  } catch (err: any) {
    if (err?.code === 'P2002') httpError(409, `Supplier "${trimmed}" already exists`);
    throw err;
  }
}

export async function updateSupplier(
  branchId: string,
  id: string,
  data: { name?: string; contactNumber?: string; note?: string; isActive?: boolean },
) {
  const row = await prisma.canteenSupplier.findFirst({ where: { id, branchId } });
  if (!row) httpError(404, 'Supplier not found');

  if (data.name !== undefined) {
    const trimmed = normalizeName(data.name);
    if (!trimmed) httpError(400, 'name is required');
    if (trimmed !== row.name) {
      const duplicate = await findSupplierByName(branchId, trimmed);
      if (duplicate && duplicate.id !== id) {
        httpError(409, `Supplier "${trimmed}" already exists`);
      }
    }
  }

  try {
    return await prisma.canteenSupplier.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: normalizeName(data.name) } : {}),
        ...(data.contactNumber !== undefined ? { contactNumber: data.contactNumber?.trim() || null } : {}),
        ...(data.note !== undefined ? { note: data.note?.trim() || null } : {}),
        ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
      },
    });
  } catch (err: any) {
    if (err?.code === 'P2002' && data.name) {
      httpError(409, `Supplier "${normalizeName(data.name)}" already exists`);
    }
    throw err;
  }
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
      const owesUs = Number(supplier.balanceSupplierOwesUs);
      let remaining = data.amount;
      const appliedToOwed = Math.min(owed, remaining);
      remaining -= appliedToOwed;
      await tx.canteenSupplier.update({
        where: { id: supplierId },
        data: {
          balanceOwedToSupplier: money(owed - appliedToOwed),
          balanceSupplierOwesUs: money(owesUs + remaining),
        },
      });
    } else {
      const owesUs = Number(supplier.balanceSupplierOwesUs);
      const owed = Number(supplier.balanceOwedToSupplier);
      let remaining = data.amount;
      const appliedToOwesUs = Math.min(owesUs, remaining);
      remaining -= appliedToOwesUs;
      await tx.canteenSupplier.update({
        where: { id: supplierId },
        data: {
          balanceSupplierOwesUs: money(owesUs - appliedToOwesUs),
          balanceOwedToSupplier: money(owed + remaining),
        },
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
    boxPrice?: number;
    unitsPerBox?: number;
    stockBoxes?: number;
    stockUnits?: number;
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

  const trimmed = normalizeName(data.name);
  if (!trimmed) httpError(400, 'name is required');
  if (data.unitPrice < 0) httpError(400, 'unitPrice must be zero or positive');
  if (data.boxPrice != null && data.boxPrice < 0) httpError(400, 'boxPrice must be zero or positive');
  if (data.unitsPerBox != null && data.unitsPerBox < 1) {
    httpError(400, 'unitsPerBox must be at least 1');
  }

  const existing = await prisma.canteenProduct.findFirst({
    where: { branchId, categoryId: data.categoryId, name: trimmed },
  });
  if (existing) {
    if (!existing.isActive) {
      return prisma.canteenProduct.update({
        where: { id: existing.id },
        data: {
          isActive: true,
          unitPrice: money(data.unitPrice),
          ...(data.boxPrice != null ? { boxPrice: money(data.boxPrice) } : {}),
          ...(data.unitsPerBox != null ? { unitsPerBox: data.unitsPerBox } : {}),
          lowStockThreshold: data.lowStockThreshold ?? existing.lowStockThreshold,
          supplierId: data.supplierId || null,
        },
        include: { category: true, supplier: true },
      });
    }
    httpError(409, `Product "${trimmed}" already exists in this category`);
  }

  try {
    const opening = normalizeStock(
      data.stockBoxes ?? 0,
      data.stockUnits ?? 0,
      data.unitsPerBox,
    );
    return await prisma.canteenProduct.create({
      data: {
        branchId,
        categoryId: data.categoryId,
        supplierId: data.supplierId || null,
        name: trimmed,
        unitPrice: money(data.unitPrice),
        boxPrice: data.boxPrice != null ? money(data.boxPrice) : null,
        unitsPerBox: data.unitsPerBox ?? null,
        stockBoxes: opening.stockBoxes,
        stockUnits: opening.stockUnits,
        lowStockThreshold: data.lowStockThreshold ?? 5,
        createdById,
      },
      include: { category: true, supplier: true },
    });
  } catch (err: any) {
    if (err?.code === 'P2002') httpError(409, `Product "${trimmed}" already exists in this category`);
    throw err;
  }
}

export async function updateProduct(
  branchId: string,
  id: string,
  data: {
    categoryId?: string;
    supplierId?: string | null;
    name?: string;
    unitPrice?: number;
    boxPrice?: number | null;
    unitsPerBox?: number | null;
    lowStockThreshold?: number;
    stockBoxes?: number;
    stockUnits?: number;
    isActive?: boolean;
  },
) {
  const product = await prisma.canteenProduct.findFirst({ where: { id, branchId } });
  if (!product) httpError(404, 'Product not found');

  let stockPatch: { stockBoxes: number; stockUnits: number } | undefined;
  if (data.stockBoxes !== undefined || data.stockUnits !== undefined) {
    try {
      stockPatch = normalizeStock(
        data.stockBoxes ?? product.stockBoxes,
        data.stockUnits ?? product.stockUnits,
        data.unitsPerBox ?? product.unitsPerBox,
      );
    } catch (err: any) {
      if (err?.status) throw err;
      throw err;
    }
  } else if (data.unitsPerBox !== undefined && data.unitsPerBox !== product.unitsPerBox) {
    stockPatch = normalizeStock(product.stockBoxes, product.stockUnits, data.unitsPerBox);
  }

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

  const nextCategoryId = data.categoryId ?? product.categoryId;
  if (data.name !== undefined) {
    const trimmed = normalizeName(data.name);
    if (!trimmed) httpError(400, 'name is required');
    if (trimmed !== product.name || nextCategoryId !== product.categoryId) {
      const duplicate = await prisma.canteenProduct.findFirst({
        where: { branchId, categoryId: nextCategoryId, name: trimmed, NOT: { id } },
      });
      if (duplicate) httpError(409, `Product "${trimmed}" already exists in this category`);
    }
  } else if (data.categoryId && data.categoryId !== product.categoryId) {
    const duplicate = await prisma.canteenProduct.findFirst({
      where: { branchId, categoryId: data.categoryId, name: product.name, NOT: { id } },
    });
    if (duplicate) httpError(409, `Product "${product.name}" already exists in this category`);
  }

  try {
    return await prisma.canteenProduct.update({
      where: { id },
      data: {
        ...(data.categoryId !== undefined ? { categoryId: data.categoryId } : {}),
        ...(data.supplierId !== undefined ? { supplierId: data.supplierId } : {}),
        ...(data.name !== undefined ? { name: normalizeName(data.name) } : {}),
        ...(data.unitPrice !== undefined ? { unitPrice: money(data.unitPrice) } : {}),
        ...(data.boxPrice !== undefined ? { boxPrice: data.boxPrice == null ? null : money(data.boxPrice) } : {}),
        ...(data.unitsPerBox !== undefined ? { unitsPerBox: data.unitsPerBox } : {}),
        ...(data.lowStockThreshold !== undefined ? { lowStockThreshold: data.lowStockThreshold } : {}),
        ...(stockPatch ? { stockBoxes: stockPatch.stockBoxes, stockUnits: stockPatch.stockUnits } : {}),
        ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
      },
      include: { category: true, supplier: true },
    });
  } catch (err: any) {
    if (err?.code === 'P2002') {
      const label = data.name ? normalizeName(data.name) : product.name;
      httpError(409, `Product "${label}" already exists in this category`);
    }
    throw err;
  }
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

  for (const item of data.items) {
    if (!item.productId?.trim()) httpError(400, 'Each line must have a product');
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
      httpError(400, 'Quantity must be a positive whole number');
    }
    if (!Number.isFinite(item.unitCost) || item.unitCost < 0) {
      httpError(400, 'Unit cost must be zero or positive');
    }
  }

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
      const product = await tx.canteenProduct.findFirst({ where: { id: item.productId, branchId } });
      if (!product) httpError(400, 'Product not found in this branch');
      let next: { stockBoxes: number; stockUnits: number };
      try {
        next = applyStockDelta(product.stockBoxes, product.stockUnits, item.quantity, product.unitsPerBox);
      } catch (err: any) {
        if (err?.status) throw err;
        throw err;
      }
      await tx.canteenProduct.update({
        where: { id: item.productId },
        data: next,
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
    where: { branchId, canteenAccountId: accountId, paymentType: CanteenSalePaymentType.CREDIT },
    include: {
      items: { include: { product: true } },
      createdBy: { select: { id: true, name: true } },
    },
    orderBy: { soldAt: 'desc' },
  });
}

export async function listAccountPayments(branchId: string, accountId: string) {
  const account = await prisma.canteenAccount.findFirst({ where: { id: accountId, branchId } });
  if (!account) httpError(404, 'Account not found');
  return prisma.canteenAccountPayment.findMany({
    where: { canteenAccountId: accountId },
    include: { createdBy: { select: { id: true, name: true } } },
    orderBy: { paidAt: 'desc' },
  });
}

export async function getAccountDetail(branchId: string, accountId: string) {
  const account = await getAccount(branchId, accountId);
  const [sales, payments] = await Promise.all([
    listAccountSales(branchId, accountId),
    listAccountPayments(branchId, accountId),
  ]);
  const totalOrdered = sales.reduce((sum, s) => sum + Number(s.totalAmount), 0);
  const totalPaid = payments.reduce((sum, p) => sum + Number(p.amountPaid), 0);
  return {
    account,
    stats: {
      totalOrdered,
      totalPaid,
      remaining: Number(account.runningBalance),
      orderCount: sales.length,
      paymentCount: payments.length,
    },
    sales,
    payments,
  };
}

// ─── Credit person search (branch students / teachers / staff) ───

export async function searchCreditPersons(
  branchId: string,
  type: CanteenPersonType,
  q?: string,
  groupId?: string,
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
        ...(groupId ? { groupId } : {}),
        ...(term
          ? {
              OR: [
                { name: { contains: term, mode: 'insensitive' } },
                { rollNumber: { contains: term, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        name: true,
        rollNumber: true,
        phone: true,
        group: { select: { name: true, section: true } },
      },
      take: 50,
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

export async function listCreditStudentClasses(branchId: string) {
  const ayId = await activeAcademicYearId(branchId);
  if (!ayId) return [];
  return prisma.group.findMany({
    where: { academicYearId: ayId, isActive: true },
    select: { id: true, name: true, section: true, displayOrder: true },
    orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
  });
}

// ─── Sales ────────────────────────────────────────────────────────

type SaleItemInput = { productId: string; quantity: number };

type PricedSaleItem = { productId: string; quantity: number; unitPrice: number };

/** Allocate whole units to cash first (in line order), remainder to credit. */
export function splitSaleItemsByCashAmount(
  items: PricedSaleItem[],
  cashAmount: number,
): { cashItems: SaleItemInput[]; creditItems: SaleItemInput[] } {
  const { taken, remainder } = splitPricedItemsByAmount(items, cashAmount);
  return { cashItems: taken, creditItems: pricedItemsToSaleInputs(remainder) };
}

function pricedItemsToSaleInputs(items: PricedSaleItem[]): SaleItemInput[] {
  const out: SaleItemInput[] = [];
  for (const line of items) {
    const existing = out.find((i) => i.productId === line.productId);
    if (existing) existing.quantity += line.quantity;
    else out.push({ productId: line.productId, quantity: line.quantity });
  }
  return out;
}

/** Take units worth up to `amount` from the front of the list; return taken + leftover pool. */
export function splitPricedItemsByAmount(
  items: PricedSaleItem[],
  amount: number,
): { taken: SaleItemInput[]; remainder: PricedSaleItem[] } {
  let budget = Math.round(amount * 100) / 100;
  const taken: SaleItemInput[] = [];
  const remainder: PricedSaleItem[] = [];

  const pushTaken = (productId: string, qty: number) => {
    const existing = taken.find((i) => i.productId === productId);
    if (existing) existing.quantity += qty;
    else taken.push({ productId, quantity: qty });
  };

  for (const line of items) {
    let qtyLeft = line.quantity;
    while (qtyLeft > 0 && budget >= line.unitPrice - 0.005) {
      pushTaken(line.productId, 1);
      budget = Math.round((budget - line.unitPrice) * 100) / 100;
      qtyLeft -= 1;
    }
    if (qtyLeft > 0) {
      remainder.push({ productId: line.productId, quantity: qtyLeft, unitPrice: line.unitPrice });
    }
  }

  return { taken, remainder };
}

function pricedItemsFromSaleInputs(
  items: SaleItemInput[],
  productMap: Map<string, { unitPrice: Prisma.Decimal }>,
): PricedSaleItem[] {
  return items.map((item) => ({
    productId: item.productId,
    quantity: item.quantity,
    unitPrice: Number(productMap.get(item.productId)!.unitPrice),
  }));
}

async function resolveCreditAccountId(
  tx: any,
  branchId: string,
  creditAmount: number,
  data: {
    accountId?: string;
    personType?: CanteenPersonType;
    studentId?: string;
    userId?: string;
  },
  createdById?: string,
) {
  if (creditAmount <= 0) return null;

  if (data.accountId) {
    const account = await tx.canteenAccount.findFirst({
      where: { id: data.accountId, branchId, isActive: true },
    });
    if (!account) httpError(404, 'Credit account not found');
    await tx.canteenAccount.update({
      where: { id: account.id },
      data: { runningBalance: { increment: money(creditAmount) } },
    });
    return account.id;
  }

  if (!data.personType) httpError(400, 'personType is required for credit portion');
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
        runningBalance: money(creditAmount),
        createdById,
      },
    });
  } else {
    await tx.canteenAccount.update({
      where: { id: account.id },
      data: { runningBalance: { increment: money(creditAmount) } },
    });
  }

  return account.id;
}

async function createSaleRecord(
  tx: any,
  branchId: string,
  data: {
    paymentType: CanteenSalePaymentType;
    lineItems: { productId: string; quantity: number; unitPriceAtSale: Prisma.Decimal }[];
    totalAmount: number;
    canteenAccountId: string | null;
  },
  createdById?: string,
) {
  return tx.canteenSale.create({
    data: {
      branchId,
      canteenAccountId: data.canteenAccountId,
      paymentType: data.paymentType,
      totalAmount: money(data.totalAmount),
      createdById,
      items: {
        create: data.lineItems.map((li) => ({
          branchId,
          productId: li.productId,
          quantity: li.quantity,
          unitPriceAtSale: li.unitPriceAtSale,
        })),
      },
    },
    include: { items: { include: { product: true } }, account: true },
  });
}

function lineItemsTotal(
  lineItems: { quantity: number; unitPriceAtSale: Prisma.Decimal }[],
) {
  return lineItems.reduce((sum, li) => sum + Number(li.unitPriceAtSale) * li.quantity, 0);
}

function buildPricedLineItems(
  items: SaleItemInput[],
  productMap: Map<string, { id: string; name: string; unitPrice: Prisma.Decimal; stockBoxes: number; stockUnits: number; unitsPerBox: number | null }>,
) {
  const lineItems: { productId: string; quantity: number; unitPriceAtSale: Prisma.Decimal }[] = [];
  for (const item of items) {
    if (item.quantity <= 0) httpError(400, 'Quantity must be positive');
    const product = productMap.get(item.productId)!;
    const onHand = totalStockUnits(product.stockBoxes, product.stockUnits, product.unitsPerBox);
    if (onHand < item.quantity) {
      httpError(400, `Insufficient stock for ${product.name}`);
    }
    lineItems.push({
      productId: item.productId,
      quantity: item.quantity,
      unitPriceAtSale: product.unitPrice,
    });
  }
  return lineItems;
}

type CreditAllocationInput = {
  personType: CanteenPersonType;
  amount: number;
  studentId?: string;
  userId?: string;
  accountId?: string;
};

export async function createSaleWithPaymentSplit(
  branchId: string,
  data: {
    items: SaleItemInput[];
    cashAmount: number;
    creditAmount: number;
    accountId?: string;
    personType?: CanteenPersonType;
    studentId?: string;
    userId?: string;
    creditAllocations?: CreditAllocationInput[];
  },
  createdById?: string,
) {
  if (!data.items.length) httpError(400, 'At least one item is required');
  if (data.cashAmount < 0 || data.creditAmount < 0) {
    httpError(400, 'Cash and credit amounts must be zero or positive');
  }
  if (data.cashAmount === 0 && data.creditAmount === 0) {
    httpError(400, 'Enter cash and/or credit amount');
  }

  const allocations = data.creditAllocations?.filter((a) => a.amount > 0) ?? [];
  if (data.creditAmount > 0) {
    if (allocations.length > 0) {
      const allocTotal = allocations.reduce((sum, a) => sum + a.amount, 0);
      if (Math.abs(allocTotal - data.creditAmount) > 0.02) {
        httpError(400, `Credit allocations (${allocTotal}) must equal total credit (${data.creditAmount})`);
      }
    } else if (!data.accountId && !data.personType) {
      httpError(400, 'Credit allocations or account/person is required for credit portion');
    }
  }

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
  const allLineItems = buildPricedLineItems(data.items, productMap);
  const itemsTotal = lineItemsTotal(allLineItems);
  const paymentTotal = Math.round((data.cashAmount + data.creditAmount) * 100) / 100;

  if (Math.abs(itemsTotal - paymentTotal) > 0.02) {
    httpError(400, `Cash + credit (${paymentTotal}) must equal products total (${itemsTotal})`);
  }

  const pricedItems = allLineItems.map((li) => ({
    productId: li.productId,
    quantity: li.quantity,
    unitPrice: Number(li.unitPriceAtSale),
  }));
  const { cashItems, creditItems } = splitSaleItemsByCashAmount(pricedItems, data.cashAmount);

  const cashLineItems = cashItems.length
    ? buildPricedLineItems(cashItems, productMap)
    : [];
  const creditLineItems = creditItems.length
    ? buildPricedLineItems(creditItems, productMap)
    : [];

  const cashTotal = lineItemsTotal(cashLineItems);
  const creditTotal = lineItemsTotal(creditLineItems);

  if (Math.abs(cashTotal - data.cashAmount) > 0.02 || Math.abs(creditTotal - data.creditAmount) > 0.02) {
    httpError(400, 'Could not split products between cash and credit — adjust amounts');
  }

  return prisma.$transaction(async (tx) => {
    const sales = [];

    if (cashLineItems.length > 0) {
      sales.push(await createSaleRecord(tx, branchId, {
        paymentType: CanteenSalePaymentType.CASH,
        lineItems: cashLineItems,
        totalAmount: cashTotal,
        canteenAccountId: null,
      }, createdById));
    }

    if (creditLineItems.length > 0) {
      let creditPool = pricedItemsFromSaleInputs(creditItems, productMap);

      if (allocations.length > 0) {
        for (const allocation of allocations) {
          const { taken, remainder } = splitPricedItemsByAmount(creditPool, allocation.amount);
          if (taken.length === 0) {
            httpError(400, 'Could not split products for a credit allocation — adjust amounts');
          }
          const takenLineItems = buildPricedLineItems(taken, productMap);
          const takenTotal = lineItemsTotal(takenLineItems);
          if (Math.abs(takenTotal - allocation.amount) > 0.02) {
            httpError(400, 'Could not match a credit allocation to product units — adjust amounts');
          }
          const accountId = await resolveCreditAccountId(
            tx,
            branchId,
            takenTotal,
            allocation,
            createdById,
          );
          sales.push(await createSaleRecord(tx, branchId, {
            paymentType: CanteenSalePaymentType.CREDIT,
            lineItems: takenLineItems,
            totalAmount: takenTotal,
            canteenAccountId: accountId,
          }, createdById));
          creditPool = remainder;
        }
        if (creditPool.length > 0) {
          httpError(400, 'Credit allocations did not cover all credit items');
        }
      } else {
        const accountId = await resolveCreditAccountId(
          tx,
          branchId,
          creditTotal,
          data,
          createdById,
        );
        sales.push(await createSaleRecord(tx, branchId, {
          paymentType: CanteenSalePaymentType.CREDIT,
          lineItems: creditLineItems,
          totalAmount: creditTotal,
          canteenAccountId: accountId,
        }, createdById));
      }
    }

    for (const item of data.items) {
      const product = productMap.get(item.productId)!;
      const next = applyStockDelta(
        product.stockBoxes,
        product.stockUnits,
        -item.quantity,
        product.unitsPerBox,
      );
      await tx.canteenProduct.update({
        where: { id: item.productId },
        data: next,
      });
    }

    return sales;
  });
}

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
    const onHand = totalStockUnits(product.stockBoxes, product.stockUnits, product.unitsPerBox);
    if (onHand < item.quantity) {
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
      const product = productMap.get(item.productId)!;
      const next = applyStockDelta(
        product.stockBoxes,
        product.stockUnits,
        -item.quantity,
        product.unitsPerBox,
      );
      await tx.canteenProduct.update({
        where: { id: item.productId },
        data: next,
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
