/**
 * Database Seed Script
 *
 * Creates the default school branch ("Mother Care Sohan") so that
 * group/class creation can auto-assign a communityId without the
 * frontend having to specify one explicitly.
 *
 * Usage:
 *   npx ts-node prisma/seed.ts
 *
 * The seed is idempotent — it only creates the branch if it doesn't
 * already exist (matched by name).
 *
 * ─── Concept Note ─────────────────────────────────────────────
 * In the Prisma schema, the model is named "Community" (table: communities).
 * This represents a **school branch** — a physical campus location.
 * For a single-branch school like Mother Care Sohan, there is one record.
 * Future branches can be added via CRUD endpoints at /admin/communities.
 */

import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';

const prisma = new PrismaClient();

const DEFAULT_BRANCH_NAME = 'Mother Care Sohan';
const ACADEMIC_YEAR = '2025-2026';

async function main() {
  const existing = await prisma.community.findFirst({
    where: { name: DEFAULT_BRANCH_NAME },
  });

  if (existing) {
    console.log(`[seed] ✓ Branch "${DEFAULT_BRANCH_NAME}" already exists (id: ${existing.id})`);
    return;
  }

  const branch = await prisma.community.create({
    data: {
      id: randomUUID(),
      name: DEFAULT_BRANCH_NAME,
      description: 'Main campus — Mother Care School, Sohan, Islamabad',
      academicYear: ACADEMIC_YEAR,
    },
  });

  console.log(`[seed] ✓ Created branch "${DEFAULT_BRANCH_NAME}"`);
  console.log(`[seed]   ID: ${branch.id}`);
  console.log(`[seed]   This branch will be auto-assigned when creating classes from the frontend.`);
}

main()
  .catch((e) => {
    console.error('[seed] ✗ Failed:', e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
