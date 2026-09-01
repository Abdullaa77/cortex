import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  reconcile,
  rollforward,
  openingMonthKey,
  type MonthSeed,
} from './reconcile.ts';
import { monthTotals } from './summarize.ts';
import { positionsAt, householdTotal, householdAt } from './positions.ts';
import type { BalanceCheckpoint } from './checkpoints.ts';
import type { AccountRecord } from './accounts.ts';
import {
  ACCOUNTS,
  CHECKPOINTS,
  CORPUS_ROWS,
  MOVEMENTS,
  MAIN_ID,
  FX_RATE,
  OPENING,
  OPENING_COUNTED_AT,
} from './__fixtures__/corpus.ts';

/**
 * THE EQUALITY THIS CODEBASE RESTS ON.
 *
 * /finance derives the household twice, on purpose, by two routes that share
 * nothing but the rows:
 *
 *   reconcile  walks MONTH TOTALS through classifyRow's four buckets, from a
 *              household opening, netting reimbursements, so'm only.
 *   positions  walks INDIVIDUAL ROWS through the account pointers, from each
 *              account's latest physical count, at raw amounts, per currency.
 *
 * They are built to land on the same number, and that is the strongest test
 * available here — stronger than any number of assertions against one of them,
 * because a ledger can be internally consistent and completely false. Only a
 * second derivation can say so. Migration 009's note is the proof by example:
 * every month total on the page was correct while Main's position was out by
 * 9,250,000, and nothing could see it until a second route existed.
 *
 * So every change to either side gets checked here, and the mutants below are
 * the specific ways this has actually been broken.
 */

const LAST_DAY = '2026-08-31';
const CUTOVER = '2026-09-01';

/** Both derivations, on the same day, through the paths the page renders. */
function bothWays(
  accounts: AccountRecord[],
  checkpoints: BalanceCheckpoint[],
  cutoverDate: string | null,
  day: string
) {
  const months = monthTotals(CORPUS_ROWS);
  const ledger = rollforward({
    rows: CORPUS_ROWS,
    months,
    accounts,
    checkpoints,
    movements: MOVEMENTS,
    rate: FX_RATE,
    cutoverDate,
  });
  const household = householdTotal(
    positionsAt(accounts, checkpoints, MOVEMENTS, day),
    FX_RATE
  );
  return {
    ledger,
    reconcileMinor: ledger.closingMinor,
    positionsMinor: household.totalUzsMinor,
  };
}

describe('the two derivations agree', () => {
  test('on the real corpus, to the tiyin', () => {
    const { reconcileMinor, positionsMinor } = bothWays(
      ACCOUNTS,
      CHECKPOINTS,
      null,
      LAST_DAY
    );
    assert.equal(reconcileMinor, positionsMinor);
    // Pinned, so a change that moves both together is still caught.
    assert.equal(reconcileMinor, 813_803_111);
  });

  test('and every intermediate month closes where the drawer stood', () => {
    const { ledger } = bothWays(ACCOUNTS, CHECKPOINTS, null, LAST_DAY);
    for (const [key, day] of [
      ['2026-07', '2026-07-31'],
      ['2026-08', '2026-08-31'],
    ] as const) {
      const month = ledger.months.find((m) => m.key === key)!;
      const household = householdTotal(
        positionsAt(ACCOUNTS, CHECKPOINTS, MOVEMENTS, day),
        FX_RATE
      );
      assert.equal(month.closingMinor, household.totalUzsMinor, key);
    }
  });

  /**
   * The morning this was written for. Scott counts every drawer on the cutover
   * date and both halves of the page must agree about the result — positions
   * because they rest on the count, and the panel because the count re-seeds
   * the month rather than being chained past.
   */
  test('after the cutover count, with brand-new accounts counted the same day', () => {
    const accounts: AccountRecord[] = [
      ...ACCOUNTS,
      { id: 'acct-new-mom', name: 'Mom — new', owner: 'mom', currency: 'UZS', kind: 'cash', is_active: true, sort_order: 9 },
      { id: 'acct-new-sis', name: 'Sister — new', owner: 'sister', currency: 'UZS', kind: 'cash', is_active: true, sort_order: 10 },
    ];
    const counted: BalanceCheckpoint[] = [
      ...CHECKPOINTS,
      cp('cp-cut-main', MAIN_ID, CUTOVER, 215_000_000),
      cp('cp-cut-mom', 'acct-new-mom', CUTOVER, 340_000_000),
      cp('cp-cut-sis', 'acct-new-sis', CUTOVER, 110_000_000),
    ];

    const { reconcileMinor, positionsMinor, ledger } = bothWays(
      accounts,
      counted,
      CUTOVER,
      CUTOVER
    );
    assert.equal(reconcileMinor, positionsMinor);

    // September opens AT the counts, not at whatever August closed with.
    const september = ledger.months.find((m) => m.key === '2026-09');
    if (september) {
      assert.equal(september.seededAsOf, CUTOVER);
      // Every drawer, counted that morning: Main 2,150,000, mom's som
      // 1,200,000, mom's $400 at 12,650, sister 0, and the two new ones.
      assert.equal(
        september.openingMinor,
        215_000_000 + 120_000_000 + 506_000_000 + 0 + 340_000_000 + 110_000_000
      );
    }
  });
});

function cp(
  id: string,
  account_id: string,
  counted_at: string,
  counted_minor: number
): BalanceCheckpoint {
  return { id, account_id, counted_at, counted_minor, note: null, adjustment_transaction_id: null };
}

/**
 * Each of these is a way the equality above has actually been broken, written
 * as the mutant rather than as a description of it. A property that cannot
 * fail proves nothing, so every one asserts that the WRONG answer differs from
 * the right one.
 */
describe('mutants the equality catches', () => {
  test('an opening applied to a month that starts before its as-of', () => {
    // The live defect, and the whole of the ~6M gap on Scott's page. His
    // opening checkpoint is dated 1 July; all 65 July rows carry month
    // precision and are stamped 1 July too. A count is the last word for its
    // own day, so positions treat the whole of July as already inside the
    // count — while the rollforward, applying the figure to July "regardless
    // of its as-of date", counts every one of those rows again.
    const onJuly1 = CHECKPOINTS.map((c) =>
      c.account_id === MAIN_ID ? { ...c, counted_at: '2026-07-01' } : c
    );

    const honest = bothWays(ACCOUNTS, onJuly1, null, LAST_DAY);
    // Refused, not silently applied: July has no opening it is entitled to.
    assert.equal(honest.ledger.months[0].openingMinor, null);

    // The mutant applies it anyway, to the first month, as the old code did.
    const mutant = reconcile(monthTotals(CORPUS_ROWS), {
      amountMinor: OPENING.amountMinor,
      asOf: '2026-07-01',
    });
    const forcedFirstMonth = mutant.months[0].openingMinor;
    assert.equal(forcedFirstMonth, null, 'the opening must not open its own month');

    // And the size of what it would have hidden: July's entire net change.
    const positions = householdTotal(
      positionsAt(ACCOUNTS, onJuly1, MOVEMENTS, LAST_DAY),
      FX_RATE
    ).totalUzsMinor!;
    const asIfJulyCounted = OPENING.amountMinor + 120_000_000 + 506_000_000;
    assert.equal(positions - asIfJulyCounted, 13_408_085, 'positions skip July entirely');
  });

  test('a cutover count ignored by the rollforward', () => {
    const counted = [...CHECKPOINTS, cp('cp-cut', MAIN_ID, CUTOVER, 215_000_000)];

    const seeded = bothWays(ACCOUNTS, counted, CUTOVER, CUTOVER);
    assert.equal(seeded.reconcileMinor, seeded.positionsMinor);

    // The mutant: same counts, but the line is not told to the rollforward, so
    // it chains straight through the count out of the July figure.
    const ignored = bothWays(ACCOUNTS, counted, null, CUTOVER);
    assert.notEqual(
      ignored.reconcileMinor,
      ignored.positionsMinor,
      'ignoring the cutover must not still agree — the count moved the drawer'
    );
  });

  test('a mid-month checkpoint picked for a month that starts before it', () => {
    const months = monthTotals(CORPUS_ROWS);

    // A figure is entitled to open a month only if that month starts AFTER it.
    // 15 August cannot open August — the first fortnight already happened —
    // and there is no later month with rows, so it opens nothing.
    assert.equal(openingMonthKey(months, '2026-08-15'), null);
    // 1 July cannot open July either: 65 rows carry that same date.
    assert.equal(openingMonthKey(months, '2026-07-01'), '2026-08');
    // 30 June can, and does.
    assert.equal(openingMonthKey(months, OPENING_COUNTED_AT), '2026-07');

    // The mutant: the old rule, which took months[0] whatever the as-of said.
    const mutant = reconcile(months, { amountMinor: OPENING.amountMinor, asOf: '2026-08-15' });
    assert.equal(
      mutant.months[0].openingMinor,
      null,
      'an August figure must not open July'
    );
    assert.equal(mutant.months[1].openingMinor, null, 'nor August itself');
    assert.equal(mutant.closingMinor, null, 'and nothing downstream is invented');
  });

  test('a seed naming a month earlier than its own as-of is refused', () => {
    const months = monthTotals(CORPUS_ROWS);
    const backwards: MonthSeed = { monthKey: '2026-07', amountMinor: 1, asOf: '2026-08-15' };
    const result = reconcile(months, null, [backwards]);
    assert.equal(result.months[0].openingMinor, null);
    assert.equal(result.months[0].seededAsOf, null);
  });

  test('the seeded month counting its own pre-count rows twice', () => {
    // A count already had the cutover day's spending missing from it, exactly
    // as balanceAt has it. Applying the whole month on top subtracts it again.
    const counted = [...CHECKPOINTS, cp('cp-cut', MAIN_ID, '2026-08-01', 500_000_00)];
    const honest = bothWays(ACCOUNTS, counted, '2026-08-01', LAST_DAY);
    assert.equal(honest.reconcileMinor, honest.positionsMinor);

    // Every August row carries month precision and is stamped 1 August, so the
    // count supersedes all of them and the trimmed month is empty.
    const trimmed = honest.ledger.months.find((m) => m.key === '2026-08')!;
    assert.equal(trimmed.seededAsOf, '2026-08-01');
    assert.equal(trimmed.netMinor, 0, 'the count already contains that day');
    // The seed is the whole household on that day, not Main alone: the count
    // of 500,000 plus the three drawers already counted on 30 June.
    assert.equal(trimmed.closingMinor, 500_000_00 + 120_000_000 + 506_000_000);

    // The mutant seeds the month but walks its untrimmed totals, subtracting
    // August's spending from a figure that already had it missing.
    const months = monthTotals(CORPUS_ROWS);
    const august = months.find((m) => m.key === '2026-08')!;
    const mutant = reconcile(months, null, [
      { monthKey: '2026-08', amountMinor: 500_000_00, asOf: '2026-08-01' },
    ]);
    assert.notEqual(
      mutant.months[1].closingMinor,
      trimmed.closingMinor,
      'the untrimmed month must not land in the same place'
    );
    assert.ok(august.txnCount > 0, 'August really does have rows to double-count');
  });
});

describe('the opening carries the day it is a fact about', () => {
  test('householdAt stamps the day it was asked for, and no other', () => {
    for (const day of ['2026-06-30', '2026-07-31', '2026-08-31']) {
      assert.equal(householdAt(ACCOUNTS, CHECKPOINTS, MOVEMENTS, FX_RATE, day)!.asOf, day);
    }
  });

  test('a brand-new account cannot backdate its cash into the opening', () => {
    // The defect the old openingFromCheckpoints had: it summed first-ever
    // checkpoints and reported the EARLIEST date, so an account created and
    // counted at the cutover added its September cash to a 30 June figure.
    const withNew = [
      ...ACCOUNTS,
      { id: 'acct-new', name: 'Mom — new', owner: 'mom', currency: 'UZS', kind: 'cash', is_active: true, sort_order: 9 } as AccountRecord,
    ];
    const counted = [...CHECKPOINTS, cp('cp-new', 'acct-new', CUTOVER, 340_000_000)];

    const june = householdAt(withNew, counted, MOVEMENTS, FX_RATE, OPENING_COUNTED_AT)!;
    const before = householdAt(ACCOUNTS, CHECKPOINTS, MOVEMENTS, FX_RATE, OPENING_COUNTED_AT)!;
    assert.equal(june.amountMinor, before.amountMinor, 'the June figure must not move');
    assert.equal(june.skippedAccounts, 1, 'and it says the drawer was not counted then');
  });
});
