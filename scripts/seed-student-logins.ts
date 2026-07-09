/**
 * Enable student portal logins without re-running the full database seed.
 *
 * Usage:
 *   npm run seed:student-logins
 *   npx ts-node scripts/seed-student-logins.ts
 */

import { PrismaClient } from '@prisma/client';
import {
  printStudentLoginSummary,
  seedStudentPortalLogins,
} from '../prisma/seed-student-logins.lib';

const prisma = new PrismaClient();

async function main() {
  console.log('\n🔐 Seeding student portal logins (5 test students)\n');

  const result = await seedStudentPortalLogins(prisma);

  printStudentLoginSummary(result);
  console.log('Done. Students can sign in at /login → /student');
}

main()
  .catch((err: Error) => {
    console.error('\n❌ Student login seed failed:', err.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
