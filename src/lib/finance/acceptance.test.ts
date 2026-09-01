import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { formatMinor } from './parse.ts';

/**
 * THE ACCEPTANCE TEST.
 *
 * Stage 1 added accounts to the schema and had to change nothing a user could
 * see. Stage 2 makes accounts real — counts, positions, a household total, an
 * adjustment that closes gaps — and has to change nothing a user could see
 * either. Real accounts must not move a single historical figure. That
 * assertion is worth more than the feature.
 *
 * The way to know is not to look at /finance and agree it seems fine — it is
 * to have every number the pages can render written down before the change and
 * compared byte for byte after it.
 *
 * `summary.golden.json` is that record: produced by
 * scripts/finance-snapshot.mjs from the real 153-row corpus, covering the month
 * totals, every category total, the everyday floor, the reconciliation, both
 * waterfalls, the transactions list, every drill-down — and, from Stage 2, the
 * positions, the checkpoint ledgers and the half-mapped transfer queue.
 *
 * TWO ASSERTIONS, NOT ONE, because "extend it and keep it byte-identical" is
 * only possible if the two halves are pinned differently:
 *
 *   * the whole file must deep-equal what the script produces today, which is
 *     what catches a Stage 2 figure moving; and
 *   * the six Stage 1 sections must hash to STAGE1_DIGEST, a literal in this
 *     source file.
 *
 * The second is the one that matters. A digest written here cannot be fixed by
 * re-running the generator: making it pass means editing a hex string by hand,
 * in a diff, where someone has to look at it. Regenerating the golden file has
 * no effect on it at all.
 *
 * If either fails, a figure moved. Find out which and why. Change the digest
 * only when a Stage 1 number is *meant* to move, and say so in the commit.
 */

/** The six Stage 1 sections, in the order the script has always written them. */
const STAGE1_KEYS = [
  'import',
  'summary',
  'categoryBreakdown',
  'reconciliation',
  'waterfall',
  'transactions',
] as const;

/**
 * sha256 of those six sections.
 *
 * Accounts, checkpoints, positions, the currency guard on the month totals and
 * the repair to migration 008's backfill all landed without moving it.
 *
 * MOVED ONCE, for the reconcile reset, and no amount moved with it. Two
 * changes are inside the digest and neither is a figure:
 *
 *   - `MonthLedger` gained `seededAsOf`, which is null on every month that
 *     chains. A new field, not an edited one.
 *   - the snapshot now dates the opening 2026-06-30 instead of 2026-07-01 —
 *     where the corpus checkpoint actually sits. A count is the last word for
 *     its own day, so a 1 July figure cannot open July; see OPENING_COUNTED_AT.
 *
 * Every openingMinor, netMinor and closingMinor is byte-identical across the
 * change, and `the month figures did not move` below asserts that directly
 * rather than leaving the digest to speak for it.
 *
 * Previous: b18626b3af3b834a946c946c6098a115501e23c6bae9f12c5f64c3ae74d2cf00
 */
const STAGE1_DIGEST =
  '4ce672489867aac5a1356bb25c0f27ec4399b40c95ad7e19a297717bd1a8555e';

/**
 * The reconciliation figures as they stood BEFORE the reset, written out by
 * hand from the previous golden file.
 *
 * A digest says something moved; it cannot say what. These are the numbers a
 * person reads off the panel, pinned separately so that a change which is
 * meant to move provenance can be told apart from one that moves money.
 */
const RECONCILIATION_BEFORE_THE_RESET = {
  withOpening: [
    { key: '2026-07', openingMinor: 800_000_000, netMinor: -625_604_974, closingMinor: 174_395_026 },
    { key: '2026-08', openingMinor: 174_395_026, netMinor: 13_408_085, closingMinor: 187_803_111 },
  ],
  withoutOpening: [
    { key: '2026-07', openingMinor: null, netMinor: -625_604_974, closingMinor: null },
    { key: '2026-08', openingMinor: null, netMinor: 13_408_085, closingMinor: null },
  ],
};

const GOLDEN = JSON.parse(
  readFileSync(new URL('./__fixtures__/summary.golden.json', import.meta.url), 'utf8')
);

/**
 * Re-derive the same snapshot from today's code, through the same script that
 * wrote the golden file. Running the real script — rather than reassembling
 * its calls here — is what stops the check drifting into asserting a shape
 * nobody actually renders.
 */
const CURRENT = JSON.parse(
  execFileSync(process.execPath, [new URL('../../../scripts/finance-snapshot.mjs', import.meta.url).pathname], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'ignore'],
  })
);

describe('nothing a user can see has moved', () => {
  test('the whole snapshot is identical', () => {
    assert.deepEqual(CURRENT, GOLDEN);
  });

  test('the Stage 1 sections hash to what they hashed to before Stage 2', () => {
    const stage1 = Object.fromEntries(STAGE1_KEYS.map((k) => [k, CURRENT[k]]));
    assert.equal(
      createHash('sha256').update(JSON.stringify(stage1)).digest('hex'),
      STAGE1_DIGEST,
      'a Stage 1 figure moved — regenerating the golden file will not fix this, and should not'
    );
  });

  test('and the golden file itself still carries those exact bytes', () => {
    // Guards the case where the code and the generator moved together: the
    // deep-equal above would pass while both had drifted from the record.
    const stage1 = Object.fromEntries(STAGE1_KEYS.map((k) => [k, GOLDEN[k]]));
    assert.equal(
      createHash('sha256').update(JSON.stringify(stage1)).digest('hex'),
      STAGE1_DIGEST
    );
  });

  test('the month figures did not move', () => {
    // What the digest cannot say on its own. Every figure a person reads off
    // the reconciliation panel, against the values from before the reset.
    for (const [variant, expected] of Object.entries(RECONCILIATION_BEFORE_THE_RESET)) {
      const got = CURRENT.reconciliation[variant].months.map(
        (m: { key: string; openingMinor: number | null; netMinor: number; closingMinor: number | null }) => ({
          key: m.key,
          openingMinor: m.openingMinor,
          netMinor: m.netMinor,
          closingMinor: m.closingMinor,
        })
      );
      assert.deepEqual(got, expected, variant);
    }
  });

  test('the Stage 2 sections are additions, not edits', () => {
    // Extending the snapshot must mean appending a key, never reshaping one of
    // the six — a reordered section would hash differently and this says so
    // before the digest does, in a message that names the cause.
    assert.deepEqual(Object.keys(CURRENT).slice(0, STAGE1_KEYS.length), [...STAGE1_KEYS]);
  });
});

/**
 * The headline figures again, spelled out. `deepEqual` above already covers
 * them, but a diff of a 69KB object does not tell you *which* number broke,
 * and these are the ones worth naming in the failure message.
 */
describe('the figures worth naming', () => {
  const [july, august] = CURRENT.summary.months;

  test('month spend', () => {
    assert.equal(formatMinor(july.spendMinor), '3,451,961.38');
    assert.equal(formatMinor(august.spendMinor), '5,996,954.15');
  });

  test('month income', () => {
    assert.equal(formatMinor(july.incomeMinor), '2,427,911.64');
    assert.equal(formatMinor(august.incomeMinor), '7,560,000');
  });

  test('the everyday floor', () => {
    assert.equal(formatMinor(july.coreMinor), '1,419,349.17');
    assert.equal(formatMinor(august.coreMinor), '1,438,873');
  });

  test('every category total, both months', () => {
    for (const [key, slices] of Object.entries(CURRENT.categoryBreakdown)) {
      const goldenSlices = GOLDEN.categoryBreakdown[key];
      assert.ok(goldenSlices, `${key} is a month the golden file does not have`);
      assert.deepEqual(
        (slices as { slug: string; minor: number }[]).map((s) => [s.slug, s.minor]),
        goldenSlices.map((s: { slug: string; minor: number }) => [s.slug, s.minor]),
        `category totals moved in ${key}`
      );
    }
  });

  test('all 153 rows are still there, and still month-precision', () => {
    assert.equal(CURRENT.summary.totalRows, 153);
    assert.equal(CURRENT.summary.monthPrecisionCount, 153);
    assert.equal(CURRENT.transactions.stats.total, 153);
  });

  test('the reconciliation closes where it did', () => {
    assert.deepEqual(
      CURRENT.reconciliation.withOpening.months.map((m: { key: string; closingMinor: number }) => [
        m.key,
        m.closingMinor,
      ]),
      GOLDEN.reconciliation.withOpening.months.map((m: { key: string; closingMinor: number }) => [
        m.key,
        m.closingMinor,
      ])
    );
  });

  test('every drill-down still adds up to the figure that was clicked', () => {
    for (const [key, entry] of Object.entries(CURRENT.transactions.drilldown)) {
      assert.deepEqual(entry, GOLDEN.transactions.drilldown[key], `drill-down ${key} moved`);
    }
  });
});


/**
 * The Stage 2 figures worth naming. `deepEqual` covers them; these are the
 * ones whose failure message should say what broke.
 */
describe('the positions, spelled out', () => {
  const day = CURRENT.positions.onDays['2026-08-31'];
  const main = day.accounts.find((a: { name: string }) => a.name === 'Main');

  test('Main holds what the reconciliation says it closes with', () => {
    // Two independent routes to one number: reconcile walks month totals from
    // an opening balance, balanceAt walks 153 individual rows from a physical
    // count. If real accounts had moved a historical figure, these would part.
    assert.equal(formatMinor(main.minor), '1,878,031.11');
    assert.equal(main.minor, CURRENT.reconciliation.withOpening.closingMinor);
  });

  test('before anything was counted, every account reads unknown', () => {
    for (const a of CURRENT.positions.onDays['2026-06-01'].accounts) {
      assert.equal(a.minor, null, `${a.name} claimed a balance nobody counted`);
      assert.equal(a.uncounted, true);
    }
  });

  test('uncounted is never rendered as zero in the household figure either', () => {
    const early = CURRENT.positions.onDays['2026-06-01'].household;
    assert.equal(early.totalUzsMinor, 0);
    assert.deepEqual(early.uncounted.sort(), [
      'Main',
      'Mom — cash',
      'Mom — dollars',
      'Sister — cash',
    ]);
  });

  test('the household total states its rate, and has none without one', () => {
    assert.equal(day.household.rate.uzsPerUsdMinor, 1_265_000);
    assert.equal(day.householdWithoutRate.totalUzsMinor, null);
    assert.equal(day.householdWithoutRate.needsRate, true);
  });

  test("the opening out of the counts is Stage 1's figure, plus the other drawers", () => {
    const { withRate, stage1Figure } = CURRENT.positions.householdAt;
    assert.equal(withRate.amountMinor - 120_000_000 - 506_000_000, stage1Figure.amountMinor);
  });

  test('seventeen transfers are still waiting on their other end', () => {
    // Not sixteen and not a hundred and thirty. Sixteen would mean something
    // inferred one; a hundred and thirty would mean ordinary expenses had been
    // swept into a queue that asks where a bag of bananas went.
    assert.equal(CURRENT.positions.needsOtherSide.length, 17);
    // Eleven went out and do not say where to; six came in and do not say
    // where from. Which end is unknown depends on which way the money went,
    // and collapsing the two would put arriving money on the leaving side.
    const missing = CURRENT.positions.needsOtherSide.map((t: { missing: string }) => t.missing);
    assert.equal(missing.filter((m: string) => m === 'source').length, 6);
    assert.equal(missing.filter((m: string) => m === 'destination').length, 11);
  });
});

/**
 * Stage 3 adds an axis, not a figure. The digest above already proves nothing
 * a user could see has moved; these are the new claims worth naming, taken
 * from the same snapshot the pages are drawn from.
 */
describe('the beneficiary, spelled out', () => {
  const { backfill, byMonth, floor } = CURRENT.beneficiary;

  test('the backfill claimed nothing about the 153 imported rows', () => {
    // THE HONESTY PROPERTY. Nobody knows who ate the July groceries, and a
    // migration writing 'household' across them would be indistinguishable
    // from the rows where Scott chose it. Stated as a count, so a partial
    // regression is as loud as a total one.
    assert.deepEqual(backfill.preCutoverHousehold, []);
    assert.equal(backfill.importedRowCount, 153);
    assert.equal(backfill.counts.null, backfill.rowCount - backfill.counts.household);
    assert.ok(
      backfill.counts.null >= backfill.importedRowCount,
      'fewer unrecorded rows than there are imported rows — history was backfilled'
    );
  });

  test('every month, the groups add up to that month\'s spend', () => {
    for (const [key, month] of Object.entries(byMonth) as [string, {
      summedMinor: number;
      monthSpendMinor: number;
      groups: { key: string }[];
    }][]) {
      assert.equal(month.summedMinor, month.monthSpendMinor, `${key}: a row was dropped`);
      // Including the group with no answer. Omitting it is how the sum stays
      // whole while the page stops being true.
      assert.ok(month.groups.some((g) => g.key === 'unrecorded'), `${key}: no unrecorded group`);
    }
  });

  test('every month, the floor splits into three parts that make the whole', () => {
    for (const [key, split] of Object.entries(floor) as [string, {
      coreMinor: number;
      householdMinor: number;
      personalMinor: number;
      unrecordedMinor: number;
    }][]) {
      assert.equal(
        split.householdMinor + split.personalMinor + split.unrecordedMinor,
        split.coreMinor,
        `${key}: the floor split does not add up`
      );
    }
  });

  test('July is entirely unrecorded, and says so', () => {
    assert.equal(floor['2026-07'].unrecordedMinor, floor['2026-07'].coreMinor);
    assert.equal(formatMinor(floor['2026-07'].coreMinor), '1,419,349.17');
  });
});
