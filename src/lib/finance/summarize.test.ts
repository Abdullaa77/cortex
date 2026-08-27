import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildImport } from './import.ts';
import { summarize, type TransactionRow } from './summarize.ts';
import { CATEGORY_BY_SLUG } from './categorize.ts';
import { formatMinor } from './parse.ts';

/**
 * Rebuild exactly what the database holds after the import, then aggregate it
 * the way the page does. This is the check that the view's totals match the
 * numbers the import reported — without needing a browser or a session.
 */
const NOTES = readFileSync(
  new URL('./__fixtures__/notes.sample.txt', import.meta.url),
  'utf8'
);
const imported = buildImport(NOTES, 2026);

const rows: TransactionRow[] = imported.rows.map((r, i) => {
  const cat = r.categorySlug ? CATEGORY_BY_SLUG.get(r.categorySlug) : undefined;
  return {
    id: `row-${i}`,
    reimburses_transaction_id: null,
    amount_minor: r.amountMinor,
    direction: r.direction,
    occurred_at: r.occurredAt,
    date_precision: r.datePrecision,
    needs_review: r.needsReview,
    finance_categories: cat
      ? { slug: cat.slug, name: cat.name, icon: cat.icon, color: cat.color, kind: cat.kind }
      : null,
  };
});

const summary = summarize(rows);
const [july, august] = summary.months;

describe('summarize — against the real imported corpus', () => {
  test('picks the two most recent months, oldest first', () => {
    assert.equal(summary.months.length, 2);
    assert.equal(july.key, '2026-07');
    assert.equal(august.key, '2026-08');
    assert.equal(july.label, 'JULY');
    assert.equal(august.label, 'AUGUST');
  });

  test('spend matches what the import reported, to the tiyin', () => {
    assert.equal(formatMinor(july.spendMinor), '3,451,961.38');
    assert.equal(formatMinor(august.spendMinor), '5,996,954.15');
  });

  test('income and transfers match too', () => {
    assert.equal(formatMinor(july.incomeMinor), '2,427,911.64');
    assert.equal(formatMinor(august.incomeMinor), '7,560,000');
    assert.equal(
      formatMinor(july.transferInMinor + july.transferOutMinor),
      '5,552,000'
    );
    assert.equal(
      formatMinor(august.transferInMinor + august.transferOutMinor),
      '1,967,035'
    );
  });

  test('every row is accounted for exactly once', () => {
    assert.equal(summary.totalRows, 153);
    assert.equal(july.txnCount + august.txnCount, 153);
  });

  test('transfers are excluded from spend', () => {
    // The confirmed 4.85M sits in July's moved money, not its spending.
    assert.ok(july.transferOutMinor >= 4_850_000 * 100);
    assert.ok(july.spendMinor < 4_850_000 * 100);
  });

  test('reconciles — income minus spend plus net movement', () => {
    for (const m of summary.months) {
      const net = m.incomeMinor - m.spendMinor + m.transferInMinor - m.transferOutMinor;
      assert.equal(typeof net, 'number');
      assert.ok(Number.isInteger(net), `${m.label} net is not an integer`);
    }
  });
});

describe('the everyday floor is the number worth watching', () => {
  test('groceries + transport + eating out, both months', () => {
    assert.equal(formatMinor(july.coreMinor), '1,419,349.17');
    assert.equal(formatMinor(august.coreMinor), '1,438,873');
  });

  test('it is near-flat while total spend swings by 74%', () => {
    const corePercent = Math.abs(august.coreMinor - july.coreMinor) / july.coreMinor;
    const spendPercent = Math.abs(august.spendMinor - july.spendMinor) / july.spendMinor;
    assert.ok(corePercent < 0.02, `core moved ${(corePercent * 100).toFixed(1)}%`);
    assert.ok(spendPercent > 0.5, `spend moved ${(spendPercent * 100).toFixed(1)}%`);
  });
});

describe('the two blocks', () => {
  test('splitting beats one combined-total list', () => {
    // Sorted by combined total, Documents leads at ~17% of two-month spend —
    // and it is one August row. The split is what stops a one-off being the
    // first thing the page says about his spending.
    const combined = [...summary.inBoth, ...summary.oneMonthOnly].sort(
      (a, b) => b.totalMinor - a.totalMinor
    );
    assert.equal(combined[0].slug, 'documents');
    assert.equal(combined[0].earlierMinor, 0);
    assert.equal(summary.inBoth[0].slug, 'groceries');
  });

  test('in-both categories are the floor', () => {
    const slugs = summary.inBoth.map((c) => c.slug);
    for (const expected of ['groceries', 'transport', 'eating-out', 'travel', 'ehsan'])
      assert.ok(slugs.includes(expected), `${expected} should be in both months`);
    // 16 categories carry spend; 5 appear in one month only.
    assert.equal(summary.inBoth.length, 11);
    assert.equal(summary.inBoth.length + summary.oneMonthOnly.length, 16);
  });

  test('clothing is in both months despite being a spike in August', () => {
    // 250,000 in July, 1,018,900 in August. Being lumpy does not make it a
    // one-off, and the split is by presence, not by size.
    const clothing = summary.inBoth.find((c) => c.slug === 'clothing');
    assert.ok(clothing, 'clothing belongs in the both-months block');
    assert.equal(formatMinor(clothing.earlierMinor), '250,000');
    assert.equal(formatMinor(clothing.laterMinor), '1,018,900');
  });

  test('one-month-only categories are named, not hidden in an "other" bucket', () => {
    const slugs = summary.oneMonthOnly.map((c) => c.slug).sort();
    assert.deepEqual(slugs, [
      'documents',
      'grooming',
      'investment',
      'uncategorised',
      'utilities',
    ]);
  });

  test('the two uncategorised rows show as uncategorised, not folded away', () => {
    const unc = summary.oneMonthOnly.find((c) => c.slug === 'uncategorised');
    assert.ok(unc);
    assert.equal(formatMinor(unc.totalMinor), '28,500');
  });

  test('deltas are later minus earlier', () => {
    const groceries = summary.inBoth.find((c) => c.slug === 'groceries')!;
    assert.equal(formatMinor(groceries.earlierMinor), '608,423.50');
    assert.equal(formatMinor(groceries.laterMinor), '840,418');
    assert.equal(groceries.deltaMinor, groceries.laterMinor - groceries.earlierMinor);
  });
});

describe('date_precision is respected', () => {
  test('every imported row is month-precision, so no daily view is possible', () => {
    assert.equal(summary.monthPrecisionCount, 153);
  });

  test('flagged rows are counted but still included in the totals', () => {
    assert.equal(summary.needsReviewCount, 27);
    const flaggedSpend = rows
      .filter((r) => r.needs_review && r.direction === 'expense')
      .filter((r) => (r.finance_categories?.kind ?? 'expense') === 'expense')
      .reduce((n, r) => n + r.amount_minor, 0);
    assert.ok(flaggedSpend > 0, 'flagged rows should contribute to spend');
  });
});

describe('degenerate input', () => {
  test('no rows produces an empty summary, not a crash', () => {
    const empty = summarize([]);
    assert.deepEqual(empty.months, []);
    assert.equal(empty.totalRows, 0);
  });

  test('a single month still renders — nothing is in both', () => {
    const oneMonth = summarize(rows.filter((r) => r.occurred_at.startsWith('2026-08')));
    assert.equal(oneMonth.months.length, 1);
    assert.equal(oneMonth.inBoth.length, 0);
    assert.ok(oneMonth.oneMonthOnly.length > 0);
  });
});
