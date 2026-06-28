import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const ay = await prisma.academicYear.findFirst({ where: { status: 'ACTIVE' } });
  if (!ay) { console.log('No active AY'); return; }

  const fees = await prisma.studentFee.findMany({
    where: { academicYearId: ay.id, feeHeadBreakdown: { equals: null } },
    select: { id: true, studentId: true, groupId: true, month: true, year: true, totalAmount: true },
  });
  console.log('Records without breakdown:', fees.length);

  let updated = 0;
  for (const sf of fees) {
    const structures = await prisma.feeStructure.findMany({
      where: { academicYearId: ay.id, groupId: sf.groupId || '', effectiveTo: null },
      include: { feeHead: { select: { name: true, category: true } } },
    });
    const monthEnd = new Date(sf.year, sf.month, 0);
    const effective = structures.filter(
      (s: any) => s.effectiveFrom <= monthEnd && (!s.effectiveTo || s.effectiveTo > monthEnd),
    );
    if (effective.length === 0) continue;
    const breakdown = effective.map((s: any) => ({
      name: s.feeHead.name,
      amount: s.amount,
      category: s.feeHead.category,
    }));
    await prisma.studentFee.update({ where: { id: sf.id }, data: { feeHeadBreakdown: breakdown } });
    updated++;
  }
  console.log('Updated:', updated, 'records with breakdown');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
