import { Router, Request, Response, NextFunction } from 'express';
import auth from '../../middleware/auth/auth.middleware';
import {
  requireCanteenBranch,
  requireCanteenAdmin,
  requireCanteenSales,
  getCanteenBranchId,
  getCanteenUserId,
} from './canteen-access.middleware';
import * as canteenService from './canteen.service';
import { CanteenPersonType, CanteenSalePaymentType, CanteenSupplierPaymentDirection } from '@prisma/client';

const router = Router();

const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };

router.use(auth);
router.use(requireCanteenBranch);

// ─── Sales & POS (admin + canteen_staff) ──────────────────────────

router.get('/products', requireCanteenSales, asyncHandler(async (req, res) => {
  const branchId = getCanteenBranchId(req);
  const activeOnly = req.query.activeOnly !== 'false';
  const data = await canteenService.listProducts(branchId, activeOnly);
  res.json({ success: true, data });
}));

router.get('/credit-persons', requireCanteenSales, asyncHandler(async (req, res) => {
  const branchId = getCanteenBranchId(req);
  const type = req.query.type as CanteenPersonType;
  if (!type || !Object.values(CanteenPersonType).includes(type)) {
    res.status(400).json({ success: false, message: 'type must be STUDENT, TEACHER, or STAFF' });
    return;
  }
  const data = await canteenService.searchCreditPersons(branchId, type, req.query.q as string);
  res.json({ success: true, data });
}));

router.get('/accounts', requireCanteenSales, asyncHandler(async (req, res) => {
  const data = await canteenService.listAccounts(getCanteenBranchId(req));
  res.json({ success: true, data });
}));

router.get('/accounts/:id', requireCanteenSales, asyncHandler(async (req, res) => {
  const data = await canteenService.getAccount(getCanteenBranchId(req), req.params.id);
  res.json({ success: true, data });
}));

router.get('/accounts/:id/sales', requireCanteenSales, asyncHandler(async (req, res) => {
  const data = await canteenService.listAccountSales(getCanteenBranchId(req), req.params.id);
  res.json({ success: true, data });
}));

router.post('/sales', requireCanteenSales, asyncHandler(async (req, res) => {
  const branchId = getCanteenBranchId(req);
  const { paymentType, items, accountId, personType, studentId, userId } = req.body;
  if (!paymentType || !Object.values(CanteenSalePaymentType).includes(paymentType)) {
    res.status(400).json({ success: false, message: 'paymentType must be CASH or CREDIT' });
    return;
  }
  const data = await canteenService.createSale(
    branchId,
    { paymentType, items: items || [], accountId, personType, studentId, userId },
    getCanteenUserId(req),
  );
  res.status(201).json({ success: true, data });
}));

router.get('/sales', requireCanteenSales, asyncHandler(async (req, res) => {
  const data = await canteenService.listSales(
    getCanteenBranchId(req),
    req.query.date as string | undefined,
  );
  res.json({ success: true, data });
}));

router.get('/summary', requireCanteenSales, asyncHandler(async (req, res) => {
  const date = (req.query.date as string) || new Date().toISOString().slice(0, 10);
  const data = await canteenService.getDailySummary(getCanteenBranchId(req), date);
  res.json({ success: true, data });
}));

// ─── Admin-only catalog & ledger ──────────────────────────────────

router.use(requireCanteenAdmin);

router.get('/categories', asyncHandler(async (req, res) => {
  const data = await canteenService.listCategories(getCanteenBranchId(req));
  res.json({ success: true, data });
}));

router.post('/categories', asyncHandler(async (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) {
    res.status(400).json({ success: false, message: 'name is required' });
    return;
  }
  const data = await canteenService.createCategory(getCanteenBranchId(req), name);
  res.status(201).json({ success: true, data });
}));

router.patch('/categories/:id', asyncHandler(async (req, res) => {
  const data = await canteenService.updateCategory(
    getCanteenBranchId(req),
    req.params.id,
    req.body,
  );
  res.json({ success: true, data });
}));

router.get('/suppliers', asyncHandler(async (req, res) => {
  const data = await canteenService.listSuppliers(getCanteenBranchId(req));
  res.json({ success: true, data });
}));

router.post('/suppliers', asyncHandler(async (req, res) => {
  const { name, contactNumber } = req.body;
  if (!name?.trim()) {
    res.status(400).json({ success: false, message: 'name is required' });
    return;
  }
  const data = await canteenService.createSupplier(
    getCanteenBranchId(req),
    { name, contactNumber },
    getCanteenUserId(req),
  );
  res.status(201).json({ success: true, data });
}));

router.patch('/suppliers/:id', asyncHandler(async (req, res) => {
  const data = await canteenService.updateSupplier(
    getCanteenBranchId(req),
    req.params.id,
    req.body,
  );
  res.json({ success: true, data });
}));

router.get('/suppliers/:id/payments', asyncHandler(async (req, res) => {
  const data = await canteenService.listSupplierPayments(
    getCanteenBranchId(req),
    req.params.id,
  );
  res.json({ success: true, data });
}));

router.post('/suppliers/:id/payments', asyncHandler(async (req, res) => {
  const { amount, direction, note } = req.body;
  if (!amount || amount <= 0) {
    res.status(400).json({ success: false, message: 'amount must be positive' });
    return;
  }
  if (!direction || !Object.values(CanteenSupplierPaymentDirection).includes(direction)) {
    res.status(400).json({ success: false, message: 'Invalid payment direction' });
    return;
  }
  const data = await canteenService.logSupplierPayment(
    getCanteenBranchId(req),
    req.params.id,
    { amount, direction, note },
    getCanteenUserId(req),
  );
  res.status(201).json({ success: true, data });
}));

router.post('/products', asyncHandler(async (req, res) => {
  const { categoryId, supplierId, name, unitPrice, boxPrice, unitsPerBox, stockQuantity, lowStockThreshold } = req.body;
  if (!categoryId || !name?.trim() || unitPrice == null) {
    res.status(400).json({ success: false, message: 'categoryId, name, and unitPrice are required' });
    return;
  }
  const data = await canteenService.createProduct(
    getCanteenBranchId(req),
    { categoryId, supplierId, name, unitPrice, boxPrice, unitsPerBox, stockQuantity, lowStockThreshold },
    getCanteenUserId(req),
  );
  res.status(201).json({ success: true, data });
}));

router.patch('/products/:id', asyncHandler(async (req, res) => {
  const data = await canteenService.updateProduct(
    getCanteenBranchId(req),
    req.params.id,
    req.body,
  );
  res.json({ success: true, data });
}));

router.delete('/products/:id', asyncHandler(async (req, res) => {
  const data = await canteenService.deactivateProduct(getCanteenBranchId(req), req.params.id);
  res.json({ success: true, data });
}));

router.post('/restock-purchases', asyncHandler(async (req, res) => {
  const { supplierId, items, note, paidImmediately } = req.body;
  if (!supplierId || !items?.length) {
    res.status(400).json({ success: false, message: 'supplierId and items are required' });
    return;
  }
  const data = await canteenService.createRestockPurchase(
    getCanteenBranchId(req),
    { supplierId, items, note, paidImmediately },
    getCanteenUserId(req),
  );
  res.status(201).json({ success: true, data });
}));

router.get('/restock-purchases', asyncHandler(async (req, res) => {
  const data = await canteenService.listRestockPurchases(getCanteenBranchId(req));
  res.json({ success: true, data });
}));

router.post('/accounts', asyncHandler(async (req, res) => {
  const { personType, studentId, userId } = req.body;
  if (!personType || !Object.values(CanteenPersonType).includes(personType)) {
    res.status(400).json({ success: false, message: 'personType is required' });
    return;
  }
  const data = await canteenService.createAccount(
    getCanteenBranchId(req),
    { personType, studentId, userId },
    getCanteenUserId(req),
  );
  res.status(201).json({ success: true, data });
}));

router.post('/accounts/:id/payments', asyncHandler(async (req, res) => {
  const { amountPaid, note } = req.body;
  if (!amountPaid || amountPaid <= 0) {
    res.status(400).json({ success: false, message: 'amountPaid must be positive' });
    return;
  }
  const data = await canteenService.recordAccountPayment(
    getCanteenBranchId(req),
    req.params.id,
    { amountPaid, note },
    getCanteenUserId(req),
  );
  res.status(201).json({ success: true, data });
}));

export default router;
