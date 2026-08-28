import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  accountDeltaMinor,
  balanceAt,
  basisCheckpoint,
  reconcileCount,
  adjustmentDraft,
  checkpointLedger,
  gapPattern,
  explainGap,
  UNACCOUNTED_SLUG,
  type BalanceCheckpoint,
  type MovementRow,
} from './checkpoints.ts';
import { dayKey, atLocalNoon } from './cutover.ts';
import {
  CHECKPOINTS,
  MOVEMENTS,
  MAIN_ID,
  MOM_UZS_ID,
  OPENING,
  OPENING_COUNTED_AT,
  CORPUS_ROWS,
} from './__fixtures__/corpus.ts';
import { monthTotals, categoryBreakdown, classifyRow } from './summarize.ts';
import { reconcile } from './reconcile.ts';

const A = 'acct-a';
const B = 'acct-b';

let seq = 0;
const move = (
  day: string,
  minor: number,
  from: string | null,
  to: string | null
): MovementRow => ({
  id: `m-${seq++}`,
  amount_minor: minor,
  occurred_at: atLocalNoon(day),
  from_account_id: from,
  to_account_id: to,
});

const count = (
  day: string,
  minor: number,
  account = A,
  id = `cp-${day}-${account}`
): BalanceCheckpoint => ({
  id,
  account_id: account,
  counted_at: day,
  counted_minor: minor,
  note: null,
  adjustment_transaction_id: null,
});

describe('what a row does to one account', () => {
  test('leaving subtracts, arriving adds', () => {
    assert.equal(accountDeltaMinor(move('2026-08-01', 500, A, null), A), -500);
    assert.equal(accountDeltaMinor(move('2026-08-01', 500, null, A), A), 500);
  });

  test('a transfer between two accounts moves both, in opposite directions', () => {
    const row = move('2026-08-01', 500, A, B);
    assert.equal(accountDeltaMinor(row, A), -500);
    assert.equal(accountDeltaMinor(row, B), 500);
    // And nothing left the household: the two cancel.
    assert.equal(accountDeltaMinor(row, A) + accountDeltaMinor(row, B), 0);
  });

  test('a row that touches neither side of this account does nothing to it', () => {
    assert.equal(accountDeltaMinor(move('2026-08-01', 500, B, null), A), 0);
  });
});

describe('the balance is the count, plus what happened since', () => {
  const checkpoints = [count('2026-08-01', 100_000)];
  const rows = [
    move('2026-08-02', 30_000, A, null),
    move('2026-08-03', 5_000, null, A),
  ];

  test('at the count, it is the count', () => {
    assert.equal(balanceAt(A, checkpoints, rows, '2026-08-01').minor, 100_000);
  });

  test('after it, the count plus the movements', () => {
    assert.equal(balanceAt(A, checkpoints, rows, '2026-08-03').minor, 75_000);
  });

  test('a day before any count is UNKNOWN, and unknown is not zero', () => {
    // The whole premise is that a position comes from a count. Rolling
    // backwards would manufacture a confident figure out of rows that predate
    // anyone ever looking in the drawer.
    const before = balanceAt(A, checkpoints, rows, '2026-07-31');
    assert.equal(before.minor, null);
    assert.equal(before.basis, null);
    assert.notEqual(before.minor, 0);
  });

  test('another account is unaffected by this one', () => {
    assert.equal(balanceAt(B, checkpoints, rows, '2026-08-03').minor, null);
  });

  test('rows dated the day of the count are already in it', () => {
    // Scott empties the drawer on the 1st and types that morning's taxi that
    // evening. The cash was already gone when he counted. Subtracting it again
    // is the one double-count this model can commit.
    const sameDay = [...rows, move('2026-08-01', 9_999, A, null)];
    assert.equal(balanceAt(A, checkpoints, sameDay, '2026-08-01').minor, 100_000);
    assert.equal(balanceAt(A, checkpoints, sameDay, '2026-08-03').minor, 75_000);
  });

  test('it reports what it rested on and how much moved', () => {
    const b = balanceAt(A, checkpoints, rows, '2026-08-03');
    assert.equal(b.basis?.counted_at, '2026-08-01');
    assert.equal(b.movedMinor, -25_000);
    assert.equal(b.movementCount, 2);
  });
});

describe('basisCheckpoint', () => {
  const cps = [count('2026-08-01', 1), count('2026-08-10', 2), count('2026-08-20', 3)];

  test('at-or-before takes the latest one that has happened', () => {
    assert.equal(basisCheckpoint(cps, A, '2026-08-15')?.counted_minor, 2);
    assert.equal(basisCheckpoint(cps, A, '2026-08-10')?.counted_minor, 2);
  });

  test('before excludes the day itself — a count is not measured against itself', () => {
    assert.equal(basisCheckpoint(cps, A, '2026-08-10', 'before')?.counted_minor, 1);
  });

  test('nothing yet counted resolves to nothing', () => {
    assert.equal(basisCheckpoint(cps, A, '2026-07-31'), null);
  });

  test('order in the array does not matter', () => {
    const shuffled = [cps[2], cps[0], cps[1]];
    assert.equal(basisCheckpoint(shuffled, A, '2026-08-15')?.counted_minor, 2);
  });
});

/**
 * THE DIRECTION, BOTH WAYS.
 *
 * A suite that only ever sees money go missing passes while the copy tells
 * Scott the opposite of the truth. Stating it backwards has already happened
 * once in design conversation, which is exactly why both signs are pinned here
 * with the arithmetic spelled out rather than computed.
 */
describe('the gap, and which way it points', () => {
  const checkpoints = [count('2026-08-01', 100_000)];
  const rows = [move('2026-08-05', 30_000, A, null)];
  // Derived on the 10th: 100,000 counted, 30,000 spent, so 70,000 should be
  // in the drawer.

  test('gap < 0 — money left that was never logged', () => {
    // He opens the drawer and finds 65,000, not 70,000. Five thousand went
    // somewhere he never typed. The ledger understated spending, so its
    // derived figure read too HIGH.
    const r = reconcileCount(A, checkpoints, rows, '2026-08-10', 65_000);
    assert.equal(r.derivedMinor, 70_000);
    assert.equal(r.gapMinor, -5_000);
    assert.ok(r.gapMinor! < 0);
    assert.equal(r.kind, 'money-missing');
    assert.ok(r.derivedMinor! > r.countedMinor, 'derived must be the higher figure');
    assert.match(explainGap(r), /less here than the ledger/i);
  });

  test('gap > 0 — money arrived that was never logged', () => {
    // He finds 78,000 against a derived 70,000. Either something came in
    // unlogged, or a logged expense was overstated.
    const r = reconcileCount(A, checkpoints, rows, '2026-08-10', 78_000);
    assert.equal(r.gapMinor, 8_000);
    assert.ok(r.gapMinor! > 0);
    assert.equal(r.kind, 'money-appeared');
    assert.ok(r.countedMinor > r.derivedMinor!, 'counted must be the higher figure');
    assert.match(explainGap(r), /more here than the ledger/i);
  });

  test('the two signs are genuinely opposite, not two names for one branch', () => {
    const short = reconcileCount(A, checkpoints, rows, '2026-08-10', 65_000);
    const over = reconcileCount(A, checkpoints, rows, '2026-08-10', 75_000);
    assert.equal(short.gapMinor! + over.gapMinor!, 0);
    assert.notEqual(short.kind, over.kind);
    assert.notEqual(explainGap(short), explainGap(over));
  });

  test('an exact match is a match, not a tiny gap', () => {
    const r = reconcileCount(A, checkpoints, rows, '2026-08-10', 70_000);
    assert.equal(r.gapMinor, 0);
    assert.equal(r.kind, 'matched');
  });

  test('the first count has nothing to disagree with', () => {
    const r = reconcileCount(A, [], rows, '2026-08-01', 100_000);
    assert.equal(r.kind, 'opening');
    assert.equal(r.derivedMinor, null);
    assert.equal(r.gapMinor, null);
  });

  test('a recount on a day already counted is measured against the PREVIOUS count', () => {
    // Otherwise correcting a typo would compare the new figure with itself and
    // report every correction as a perfect match.
    const withToday = [...checkpoints, count('2026-08-10', 70_000)];
    const r = reconcileCount(A, withToday, rows, '2026-08-10', 65_000);
    assert.equal(r.derivedMinor, 70_000);
    assert.equal(r.gapMinor, -5_000);
  });
});

describe('the adjustment the count writes', () => {
  const checkpoints = [count('2026-08-01', 100_000)];
  const rows = [move('2026-08-05', 30_000, A, null)];

  test('money missing writes an expense out of that account', () => {
    const d = adjustmentDraft(reconcileCount(A, checkpoints, rows, '2026-08-10', 65_000))!;
    assert.equal(d.amount_minor, 5_000);
    assert.equal(d.direction, 'expense');
    assert.equal(d.from_account_id, A);
    assert.equal(d.to_account_id, null);
    assert.equal(d.category_slug, UNACCOUNTED_SLUG);
  });

  test('money appeared writes income into that account', () => {
    const d = adjustmentDraft(reconcileCount(A, checkpoints, rows, '2026-08-10', 78_000))!;
    assert.equal(d.amount_minor, 8_000);
    assert.equal(d.direction, 'income');
    assert.equal(d.from_account_id, null);
    assert.equal(d.to_account_id, A);
  });

  test('the amount is always positive — the sign lives in the direction', () => {
    // transactions.amount_minor carries CHECK (> 0). A negative here is a row
    // the database refuses, at the end of a flow the user thought succeeded.
    for (const counted of [65_000, 78_000]) {
      const d = adjustmentDraft(reconcileCount(A, checkpoints, rows, '2026-08-10', counted))!;
      assert.ok(d.amount_minor > 0, `${counted} produced ${d.amount_minor}`);
    }
  });

  test('a matched count writes nothing, and neither does a first count', () => {
    assert.equal(adjustmentDraft(reconcileCount(A, checkpoints, rows, '2026-08-10', 70_000)), null);
    assert.equal(adjustmentDraft(reconcileCount(A, [], rows, '2026-08-01', 100_000)), null);
  });

  test('it is dated the day of the count', () => {
    const d = adjustmentDraft(reconcileCount(A, checkpoints, rows, '2026-08-10', 65_000))!;
    assert.equal(dayKey(d.occurred_at), '2026-08-10');
  });

  /**
   * The invariant the whole scheme rests on. The adjustment exists to make the
   * transaction story add up; it must not then be added on top of the count
   * that produced it, or every reconciliation would double its own gap.
   */
  test('adding it does not move the balance derived from its own checkpoint', () => {
    const result = reconcileCount(A, checkpoints, rows, '2026-08-10', 65_000);
    const draft = adjustmentDraft(result)!;
    const withCount = [...checkpoints, count('2026-08-10', 65_000, A, 'cp-new')];
    const withAdjustment = [...rows, { ...move('2026-08-10', draft.amount_minor, draft.from_account_id, draft.to_account_id) }];

    assert.equal(balanceAt(A, withCount, rows, '2026-08-20').minor, 65_000);
    assert.equal(balanceAt(A, withCount, withAdjustment, '2026-08-20').minor, 65_000);
  });

  test('and it does close the gap the ledger had — that is its whole job', () => {
    const result = reconcileCount(A, checkpoints, rows, '2026-08-10', 65_000);
    const draft = adjustmentDraft(result)!;
    const withAdjustment = [
      ...rows,
      move('2026-08-10', draft.amount_minor, draft.from_account_id, draft.to_account_id),
    ];
    // Re-derived from the ORIGINAL checkpoint, the ledger now lands on the
    // figure that was counted.
    const redone = reconcileCount(A, checkpoints, withAdjustment, '2026-08-10', 65_000);
    assert.equal(redone.gapMinor, 0);
    assert.equal(redone.kind, 'matched');
  });
});

/**
 * Three counts on one account, and the balance read at five points including
 * between them and before any of them.
 */
describe('multiple checkpoints on one account', () => {
  const checkpoints = [
    count('2026-06-01', 1_000_000),
    count('2026-07-01', 400_000),
    count('2026-08-01', 900_000),
  ];
  const rows = [
    move('2026-06-15', 250_000, A, null), // between #0 and #1
    move('2026-07-10', 60_000, A, null), // between #1 and #2
    move('2026-07-20', 10_000, null, A), // between #1 and #2
    move('2026-08-14', 120_000, A, null), // after #2
  ];

  test('before any count: unknown', () => {
    assert.equal(balanceAt(A, checkpoints, rows, '2026-05-31').minor, null);
  });

  test('on the first count: the first count', () => {
    assert.equal(balanceAt(A, checkpoints, rows, '2026-06-01').minor, 1_000_000);
  });

  test('between the first and second: the first, plus what moved', () => {
    assert.equal(balanceAt(A, checkpoints, rows, '2026-06-20').minor, 750_000);
  });

  test('on the second: the second, NOT the first rolled forward', () => {
    // 750,000 was derived and 400,000 was counted. The drawer wins, and the
    // 350,000 disagreement does not survive into the next window.
    assert.equal(balanceAt(A, checkpoints, rows, '2026-07-01').minor, 400_000);
  });

  test('after the third: the third, plus only what moved since it', () => {
    // Not 400,000 − 60,000 + 10,000 − 120,000. The 1 August count supersedes
    // everything before it.
    assert.equal(balanceAt(A, checkpoints, rows, '2026-08-20').minor, 780_000);
  });

  test('each count is measured against its own predecessor', () => {
    const ledger = checkpointLedger(A, checkpoints, rows);
    assert.deepEqual(
      ledger.map((r) => [r.countedAt, r.derivedMinor, r.gapMinor, r.kind]),
      [
        ['2026-06-01', null, null, 'opening'],
        ['2026-07-01', 750_000, -350_000, 'money-missing'],
        // From 400,000: −60,000 +10,000 = 350,000 derived, 900,000 counted.
        ['2026-08-01', 350_000, 550_000, 'money-appeared'],
      ]
    );
  });

  test('the ledger is oldest first regardless of how the rows arrived', () => {
    const shuffled = [checkpoints[2], checkpoints[0], checkpoints[1]];
    assert.deepEqual(
      checkpointLedger(A, shuffled, rows).map((r) => r.countedAt),
      ['2026-06-01', '2026-07-01', '2026-08-01']
    );
  });
});

describe('a column of gaps pointing the same way is a habit, not noise', () => {
  const mixed = checkpointLedger(
    A,
    [count('2026-06-01', 1_000_000), count('2026-07-01', 400_000), count('2026-08-01', 900_000)],
    [move('2026-06-15', 250_000, A, null)]
  );

  test('one short and one over is measurement noise, and is not dressed up', () => {
    assert.equal(gapPattern(mixed).kind, 'mixed');
    assert.equal(gapPattern(mixed).consistent, false);
  });

  test('two counts both short is a leak, and it is named', () => {
    const leaky = checkpointLedger(
      A,
      [count('2026-06-01', 100_000), count('2026-07-01', 60_000), count('2026-08-01', 20_000)],
      [move('2026-06-15', 10_000, A, null), move('2026-07-15', 10_000, A, null)]
    );
    const p = gapPattern(leaky);
    assert.equal(p.kind, 'money-missing');
    assert.equal(p.consistent, true);
    assert.equal(p.gapCount, 2);
    // −30,000 and −30,000.
    assert.equal(p.netMinor, -60_000);
    assert.equal(p.averageMinor, -30_000);
  });

  test('openings and exact matches are not evidence of anything', () => {
    const clean = checkpointLedger(
      A,
      [count('2026-06-01', 100_000), count('2026-07-01', 90_000)],
      [move('2026-06-15', 10_000, A, null)]
    );
    assert.equal(gapPattern(clean).kind, 'none');
    assert.equal(gapPattern(clean).gapCount, 0);
  });
});

describe('a drawer does not net — raw amounts, not effectiveMinor', () => {
  // The 166,100 lunch, and 113,000 that came back four days later.
  const rows = [
    move('2026-08-05', 166_100, A, null),
    move('2026-08-09', 113_000, null, A),
  ];
  const opening = [count('2026-08-01', 200_000)];

  test('over a window holding both legs, netted and raw agree exactly', () => {
    // 200,000 − 166,100 + 113,000 = 146,900, which is also 200,000 − 53,100.
    assert.equal(balanceAt(A, opening, rows, '2026-08-31').minor, 146_900);
    assert.equal(200_000 - (166_100 - 113_000), 146_900);
  });

  test('a count taken between them sees the money gone, because it is gone', () => {
    // This is why the raw amounts are the right ones. Netting here would claim
    // 146,900 was in a drawer that held 33,900, and report a 113,000 gap that
    // does not exist.
    assert.equal(balanceAt(A, opening, rows, '2026-08-07').minor, 33_900);
  });
});

describe('against the real corpus', () => {
  test('the checkpoint model reproduces the reconciliation, to the tiyin', () => {
    // The strongest claim available that Stage 2 moved no historical figure:
    // two independent routes to the same number. `reconcile` walks month
    // totals from an opening balance; `balanceAt` walks individual rows from a
    // physical count. They agree at the end of every month.
    const ledger = reconcile(monthTotals(CORPUS_ROWS), OPENING);
    assert.equal(balanceAt(MAIN_ID, CHECKPOINTS, MOVEMENTS, '2026-07-31').minor,
      ledger.months[0].closingMinor);
    assert.equal(balanceAt(MAIN_ID, CHECKPOINTS, MOVEMENTS, '2026-08-31').minor,
      ledger.months[1].closingMinor);
    assert.equal(balanceAt(MAIN_ID, CHECKPOINTS, MOVEMENTS, '2026-08-31').minor, 187_803_111);
  });

  test('every one of the 153 rows moves Main, and only Main', () => {
    let touched = 0;
    for (const row of MOVEMENTS) {
      if (accountDeltaMinor(row, MAIN_ID) !== 0) touched++;
      assert.equal(accountDeltaMinor(row, MOM_UZS_ID), 0);
    }
    assert.equal(touched, 153);
  });

  test('the salary lands on the side it actually arrived on', () => {
    // The row that made the case for this whole stage: direction says expense,
    // the category says income, and 008's backfill believed direction. It read
    // as 4,625,000 leaving the drawer that it in fact entered.
    const salary = MOVEMENTS.find((r) => r.amount_minor === 462_500_000)!;
    assert.equal(accountDeltaMinor(salary, MAIN_ID), 462_500_000);
    assert.ok(accountDeltaMinor(salary, MAIN_ID) > 0, 'salary arrives; it does not leave');
  });

  test('the opening count is the opening balance — one concept, not two', () => {
    const first = CHECKPOINTS.find((c) => c.account_id === MAIN_ID)!;
    assert.equal(first.counted_minor, OPENING.amountMinor);
    assert.equal(first.counted_at, OPENING_COUNTED_AT);
  });
});

/**
 * "Adjustment transactions must never enter a real category's totals."
 *
 * Checked by running the real month aggregation with and without one, and
 * asserting that every real category comes out identical while the difference
 * appears under 'unaccounted' alone.
 */
describe('an adjustment never lands in a real category', () => {
  const key = '2026-08';
  const before = categoryBreakdown(CORPUS_ROWS, key);
  const adjustment = {
    id: 'adj-1',
    reimburses_transaction_id: null,
    amount_minor: 250_000 * 100,
    direction: 'expense' as const,
    occurred_at: atLocalNoon('2026-08-31'),
    date_precision: 'day' as const,
    needs_review: false,
    finance_categories: {
      slug: UNACCOUNTED_SLUG,
      name: 'Unaccounted',
      icon: '≠',
      color: '#EF4444',
      kind: 'expense' as const,
    },
  };
  const after = categoryBreakdown([...CORPUS_ROWS, adjustment], key);

  test('every real category total is untouched', () => {
    const realBefore = before.filter((s) => s.slug !== UNACCOUNTED_SLUG);
    const realAfter = after.filter((s) => s.slug !== UNACCOUNTED_SLUG);
    assert.deepEqual(
      realAfter.map((s) => [s.slug, s.minor]),
      realBefore.map((s) => [s.slug, s.minor])
    );
  });

  test('the whole of it shows up under unaccounted, and nowhere else', () => {
    const slice = after.find((s) => s.slug === UNACCOUNTED_SLUG);
    assert.ok(slice, 'the adjustment must be visible as its own line');
    assert.equal(slice.minor, 250_000 * 100);
    assert.equal(before.some((s) => s.slug === UNACCOUNTED_SLUG), false);
  });

  test('it counts as spending — a gap that moved no total closed nothing', () => {
    assert.equal(classifyRow(adjustment), 'spend');
    const [, august] = monthTotals([...CORPUS_ROWS, adjustment]);
    const [, augustBefore] = monthTotals(CORPUS_ROWS);
    assert.equal(august.spendMinor - augustBefore.spendMinor, 250_000 * 100);
  });

  test('but it stays out of the everyday floor', () => {
    // Money he never logged is not a statement about groceries, transport and
    // eating out, and letting it in would make the one figure he steers by
    // drift upward every time he lost track of cash.
    const [, august] = monthTotals([...CORPUS_ROWS, adjustment]);
    const [, augustBefore] = monthTotals(CORPUS_ROWS);
    assert.equal(august.coreMinor, augustBefore.coreMinor);
  });

  test('an appeared-money adjustment reaches income, not a spend category', () => {
    const arrived = { ...adjustment, id: 'adj-2', direction: 'income' as const };
    assert.equal(classifyRow(arrived), 'income');
    const [, august] = monthTotals([...CORPUS_ROWS, arrived]);
    const [, augustBefore] = monthTotals(CORPUS_ROWS);
    assert.equal(august.incomeMinor - augustBefore.incomeMinor, 250_000 * 100);
    assert.deepEqual(
      categoryBreakdown([...CORPUS_ROWS, arrived], key).map((s) => [s.slug, s.minor]),
      before.map((s) => [s.slug, s.minor])
    );
  });
});

describe('atLocalNoon', () => {
  test('round-trips through dayKey for every day of a year', () => {
    // The property the adjustment's date depends on. If these disagreed, an
    // adjustment could land on the day after its own count and be added on top
    // of it.
    const d = new Date(2026, 0, 1);
    for (let i = 0; i < 365; i++) {
      const day = dayKey(d.toISOString());
      assert.equal(dayKey(atLocalNoon(day)), day);
      d.setDate(d.getDate() + 1);
    }
  });
});
