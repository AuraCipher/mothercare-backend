/**
 * One-time cleanup: fix student_fees with duplicate feeHeadBreakdown rows.
 * Recalculates breakdown + totalAmount/netAmount from deduped fee structures.
 *
 * Usage:
 *   npx ts-node scripts/cleanup-student-fee-breakdowns.ts          # apply
 *   npx ts-node scripts/cleanup-student-fee-breakdowns.ts --dry-run  # preview only
 */
import { PrismaClient } from '@prisma/client';
import { mergeFeeHeadBreakdown, type FeeHeadBreakdownRow } from '../src/modules/admin/services/fee-breakdown.utils';

const prisma = new PrismaClient();
const dryRun = process.argv.includes('--dry-run');

function dedupeStructuresByGroupHead<T extends { groupId: string; feeHeadId: string; effectiveFrom: Date; createdAt?: Date }>(
  rows: T[],
): T[] {
  const latest = new Map<string, T>();
  for (const row of rows) {
    const key = `${row.groupId}:${row.feeHeadId}`;
    const prev = latest.get(key);
    if (!prev) {
      latest.set(key, row);
      continue;
    }
    const rowEf = row.effectiveFrom.getTime();
    const prevEf = prev.effectiveFrom.getTime();
    if (rowEf > prevEf) {
      latest.set(key, row);
      continue;
    }
    if (rowEf === prevEf) {
      const rowCreated = row.createdAt?.getTime() ?? 0;
      const prevCreated = prev.createdAt?.getTime() ?? 0;
      if (rowCreated > prevCreated) latest.set(key, row);
    }
  }
  return [...latest.values()];
}

function computeFeeAmountAndBreakdown(
  student: { customFeeAmount?: number | null; feeOverrides?: unknown },
  groupStructures: { feeHeadId: string; feeHead: { name: string; category: string }; amount: number }[],
): { totalAmount: number; breakdown: FeeHeadBreakdownRow[] } {
  const sOverrides = student.feeOverrides as Record<string, number> | null;

  if (sOverrides && Object.keys(sOverrides).length > 0) {
    const breakdown = groupStructures.map((s) => {
      const amount = sOverrides[s.feeHeadId] !== undefined ? sOverrides[s.feeHeadId] : s.amount;
      return { feeHeadId: s.feeHeadId, name: s.feeHead.name, amount, category: s.feeHead.category };
    });
    const mergedBreakdown = mergeFeeHeadBreakdown(breakdown);
    const totalAmount = mergedBreakdown.reduce((sum, b) => sum + (b.amount || 0), 0);
    return { totalAmount, breakdown: mergedBreakdown };
  }

  if (student.customFeeAmount != null) {
    return {
      totalAmount: student.customFeeAmount,
      breakdown: [{ name: 'Custom Fee', amount: student.customFeeAmount, category: 'CUSTOM' }],
    };
  }

  const breakdown = groupStructures.map((s) => ({
    feeHeadId: s.feeHeadId,
    name: s.feeHead.name,
    amount: s.amount,
    category: s.feeHead.category,
  }));
  const mergedBreakdown = mergeFeeHeadBreakdown(breakdown);
  const totalAmount = mergedBreakdown.reduce((sum, b) => sum + (b.amount || 0), 0);
  return { totalAmount, breakdown: mergedBreakdown };
}

function computeFeeStatus(paidAmount: number, totalDue: number): string {
  if (paidAmount >= totalDue) return paidAmount > totalDue ? 'OVERPAID' : 'PAID';
  return paidAmount > 0 ? 'PARTIAL' : 'UNPAID';
}

function hasDuplicateBreakdown(breakdown: unknown): boolean {
  const rows = Array.isArray(breakdown) ? breakdown : [];
  const seen = new Set<string>();
  for (const h of rows as { feeHeadId?: string; name?: string }[]) {
    const key = h.feeHeadId || h.name || '';
    if (!key) continue;
    if (seen.has(key)) return true;
    seen.add(key);
  }
  return false;
}

async function main() {
  const allFees = await prisma.studentFee.findMany({
    select: {
      id: true,
      studentId: true,
      groupId: true,
      month: true,
      year: true,
      academicYearId: true,
      totalAmount: true,
      netAmount: true,
      paidAmount: true,
      concession: true,
      lateFee: true,
      status: true,
      feeHeadBreakdown: true,
      extraItems: { select: { amount: true } },
      student: { select: { name: true, rollNumber: true, groupId: true, customFeeAmount: true, feeOverrides: true } },
    },
  });

  const affected = allFees.filter((f) => hasDuplicateBreakdown(f.feeHeadBreakdown));
  if (affected.length === 0) {
    console.log('No student fees with duplicate breakdown heads found.');
    return;
  }

  console.log(`${dryRun ? '[DRY RUN] ' : ''}Found ${affected.length} fee record(s) with duplicate breakdown heads.`);

  const ayIds = [...new Set(affected.map((f) => f.academicYearId))];
  type StructureRow = {
    groupId: string;
    feeHeadId: string;
    amount: number;
    effectiveFrom: Date;
    effectiveTo: Date | null;
    createdAt: Date;
    feeHead: { name: string; category: string };
  };
  const structuresByAy = new Map<string, StructureRow[]>();
  for (const ayId of ayIds) {
    structuresByAy.set(
      ayId,
      await prisma.feeStructure.findMany({
        where: { academicYearId: ayId },
        include: { feeHead: { select: { name: true, category: true } } },
      }),
    );
  }

  let updated = 0;
  let unchanged = 0;

  for (const sf of affected) {
    const student = sf.student;
    const groupId = sf.groupId || student.groupId;
    if (!groupId) {
      console.log(`  SKIP ${student.name} (${sf.month}/${sf.year}): no groupId`);
      unchanged++;
      continue;
    }

    const monthEnd = new Date(sf.year, sf.month, 0);
    const allStructures = structuresByAy.get(sf.academicYearId) || [];
    const effectiveStructures = dedupeStructuresByGroupHead(
      allStructures.filter(
        (s) =>
          s.groupId === groupId &&
          s.effectiveFrom <= monthEnd &&
          (!s.effectiveTo || s.effectiveTo > monthEnd),
      ),
    );

    let { totalAmount, breakdown } = computeFeeAmountAndBreakdown(student, effectiveStructures);
    if (breakdown.length === 0 && totalAmount > 0) {
      breakdown = [{ name: 'Fee', amount: totalAmount, category: 'OTHER' }];
    }

    const netAmount = totalAmount - sf.concession + sf.lateFee;
    const extraSum = sf.extraItems.reduce((s, e) => s + e.amount, 0);
    const totalDue = netAmount + extraSum;
    const status = computeFeeStatus(sf.paidAmount, totalDue);

    const oldLines = Array.isArray(sf.feeHeadBreakdown) ? sf.feeHeadBreakdown.length : 0;
    const changed =
      totalAmount !== sf.totalAmount ||
      netAmount !== sf.netAmount ||
      status !== sf.status ||
      oldLines !== breakdown.length;

    if (!changed) {
      unchanged++;
      continue;
    }

    console.log(
      `  ${student.name} (roll ${student.rollNumber}) ${sf.month}/${sf.year}: ` +
        `${sf.netAmount / 100} → ${netAmount / 100} PKR, ` +
        `${oldLines} → ${breakdown.length} head lines, status ${sf.status} → ${status}` +
        (sf.paidAmount > 0 ? ` [paid ${sf.paidAmount / 100} PKR]` : ''),
    );

    if (!dryRun) {
      await prisma.studentFee.update({
        where: { id: sf.id },
        data: {
          totalAmount,
          netAmount,
          feeHeadBreakdown: breakdown,
          status,
        },
      });
    }
    updated++;
  }

  console.log(`Done. ${dryRun ? 'Would update' : 'Updated'} ${updated}, unchanged ${unchanged}.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
