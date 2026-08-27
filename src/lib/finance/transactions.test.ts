import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildImport } from './import.ts';
import { CATEGORY_BY_SLUG } from './categorize.ts';
import { formatMinor, explainFlag, FLAG_EXPLANATIONS } from './parse.ts';
import {
  filterTransactions,
  groupByMonth,
  availableMonths,
  availableCategories,
  formatOccurred,
  listStats,
  isSpendRow,
  NO_FILTERS,
  type TransactionRecord,
} from './transactions.ts';

const NOTES = readFileSync(
  new URL('./__fixtures__/notes.sample.txt', import.meta.url),
  'utf8'
);

/** Exactly what the database holds after the import. */
const rows: TransactionRecord[] = buildImport(NOTES, 2026).rows.map((r, i) => {
  const cat = r.categorySlug ? CATEGORY_BY_SLUG.get(r.categorySlug) : undefined;
  return {
    id: `row-${i}`,
    amount_minor: r.amountMinor,
    currency: 'UZS',
    direction: r.direction,
    comment: r.comment,
    raw_input: r.rawInput,
    category_id: cat ? `cat-${cat.slug}` : null,
    category_source: r.categorySource,
    needs_review: r.needsReview,
    parse_flags: r.parseFlags,
    occurred_at: r.occurredAt,
    date_precision: r.datePrecision,
    finance_categories: cat
      ? { slug: cat.slug, name: cat.name, icon: cat.icon, color: cat.color, kind: cat.kind }
      : null,
  };
});

/** A row typed into the app today, which does know its day. */
const typedRow: TransactionRecord = {
  ...rows[0],
  id: 'typed-1',
  occurred_at: '2026-08-27T14:32:00.000Z',
  date_precision: 'day',
  needs_review: false,
  parse_flags: [],
};

describe('date precision is respected', () => {
  test('an imported row shows its month, never a day', () => {
    const display = formatOccurred(rows[0]);
    assert.equal(display.approximate, true);
    assert.match(display.text, /^[A-Z][a-z]{2} 2026$/);
    assert.ok(!/\d{1,2} [A-Z]/.test(display.text), 'no day may appear');
  });

  test('a typed row shows its day', () => {
    const display = formatOccurred(typedRow);
    assert.equal(display.approximate, false);
    assert.equal(display.text, '27 Aug');
  });

  test('every imported row is approximate — none renders "1 Aug"', () => {
    for (const row of rows) {
      const display = formatOccurred(row);
      assert.equal(display.approximate, true, row.raw_input);
      assert.ok(!display.text.startsWith('1 '), `"${display.text}" invents a day`);
    }
  });
});

describe('grouping', () => {
  test('newest month first', () => {
    const groups = groupByMonth(rows);
    assert.equal(groups.length, 2);
    assert.equal(groups[0].key, '2026-08');
    assert.equal(groups[1].key, '2026-07');
    assert.equal(groups[0].label, 'AUGUST 2026');
  });

  test('month spend excludes transfers and income', () => {
    const groups = groupByMonth(rows);
    assert.equal(formatMinor(groups[0].spendMinor), '5,996,954.15');
    assert.equal(formatMinor(groups[1].spendMinor), '3,451,961.38');
  });

  test('every row lands in exactly one group', () => {
    const groups = groupByMonth(rows);
    assert.equal(groups.reduce((n, g) => n + g.rows.length, 0), rows.length);
  });

  test('rows inside a month are newest first', () => {
    for (const group of groupByMonth(rows)) {
      const dates = group.rows.map((r) => r.occurred_at);
      assert.deepEqual(dates, [...dates].sort().reverse(), group.key);
    }
  });
});

describe('filters', () => {
  test('no filters shows everything', () => {
    assert.equal(filterTransactions(rows, NO_FILTERS).length, 153);
  });

  test('by month', () => {
    const august = filterTransactions(rows, { ...NO_FILTERS, month: '2026-08' });
    assert.ok(august.length > 0);
    for (const r of august) assert.match(r.occurred_at, /^2026-08/);
    assert.equal(
      august.length + filterTransactions(rows, { ...NO_FILTERS, month: '2026-07' }).length,
      153
    );
  });

  test('by category', () => {
    const groceries = filterTransactions(rows, { ...NO_FILTERS, categorySlug: 'groceries' });
    assert.ok(groceries.length > 0);
    for (const r of groceries) assert.equal(r.finance_categories?.slug, 'groceries');
  });

  test('flagged only — the 27 review rows', () => {
    const flagged = filterTransactions(rows, { ...NO_FILTERS, flaggedOnly: true });
    assert.equal(flagged.length, 27);
    for (const r of flagged) assert.equal(r.needs_review, true);
  });

  test('uncategorised only — the 8 the rules could not place', () => {
    const unc = filterTransactions(rows, { ...NO_FILTERS, uncategorisedOnly: true });
    assert.equal(unc.length, 8);
    for (const r of unc) assert.equal(r.finance_categories, null);
  });

  test('filters compose', () => {
    const both = filterTransactions(rows, {
      ...NO_FILTERS,
      month: '2026-08',
      flaggedOnly: true,
    });
    for (const r of both) {
      assert.match(r.occurred_at, /^2026-08/);
      assert.equal(r.needs_review, true);
    }
    assert.ok(both.length < 27, 'August alone holds fewer than every flagged row');
  });

  test('a filter matching nothing returns empty, not everything', () => {
    assert.deepEqual(
      filterTransactions(rows, { ...NO_FILTERS, month: '2025-01' }),
      []
    );
  });
});

describe('filter options come from the data', () => {
  test('months, newest first', () => {
    assert.deepEqual(
      availableMonths(rows).map((m) => m.key),
      ['2026-08', '2026-07']
    );
  });

  test('categories present, alphabetical, no duplicates', () => {
    const cats = availableCategories(rows);
    const slugs = cats.map((c) => c.slug);
    assert.equal(new Set(slugs).size, slugs.length);
    assert.deepEqual(
      cats.map((c) => c.name),
      [...cats.map((c) => c.name)].sort()
    );
    assert.ok(slugs.includes('groceries'));
    assert.ok(!slugs.includes('uncategorised'), 'null category is a filter, not a category');
  });
});

describe('flags explain themselves', () => {
  test('every code the parser can emit has plain-language text', () => {
    for (const code of Object.keys(FLAG_EXPLANATIONS))
      assert.ok(FLAG_EXPLANATIONS[code as keyof typeof FLAG_EXPLANATIONS].length > 20, code);
  });

  test('every flag stored on a real row resolves to a sentence', () => {
    const stored = new Set(rows.flatMap((r) => r.parse_flags));
    assert.ok(stored.size > 0);
    for (const code of stored) {
      const text = explainFlag(code);
      assert.notEqual(text, code, `${code} has no explanation`);
      assert.match(text, /[a-z]{3,}/);
    }
  });

  test('an unknown code degrades to itself rather than throwing', () => {
    assert.equal(explainFlag('SOMETHING_NEW'), 'SOMETHING_NEW');
  });
});

describe('stats', () => {
  test('counts describe the whole set, spend describes what is shown', () => {
    const shown = filterTransactions(rows, { ...NO_FILTERS, month: '2026-08' });
    const stats = listStats(rows, shown);
    assert.equal(stats.total, 153);
    assert.equal(stats.shown, shown.length);
    assert.equal(stats.flagged, 27);
    assert.equal(stats.uncategorised, 8);
    assert.equal(formatMinor(stats.spendMinor), '5,996,954.15');
  });

  test('transfers never count as spend', () => {
    const transfers = rows.filter((r) => r.finance_categories?.kind === 'transfer');
    assert.ok(transfers.length > 0);
    for (const r of transfers) assert.equal(isSpendRow(r), false);
  });

  test('an empty list produces zeroes, not NaN', () => {
    const stats = listStats([], []);
    assert.equal(stats.spendMinor, 0);
    assert.equal(stats.total, 0);
  });
});
