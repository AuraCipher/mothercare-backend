/**
 * One-time cleanup: for each (academicYearId, groupId, feeHeadId) combo,
 * keep the newest active fee structure and expire all other duplicates.
 *
 * Usage: npx ts-node scripts/cleanup-fee-structure-duplicates.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const dupes: { academicYearId: string; groupId: string; feeHeadId: string; cnt: number }[] =
    await prisma.$queryRaw`
      SELECT "academicYearId", "groupId", "feeHeadId", COUNT(*)::int as cnt
      FROM fee_structures
      WHERE "effectiveTo" IS NULL
      GROUP BY "academicYearId", "groupId", "feeHeadId"
      HAVING COUNT(*) > 1
    `;

  if (dupes.length === 0) {
    console.log('No duplicate active fee structures found.');
    return;
  }

  console.log(`Found ${dupes.length} group+head combos with duplicates. Cleaning up…`);
  let expired = 0;

  for (const dupe of dupes) {
    const active = await prisma.feeStructure.findMany({
      where: {
        academicYearId: dupe.academicYearId,
        groupId: dupe.groupId,
        feeHeadId: dupe.feeHeadId,
        effectiveTo: null,
      },
      orderBy: { createdAt: 'desc' },
      include: { group: { select: { name: true, section: true } }, feeHead: { select: { name: true } } },
    });

    const [keep, ...remove] = active;
    if (remove.length === 0) continue;

    const now = new Date();
    await prisma.feeStructure.updateMany({
      where: { id: { in: remove.map((r) => r.id) } },
      data: { effectiveTo: now },
    });

    expired += remove.length;
    console.log(
      `  ${keep.group.name}${keep.group.section ? ` — ${keep.group.section}` : ''} / ${keep.feeHead.name}: kept ${keep.amount / 100} PKR, expired ${remove.length} duplicate(s)`,
    );
  }

  console.log(`Done. Expired ${expired} duplicate row(s).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
