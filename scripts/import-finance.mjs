#!/usr/bin/env node
/**
 * Turn a paste of capture notes into an SQL import script.
 *
 *   node scripts/import-finance.mjs <notes.txt> [year] > import.sql
 *
 * Prints a summary to stderr and the SQL to stdout, so the summary stays
 * readable when the SQL is redirected to a file.
 *
 * The generated SQL is meant for the Supabase SQL editor: it runs as the table
 * owner, so your auth user id has to be pasted in at the top. Nothing here
 * needs a service-role key, and none is stored in this repo.
 */
import { readFileSync } from 'node:fs';
import { buildImport, toSql } from '../src/lib/finance/import.ts';
import { formatMinor } from '../src/lib/finance/parse.ts';
import { CATEGORY_BY_SLUG } from '../src/lib/finance/categorize.ts';

const [file, yearArg] = process.argv.slice(2);
if (!file) {
  console.error('usage: node scripts/import-finance.mjs <notes.txt> [year]');
  process.exit(1);
}

const year = Number(yearArg ?? 2026);
const summary = buildImport(readFileSync(file, 'utf8'), year);

// A batch id fixed by content, so re-running the same import replaces its own
// rows instead of duplicating them. Random ids would defeat that.
const batchId = '00000000-0000-4000-8000-' + String(year).padStart(12, '0');

const log = (...args) => console.error(...args);

log('=== IMPORT SUMMARY ===');
log('lines read    :', summary.linesRead);
log('rows built    :', summary.rows.length);
log('needs review  :', summary.needsReview);
log('skipped       :', summary.skipped.length, summary.skipped.join(' | ') || '');
log('');

for (const [month, totals] of [...summary.byMonth].sort()) {
  log(`--- ${month} ---`);
  log('  spend    ', formatMinor(totals.spendMinor).padStart(14));
  log('  income   ', formatMinor(totals.incomeMinor).padStart(14));
  log('  transfer ', formatMinor(totals.transferMinor).padStart(14), '(excluded from spend)');
  const cats = [...(summary.spendByCategory.get(month) ?? new Map())].sort((a, b) => b[1] - a[1]);
  for (const [slug, minor] of cats)
    log(
      '   ',
      formatMinor(minor).padStart(14),
      CATEGORY_BY_SLUG.get(slug)?.name ?? slug
    );
  log('');
}

log('rows flagged for review:');
for (const row of summary.rows.filter((r) => r.needsReview))
  log(`  ${formatMinor(row.amountMinor).padStart(12)} | ${row.parseFlags.join(',')} | "${row.rawInput}"`);

process.stdout.write(toSql(summary, batchId));
