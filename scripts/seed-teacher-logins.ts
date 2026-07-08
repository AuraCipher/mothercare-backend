/**
 * Enable teacher portal logins without re-running the full database seed.
 *
 * Usage:
 *   npm run seed:teacher-logins
 *   npx ts-node scripts/seed-teacher-logins.ts
 */

import { PrismaClient } from '@prisma/client';
import {
  printTeacherLoginSummary,
  seedTeacherPortalLogins,
} from '../prisma/seed-teacher-logins.lib';

const prisma = new PrismaClient();

async function main() {
  console.log('\n🔐 Seeding teacher portal logins (5 teachers)\n');

  const result = await seedTeacherPortalLogins(prisma);

  printTeacherLoginSummary(result);
  console.log('Done. Teachers can sign in at /login → /teacher');
}

main()
  .catch((err: Error) => {
    console.error('\n❌ Teacher login seed failed:', err.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
