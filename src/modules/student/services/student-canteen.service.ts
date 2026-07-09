import { prisma } from '../../../lib/prisma';
import type { StudentContext } from './student-context.service';

export async function getStudentCanteen(ctx: StudentContext) {
  const account = await prisma.canteenAccount.findFirst({
    where: {
      studentId: ctx.studentId,
      branchId: ctx.branchId,
      isActive: true,
    },
    select: {
      id: true,
      displayName: true,
      runningBalance: true,
      payments: {
        orderBy: { paidAt: 'desc' },
        take: 30,
        select: {
          id: true,
          amountPaid: true,
          paidAt: true,
          note: true,
        },
      },
      sales: {
        orderBy: { soldAt: 'desc' },
        take: 30,
        select: {
          id: true,
          totalAmount: true,
          paymentType: true,
          soldAt: true,
        },
      },
    },
  });

  if (!account) {
    return null;
  }

  return {
    id: account.id,
    displayName: account.displayName,
    runningBalance: Number(account.runningBalance),
    payments: account.payments.map((p) => ({
      id: p.id,
      amountPaid: Number(p.amountPaid),
      paidAt: p.paidAt,
      note: p.note,
    })),
    sales: account.sales.map((s) => ({
      id: s.id,
      totalAmount: Number(s.totalAmount),
      paymentType: s.paymentType,
      soldAt: s.soldAt,
    })),
  };
}
