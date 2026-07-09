import { prisma } from '../../../lib/prisma';
import type { StudentContext } from './student-context.service';

export interface StudentBootstrapData {
  user: {
    id: string;
    name: string;
    email: string | null;
    username: string | null;
    role: string;
    profilePhotoId: string | null;
  };
  student: {
    id: string;
    name: string;
    rollNumber: string | null;
    groupId: string | null;
    groupLabel: string | null;
  };
  branch: { id: string; name: string; code: string };
  academicYear: { id: string; label: string; status: string };
  features: {
    showCanteen: boolean;
  };
}

async function resolveShowCanteen(ctx: StudentContext): Promise<boolean> {
  const account = await prisma.canteenAccount.findFirst({
    where: {
      studentId: ctx.studentId,
      branchId: ctx.branchId,
      isActive: true,
    },
    select: {
      runningBalance: true,
      _count: { select: { payments: true, sales: true } },
    },
  });
  if (!account) return false;
  if (Number(account.runningBalance) !== 0) return true;
  return account._count.payments > 0 || account._count.sales > 0;
}

export async function buildBootstrapResponse(
  ctx: StudentContext,
  user: StudentBootstrapData['user'],
): Promise<StudentBootstrapData> {
  const showCanteen = await resolveShowCanteen(ctx);
  return {
    user,
    student: {
      id: ctx.studentId,
      name: ctx.studentName,
      rollNumber: ctx.rollNumber,
      groupId: ctx.groupId,
      groupLabel: ctx.groupLabel,
    },
    branch: {
      id: ctx.branch.id,
      name: ctx.branch.name,
      code: ctx.branch.code,
    },
    academicYear: {
      id: ctx.academicYearId,
      label: ctx.academicYearLabel,
      status: ctx.academicYearStatus,
    },
    features: { showCanteen },
  };
}
