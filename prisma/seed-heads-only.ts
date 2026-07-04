/**
 * Minimal seed — Fee Heads only.
 * Creates just the fee head definitions for testing the UI.
 * No structures, no generation, no payments.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const FEE_HEADS = [
  { name: 'Tuition',       category: 'MONTHLY', description: 'Monthly tuition fee', isOptional: false },
  { name: 'Transport',     category: 'MONTHLY', description: 'Transport/Conveyance', isOptional: true },
  { name: 'Lab Fee',       category: 'TERM',    description: 'Science lab charges (per term)', isOptional: false },
  { name: 'Sports',        category: 'TERM',    description: 'Sports & extracurricular (per term)', isOptional: true },
  { name: 'Library',       category: 'MONTHLY', description: 'Library & reading material', isOptional: false },
  { name: 'Annual Charges', category: 'ANNUAL', description: 'Annual registration & misc', isOptional: false },
  { name: 'Admission Fee',  category: 'ONE_TIME', description: 'One-time admission charge', isOptional: false },
];

async function main() {
  console.log('\n📋 Seeding Fee Heads only...\n');

  let created = 0;
  for (const head of FEE_HEADS) {
    const existing = await prisma.feeHead.findFirst({ where: { name: head.name } });
    if (existing) {
      console.log(`  ✓ "${head.name}" already exists (id: ${existing.id})`);
      continue;
    }
    await prisma.feeHead.create({ data: head });
    console.log(`  ✓ Created "${head.name}"`);
    created++;
  }

  const total = await prisma.feeHead.count();
  console.log(`\n✅ Done — ${created} new, ${total} total fee heads`);
}

main()
  .catch(e => { console.error('\n❌ Failed:', e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
