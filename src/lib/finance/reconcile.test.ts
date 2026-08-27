import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildImport } from './import.ts';
import { monthTotals, type TransactionRow } from './summarize.ts';
import { CATEGORY_BY_SLUG } from './categorize.ts';
import { formatMinor } from './parse.ts';
import {
  reconcile,
  netChangeMinor,
  ledgerFor,
  TOLERANCE_MINOR,
  EMPTY_RECONCILIATION,
} from './reconcile.ts';

/**
 * Same corpus the rest of the finance tests use: the real notes, rebuilt into
 * the rows the database holds. The reconciliation has to close against Scott's
 * actual numbers, not against a fixture invented to make it close.
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

const months = monthTotals(rows);
const [july, august] = months;

describe('netChangeMinor', () => {
  test("July's net is the figure that made the page impossible", () => {
    // income 2,427,911.64 − spend 3,451,961.38 + moved in − moved out.
    assert.equal(formatMinor(Math.abs(netChangeMinor(july))), '6,256,049.74');
    assert.ok(netChangeMinor(july) < 0);
  });

  test('is exactly income − spend + moved in − moved out', () => {
    for (const m of months)
      assert.equal(
        netChangeMinor(m),
        m.incomeMinor - m.spendMinor + m.transferInMinor - m.transferOutMinor
      );
  });
});

describe('reconcile — with no opening balance', () => {
  const result = reconcile(months, null);

  test('states what July would need rather than a closing figure', () => {
    for (const ledger of result.months) {
      assert.equal(ledger.openingMinor, null);
      assert.equal(ledger.closingMinor, null);
      // Nothing is called impossible when nothing is known.
      assert.equal(ledger.impossible, false);
    }
    assert.equal(result.closingMinor, null);
  });

  test('the required opening covers the deepest trough, not just month one', () => {
    // Walking from zero: July ends at −6,256,049.74 and that is the low point,
    // because August's net is positive. So that is the minimum opening.
    assert.equal(formatMinor(result.requiredOpeningMinor), '6,256,049.74');
    assert.equal(result.firstMonthKey, '2026-07');
  });

  test('an opening of exactly the required amount lands the trough on zero', () => {
    const exact = reconcile(months, {
      amountMinor: result.requiredOpeningMinor,
      asOf: '2026-07-01',
    });
    assert.equal(exact.months[0].closingMinor, 0);
    assert.deepEqual(exact.impossibleKeys, []);
  });
});

describe('reconcile — with an opening balance', () => {
  const opening = { amountMinor: 8_000_000 * 100, asOf: '2026-07-01' };
  const result = reconcile(months, opening);

  test('the first month opens at the entered amount', () => {
    assert.equal(result.months[0].openingMinor, opening.amountMinor);
  });

  test('each month opens where the previous one closed', () => {
    for (let i = 1; i < result.months.length; i++)
      assert.equal(result.months[i].openingMinor, result.months[i - 1].closingMinor);
  });

  test('the identity holds for every month', () => {
    for (const l of result.months)
      assert.equal(
        l.openingMinor! +
          l.incomeMinor -
          l.spendMinor +
          l.transferInMinor -
          l.transferOutMinor,
        l.closingMinor
      );
  });

  test('closing follows the real corpus', () => {
    const julyLedger = ledgerFor(result, '2026-07')!;
    // 8,000,000 − 6,256,049.74
    assert.equal(formatMinor(julyLedger.closingMinor!), '1,743,950.26');
    assert.equal(result.closingMinor, result.months.at(-1)!.closingMinor);
  });

  test('nothing is flagged when every month closes above zero', () => {
    assert.deepEqual(result.impossibleKeys, []);
    for (const l of result.months) assert.equal(l.shortfallMinor, 0);
  });
});

describe('reconcile — the tolerance band', () => {
  const two = [
    { ...july, incomeMinor: 0, spendMinor: 0, transferInMinor: 0, transferOutMinor: 0 },
    { ...august, incomeMinor: 0, spendMinor: 0, transferInMinor: 0, transferOutMinor: 0 },
  ];

  test('a small overshoot is not worth a complaint', () => {
    // 1,200 so'm short — the exact case that gets an app closed for nagging.
    const nagging = reconcile(
      [{ ...two[0], spendMinor: 1_200 * 100 }],
      { amountMinor: 0, asOf: '2026-07-01' }
    );
    assert.equal(nagging.months[0].closingMinor, -1_200 * 100);
    assert.equal(nagging.months[0].impossible, false);
    assert.equal(nagging.months[0].shortfallMinor, 1_200 * 100);
  });

  test('exactly at the band is still silent; past it speaks', () => {
    const atBand = reconcile([{ ...two[0], spendMinor: TOLERANCE_MINOR }], {
      amountMinor: 0,
      asOf: '2026-07-01',
    });
    assert.equal(atBand.months[0].impossible, false);

    const past = reconcile([{ ...two[0], spendMinor: TOLERANCE_MINOR + 1 }], {
      amountMinor: 0,
      asOf: '2026-07-01',
    });
    assert.equal(past.months[0].impossible, true);
    assert.deepEqual(past.impossibleKeys, ['2026-07']);
  });

  test('a month can recover and a later month still be flagged', () => {
    const result = reconcile(
      [
        { ...two[0], incomeMinor: 500_000 * 100 },
        { ...two[1], spendMinor: 900_000 * 100 },
      ],
      { amountMinor: 100_000 * 100, asOf: '2026-07-01' }
    );
    assert.equal(result.months[0].impossible, false);
    assert.equal(result.months[1].impossible, true);
    assert.deepEqual(result.impossibleKeys, ['2026-08']);
  });
});

describe('reconcile — edges', () => {
  test('no months is empty, not NaN', () => {
    const result = reconcile([], null);
    assert.deepEqual(result, { ...EMPTY_RECONCILIATION, opening: null });
  });

  test('no months still echoes the opening back', () => {
    const opening = { amountMinor: 500, asOf: '2026-07-01' };
    assert.deepEqual(reconcile([], opening).opening, opening);
  });

  test('ledgerFor returns null for a month with no rows', () => {
    assert.equal(ledgerFor(reconcile(months, null), '2026-01'), null);
  });

  test('a zero opening balance is a real answer, not a missing one', () => {
    const result = reconcile(months, { amountMinor: 0, asOf: '2026-07-01' });
    assert.equal(result.months[0].openingMinor, 0);
    assert.notEqual(result.months[0].closingMinor, null);
    assert.equal(result.months[0].impossible, true);
  });
});
