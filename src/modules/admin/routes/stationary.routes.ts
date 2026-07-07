import { Router, Request, Response, NextFunction } from 'express';
import { StationaryStockMovementType } from '@prisma/client';
import { prisma } from '../../../lib/prisma';

const router = Router();

const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };

function resolveBranchId(req: Request): string {
  const branchId = (req.query.branchId as string | undefined)
    || (req.body?.branchId as string | undefined)
    || ((req as any).user?.branchIds?.length === 1 ? (req as any).user.branchIds[0] : undefined);
  if (!branchId) throw { status: 400, message: 'branchId is required' };
  return branchId;
}

router.get('/stationary/categories', asyncHandler(async (req, res) => {
  const branchId = resolveBranchId(req);
  const data = await prisma.stationaryCategory.findMany({
    where: { branchId },
    orderBy: { name: 'asc' },
  });
  res.json({ success: true, data });
}));

router.post('/stationary/categories', asyncHandler(async (req, res) => {
  const branchId = resolveBranchId(req);
  const name = String(req.body?.name || '').trim();
  if (!name) throw { status: 400, message: 'name is required' };
  const data = await prisma.stationaryCategory.create({
    data: { branchId, name },
  });
  res.status(201).json({ success: true, data });
}));

router.patch('/stationary/categories/:id', asyncHandler(async (req, res) => {
  const branchId = resolveBranchId(req);
  const current = await prisma.stationaryCategory.findUnique({ where: { id: req.params.id } });
  if (!current || current.branchId !== branchId) throw { status: 404, message: 'Category not found' };
  const data = await prisma.stationaryCategory.update({
    where: { id: req.params.id },
    data: {
      name: req.body?.name ?? undefined,
      isActive: typeof req.body?.isActive === 'boolean' ? req.body.isActive : undefined,
    },
  });
  res.json({ success: true, data });
}));

router.get('/stationary/suppliers', asyncHandler(async (req, res) => {
  const branchId = resolveBranchId(req);
  const data = await prisma.stationarySupplier.findMany({
    where: { branchId },
    orderBy: { name: 'asc' },
  });
  res.json({ success: true, data });
}));

router.post('/stationary/suppliers', asyncHandler(async (req, res) => {
  const branchId = resolveBranchId(req);
  const name = String(req.body?.name || '').trim();
  if (!name) throw { status: 400, message: 'name is required' };
  const data = await prisma.stationarySupplier.create({
    data: {
      branchId,
      name,
      contactNumber: req.body?.contactNumber || null,
      note: req.body?.note || null,
    },
  });
  res.status(201).json({ success: true, data });
}));

router.patch('/stationary/suppliers/:id', asyncHandler(async (req, res) => {
  const branchId = resolveBranchId(req);
  const current = await prisma.stationarySupplier.findUnique({ where: { id: req.params.id } });
  if (!current || current.branchId !== branchId) throw { status: 404, message: 'Supplier not found' };
  const data = await prisma.stationarySupplier.update({
    where: { id: req.params.id },
    data: {
      name: req.body?.name ?? undefined,
      contactNumber: req.body?.contactNumber ?? undefined,
      note: req.body?.note ?? undefined,
      isActive: typeof req.body?.isActive === 'boolean' ? req.body.isActive : undefined,
    },
  });
  res.json({ success: true, data });
}));

router.get('/stationary/products', asyncHandler(async (req, res) => {
  const branchId = resolveBranchId(req);
  const activeOnly = req.query.activeOnly !== 'false';
  const data = await prisma.stationaryProduct.findMany({
    where: { branchId, ...(activeOnly ? { isActive: true } : {}) },
    include: {
      category: true,
      supplier: true,
    },
    orderBy: { name: 'asc' },
  });
  res.json({ success: true, data });
}));

router.post('/stationary/products', asyncHandler(async (req, res) => {
  const branchId = resolveBranchId(req);
  const { categoryId, supplierId, name } = req.body || {};
  const unitPrice = Number(req.body?.unitPrice || 0);
  if (!categoryId || !String(name || '').trim() || unitPrice <= 0) {
    throw { status: 400, message: 'categoryId, name and unitPrice are required' };
  }
  const data = await prisma.stationaryProduct.create({
    data: {
      branchId,
      categoryId,
      supplierId: supplierId || null,
      name: String(name).trim(),
      unitPrice,
      bundlePrice: req.body?.bundlePrice != null ? Number(req.body.bundlePrice) : null,
      unitsPerBundle: req.body?.unitsPerBundle != null ? Number(req.body.unitsPerBundle) : null,
      stockBundles: Number(req.body?.stockBundles || 0),
      stockUnits: Number(req.body?.stockUnits || 0),
      lowStockThreshold: Number(req.body?.lowStockThreshold || 10),
    },
    include: { category: true, supplier: true },
  });
  res.status(201).json({ success: true, data });
}));

router.patch('/stationary/products/:id', asyncHandler(async (req, res) => {
  const branchId = resolveBranchId(req);
  const current = await prisma.stationaryProduct.findUnique({ where: { id: req.params.id } });
  if (!current || current.branchId !== branchId) throw { status: 404, message: 'Product not found' };
  const data = await prisma.stationaryProduct.update({
    where: { id: req.params.id },
    data: {
      categoryId: req.body?.categoryId ?? undefined,
      supplierId: req.body?.supplierId === null ? null : (req.body?.supplierId ?? undefined),
      name: req.body?.name ?? undefined,
      unitPrice: req.body?.unitPrice != null ? Number(req.body.unitPrice) : undefined,
      bundlePrice: req.body?.bundlePrice != null ? Number(req.body.bundlePrice) : undefined,
      unitsPerBundle: req.body?.unitsPerBundle != null ? Number(req.body.unitsPerBundle) : undefined,
      lowStockThreshold: req.body?.lowStockThreshold != null ? Number(req.body.lowStockThreshold) : undefined,
      isActive: typeof req.body?.isActive === 'boolean' ? req.body.isActive : undefined,
    },
    include: { category: true, supplier: true },
  });
  res.json({ success: true, data });
}));

router.get('/stationary/inventory', asyncHandler(async (req, res) => {
  const branchId = resolveBranchId(req);
  const data = await prisma.stationaryProduct.findMany({
    where: { branchId },
    include: { category: true, supplier: true },
    orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
  });
  res.json({ success: true, data });
}));

router.post('/stationary/inventory/adjust', asyncHandler(async (req, res) => {
  const branchId = resolveBranchId(req);
  const { productId, quantityBundles = 0, quantityUnits = 0, note } = req.body || {};
  if (!productId) throw { status: 400, message: 'productId is required' };
  const deltaBundles = Number(quantityBundles || 0);
  const deltaUnits = Number(quantityUnits || 0);
  if (deltaBundles === 0 && deltaUnits === 0) throw { status: 400, message: 'quantityBundles or quantityUnits is required' };

  const data = await prisma.$transaction(async (tx) => {
    const product = await tx.stationaryProduct.findUnique({ where: { id: productId } });
    if (!product || product.branchId !== branchId) throw { status: 404, message: 'Product not found' };
    const nextBundles = product.stockBundles + deltaBundles;
    const nextUnits = product.stockUnits + deltaUnits;
    if (nextBundles < 0 || nextUnits < 0) throw { status: 400, message: 'Insufficient stock for adjustment' };

    const updated = await tx.stationaryProduct.update({
      where: { id: productId },
      data: { stockBundles: nextBundles, stockUnits: nextUnits },
      include: { category: true, supplier: true },
    });
    await tx.stationaryStockMovement.create({
      data: {
        branchId,
        productId,
        movementType: StationaryStockMovementType.ADJUSTMENT,
        quantityBundles: deltaBundles,
        quantityUnits: deltaUnits,
        note: note || null,
        createdById: (req as any).user?.id,
      },
    });
    return updated;
  });

  res.json({ success: true, data });
}));

router.get('/stationary/sales-records', asyncHandler(async (req, res) => {
  const branchId = resolveBranchId(req);
  const search = String(req.query.search || '').trim();
  const data = await prisma.studentStationaryRecord.findMany({
    where: {
      branchId,
      ...(search ? {
        student: {
          name: { contains: search, mode: 'insensitive' },
        },
      } : {}),
    },
    include: {
      student: {
        select: {
          id: true,
          name: true,
          rollNumber: true,
          group: { select: { name: true, section: true } },
        },
      },
      studentFee: { select: { id: true, month: true, year: true } },
      items: true,
    },
    orderBy: { createdAt: 'desc' },
  });
  res.json({ success: true, data });
}));

export default router;
