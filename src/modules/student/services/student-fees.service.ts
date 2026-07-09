import { prisma } from '../../../lib/prisma';
import type { StudentContext } from './student-context.service';

export async function getStudentFees(ctx: StudentContext) {
  const fees = await prisma.studentFee.findMany({
    where: { studentId: ctx.studentId, academicYearId: ctx.academicYearId },
    include: {
      payments: {
        where: { revertedAt: null },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          amount: true,
          createdAt: true,
          receiptNumber: true,
          paymentMethod: true,
        },
      },
      extraItems: { select: { id: true, name: true, amount: true } },
    },
    orderBy: [{ year: 'desc' }, { month: 'desc' }],
  });

  let totalDuePaise = 0;
  let totalPaidPaise = 0;
  let unpaidCount = 0;

  const months = fees.map((fee) => {
    const extraSum = fee.extraItems.reduce((sum, item) => sum + item.amount, 0);
    const due = (fee.totalAmount || fee.netAmount) + extraSum;
    const paid = fee.paidAmount;
    totalDuePaise += due;
    totalPaidPaise += paid;
    if (fee.status === 'UNPAID' || fee.status === 'PARTIAL') unpaidCount += 1;

    return {
      id: fee.id,
      year: fee.year,
      month: fee.month,
      status: fee.status,
      netAmount: fee.netAmount,
      totalAmount: fee.totalAmount,
      paidAmount: fee.paidAmount,
      dueAmount: Math.max(0, due - paid),
      extraItems: fee.extraItems,
      payments: fee.payments,
    };
  });

  return {
    summary: {
      totalDuePaise,
      totalPaidPaise,
      balanceDuePaise: Math.max(0, totalDuePaise - totalPaidPaise),
      unpaidCount,
    },
    months,
  };
}
