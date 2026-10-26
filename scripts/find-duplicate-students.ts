/**
 * find-duplicate-students.ts — audit report for duplicate admissions.
 *
 * Run ON DEMAND (local or VPS with the prod DATABASE_URL):
 *   npx tsx scripts/find-duplicate-students.ts
 *
 * Prints clusters of students that look like the same child admitted more
 * than once, ranked by how similar the rows are:
 *   A. same class + same name + overlapping guardian, created close together
 *      (near-certain duplicates)
 *   B. same class + same name, created close together, guardian unknown on
 *      either side (suspicious — typical of double-taps on a form filled
 *      without a guardian)
 *
 * Purely read-only — nothing is changed here. Deactivation or merging is a
 * human decision: review each cluster with the branch admin first.
 */

import { PrismaClient } from '@prisma/client';

const WINDOW_MINUTES = 10;

function normalize(s: string | null | undefined): string {
  return (s || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function main() {
  const prisma = new PrismaClient();
  prisma.student.findMany({
    where: { isActive: true },
    select: {
      id: true,
      name: true,
      studentNumber: true,
      admissionNumber: true,
      createdAt: true,
      academicYearId: true,
      groupId: true,
      parents: {
        select: {
          relation: true,
          parent: { select: { user: { select: { name: true } } } },
        },
      },
      group: { select: { name: true, section: true } },
    },
    orderBy: [{ groupId: 'asc' }, { createdAt: 'asc' }],
  }).then(async (students) => {
    await prisma.$disconnect();
    const now = Date.now();

    const guardiansOf = (s: (typeof students)[number]) =>
      s.parents.map(p => normalize(p.parent?.user?.name)).filter(Boolean).sort();

    const row = (s: (typeof students)[number]) => {
      const ageMin = Math.round((now - s.createdAt.getTime()) / 60000);
      return `    #${s.studentNumber ?? '—'} ${s.admissionNumber ?? '—'} | ${s.group?.name ?? 'no class'} | ${s.createdAt.toISOString().slice(0, 16).replace('T', ' ')} (${ageMin} min ago) | id=${s.id}`;
    };

    // Bucket candidates: (year, class, normalizedName)
    const buckets = new Map<string, typeof students>();
    for (const s of students) {
      if (!s.groupId) continue;
      const key = `${s.academicYearId}|${s.groupId}|${normalize(s.name)}`;
      const list = buckets.get(key) || [];
      list.push(s);
      buckets.set(key, list);
    }

    let clusters = 0;
    for (const group of buckets.values()) {
      if (group.length < 2) continue;

      const earliest = group[0].createdAt.getTime();
      const tight = group.filter(s => s.createdAt.getTime() - earliest <= WINDOW_MINUTES * 60_000);
      if (tight.length < 2) continue;

      let guardianOverlap = false;
      for (let i = 0; i < tight.length && !guardianOverlap; i++) {
        for (let j = i + 1; j < tight.length; j++) {
          const gi = guardiansOf(tight[i]);
          const gj = guardiansOf(tight[j]);
          if (gi.length && gj.length && gi.some(g => gj.includes(g))) {
            guardianOverlap = true;
            break;
          }
        }
      }

      clusters++;
      if (guardianOverlap) {
        console.log(`\n A near-certain duplicate — ${tight.length} rows for "${tight[0].name}" in ${tight[0].group?.name ?? '?'}`);
        console.log('    (same class, same name, within 10 min, guardian matches)');
        for (const s of tight) console.log(row(s));
      } else {
        console.log(`\n B suspicious duplicate — ${tight.length} rows for "${tight[0].name}" in ${tight[0].group?.name ?? '?'}`);
        console.log('    (same class, same name, within 10 min — verify with the branch admin)');
        for (const s of tight) console.log(row(s));
      }
    }

    if (clusters === 0) {
      console.log('No duplicate-admission clusters found. Nothing to clean up.');
    } else {
      console.log(`\n${clusters} cluster(s) found. Deactivate (or merge) the extra rows by id — the first row of each cluster is usually the real admission.`);
    }
  }).catch(err => {
    console.error(err);
    process.exit(1);
  });
}

main();
