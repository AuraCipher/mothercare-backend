/**
 * db-report.js — exact row counts for every public table, so we can see what
 * the reset+seed actually produced before we dump it to R2.
 *
 * Run:  node scripts/db-report.js
 */
require('dotenv/config');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const SQL = `
  SELECT c.relname AS tbl,
         (xpath('/row/c/text()',
           query_to_xml(format('SELECT count(*) AS c FROM public.%I', c.relname),
                        false, true, '')))[1]::text::int AS rows
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r'
  ORDER BY rows DESC, tbl ASC;
`;

(async () => {
  try {
    const rows = await prisma.$queryRawUnsafe(SQL);
    const total = rows.reduce((s, r) => s + Number(r.rows), 0);
    console.log('TABLE                         ROWS');
    console.log('-------------------------------------');
    for (const r of rows) {
      console.log(`${String(r.tbl).padEnd(30)} ${String(r.rows).padStart(6)}`);
    }
    console.log('-------------------------------------');
    console.log(`tables: ${rows.length}   total rows: ${total}`);
    const empty = rows.filter((r) => Number(r.rows) === 0).map((r) => r.tbl);
    console.log(empty.length ? `empty tables: ${empty.join(', ')}` : 'empty tables: none');
  } catch (e) {
    console.error('REPORT FAILED:', e.message);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
})();
