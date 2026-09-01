import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildImport } from './import.ts';
import { monthTotals, categoryBreakdown, type TransactionRow } from './summarize.ts';
import { CATEGORY_BY_SLUG } from './categorize.ts';
import { reconcile } from './reconcile.ts';
import {
  buildWaterfall,
  stepGeometry,
  TOP_CATEGORY_COUNT,
  type Waterfall,
} from './waterfall.ts';

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
const OPENING = { amountMinor: 8_000_000 * 100, asOf: '2026-06-30' };
const withOpening = reconcile(months, OPENING);
const withoutOpening = reconcile(months, null);

const julyLedger = withOpening.months[0];
const julySlices = categoryBreakdown(rows, '2026-07');
const july = buildWaterfall(julyLedger, julySlices);

/** The steps between the opening and closing markers. */
const movements = (chart: Waterfall) => chart.steps.filter((s) => !s.isTotal);

describe('waterfall — the cascade is continuous', () => {
  test('every step starts where the previous one ended', () => {
    for (let i = 1; i < july.steps.length; i++)
      assert.equal(july.steps[i].startMinor, july.steps[i - 1].endMinor);
  });

  test('it opens at the ledger opening and lands on the ledger closing', () => {
    assert.equal(july.steps[0].startMinor, julyLedger.openingMinor);
    assert.equal(july.steps.at(-1)!.endMinor, julyLedger.closingMinor);
  });

  test('the movements sum to the month net', () => {
    assert.equal(
      movements(july).reduce((n, s) => n + s.deltaMinor, 0),
      julyLedger.netMinor
    );
  });

  test('the outgoing steps sum to the month spend', () => {
    const out = july.steps
      .filter((s) => s.kind === 'category' || s.kind === 'other')
      .reduce((n, s) => n + -s.deltaMinor, 0);
    assert.equal(out, julyLedger.spendMinor);
  });

  test('the markers carry no movement of their own', () => {
    for (const s of july.steps.filter((s) => s.isTotal)) assert.equal(s.deltaMinor, 0);
  });
});

describe('waterfall — top categories and the remainder', () => {
  test('at most the top N get their own bar', () => {
    assert.equal(
      july.steps.filter((s) => s.kind === 'category').length,
      Math.min(TOP_CATEGORY_COUNT, julySlices.length)
    );
  });

  test('"other" carries exactly what was left out, and says how many', () => {
    const other = july.steps.find((s) => s.kind === 'other')!;
    const expected = julySlices
      .slice(TOP_CATEGORY_COUNT)
      .reduce((n, s) => n + s.minor, 0);
    assert.equal(-other.deltaMinor, expected);
    assert.equal(july.collapsedCount, julySlices.length - TOP_CATEGORY_COUNT);
    assert.match(other.label, new RegExp(`\\(${july.collapsedCount}\\)`));
  });

  test('categories are largest first regardless of input order', () => {
    const shuffled = buildWaterfall(julyLedger, [...julySlices].reverse());
    const bars = shuffled.steps.filter((s) => s.kind === 'category');
    for (let i = 1; i < bars.length; i++)
      assert.ok(-bars[i - 1].deltaMinor >= -bars[i].deltaMinor);
    assert.deepEqual(
      bars.map((b) => b.id),
      july.steps.filter((s) => s.kind === 'category').map((b) => b.id)
    );
  });

  test('no "other" step when nothing was collapsed', () => {
    const chart = buildWaterfall(julyLedger, julySlices.slice(0, 3), 10);
    assert.equal(chart.steps.find((s) => s.kind === 'other'), undefined);
    assert.equal(chart.collapsedCount, 0);
  });

  test('only category steps offer a drill-down', () => {
    for (const s of july.steps)
      if (s.kind === 'category') assert.equal(s.drilldownSlug, s.id);
      else assert.equal(s.drilldownSlug, null);
  });
});

describe('waterfall — without an opening balance', () => {
  const chart = buildWaterfall(withoutOpening.months[0], julySlices);

  test('it walks from zero and says it is relative', () => {
    assert.equal(chart.relative, true);
    assert.equal(chart.steps[0].startMinor, 0);
    assert.equal(chart.steps[0].label, 'Start');
    assert.equal(chart.steps.at(-1)!.label, 'Net');
  });

  test('it still lands on the month net, and that net goes negative', () => {
    assert.equal(chart.steps.at(-1)!.endMinor, withoutOpening.months[0].netMinor);
    assert.equal(chart.crossesZero, true);
  });

  test('the same month with an opening is not relative', () => {
    assert.equal(july.relative, false);
    assert.equal(july.steps[0].label, 'Opening');
    assert.equal(july.steps.at(-1)!.label, 'Closing');
  });
});

describe('waterfall — axis and geometry', () => {
  test('the axis spans the whole walk and always includes zero', () => {
    for (const s of july.steps) {
      assert.ok(s.startMinor >= july.minMinor && s.startMinor <= july.maxMinor);
      assert.ok(s.endMinor >= july.minMinor && s.endMinor <= july.maxMinor);
    }
    assert.ok(july.minMinor <= 0 && july.maxMinor >= 0);
  });

  test('bars stay inside the track', () => {
    for (const s of july.steps) {
      const g = stepGeometry(s, july);
      assert.ok(g.offsetPercent >= -0.001, `${s.id} starts off-track`);
      assert.ok(g.offsetPercent + g.widthPercent <= 100.001, `${s.id} runs off-track`);
    }
  });

  test('a small category still leaves a visible mark', () => {
    for (const s of movements(july)) assert.ok(stepGeometry(s, july).widthPercent > 0);
  });

  test('total bars are anchored to zero, movements float', () => {
    const zero = stepGeometry(july.steps[0], july).zeroPercent;
    const closing = july.steps.at(-1)!;
    const g = stepGeometry(closing, july);
    // Closing is positive here, so its bar runs from the zero line upward.
    assert.ok(Math.abs(g.offsetPercent - zero) < 0.001);
  });

  test('a negative closing draws its bar on the other side of zero', () => {
    const broke = reconcile(months, { amountMinor: 0, asOf: '2026-06-30' });
    const chart = buildWaterfall(broke.months[0], julySlices);
    const closing = chart.steps.at(-1)!;
    assert.ok(closing.endMinor < 0);
    assert.equal(chart.crossesZero, true);
    const g = stepGeometry(closing, chart);
    assert.ok(g.offsetPercent + g.widthPercent <= g.zeroPercent + 0.001);
  });

  test('a month that never moved does not divide by zero', () => {
    const flat = reconcile(
      [
        {
          ...months[0],
          incomeMinor: 0,
          spendMinor: 0,
          transferInMinor: 0,
          transferOutMinor: 0,
        },
      ],
      { amountMinor: 0, asOf: '2026-06-30' }
    );
    const chart = buildWaterfall(flat.months[0], []);
    for (const s of chart.steps) {
      const g = stepGeometry(s, chart);
      assert.ok(Number.isFinite(g.offsetPercent));
      assert.ok(Number.isFinite(g.widthPercent));
      assert.ok(Number.isFinite(g.zeroPercent));
    }
  });
});

describe('waterfall — labels', () => {
  test('markers show the level, movements show the change', () => {
    const opening = july.steps[0];
    assert.equal(opening.amountLabel, '8.0m');

    const income = july.steps.find((s) => s.kind === 'income')!;
    assert.match(income.amountLabel, /^\+/);

    for (const s of july.steps.filter((s) => s.kind === 'category'))
      assert.match(s.amountLabel, /^-/);
  });

  test('zero-value movements are left out entirely', () => {
    const noTransfers = reconcile(
      [{ ...months[0], transferInMinor: 0, transferOutMinor: 0 }],
      OPENING
    );
    const chart = buildWaterfall(noTransfers.months[0], julySlices);
    assert.equal(chart.steps.find((s) => s.kind === 'transfer-in'), undefined);
    assert.equal(chart.steps.find((s) => s.kind === 'transfer-out'), undefined);
  });
});
