import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  accountDeltaMinor,
  balanceAt,
  basisCheckpoint,
  reconcileCount,
  adjustmentDraft,
  UNACCOUNTED_SLUG,
  type BalanceCheckpoint,
  type MovementRow,
} from './checkpoints.ts';
import { householdTotal, openingFromCheckpoints, positionsAt } from './positions.ts';
import { needsOtherSide, planPairDeletion, type PairableRow } from './transfers.ts';
import { categoryBreakdown, classifyRow, monthTotals } from './summarize.ts';
import { movementShape, sidesForClass } from './accounts.ts';
import { dayKey, atLocalNoon } from './cutover.ts';
import {
  ACCOUNTS,
  CHECKPOINTS,
  MOVEMENTS,
  PAIRABLE_ROWS,
  CORPUS_ROWS,
  CORPUS_RECORDS,
  FX_RATE,
  MAIN_ID,
  MOM_USD_ID,
} from './__fixtures__/corpus.ts';

/**
 * PROVING THE NEW ASSERTIONS CAN FAIL.
 *
 * A reconciliation test nobody has shown can fail is decoration. Everything in
 * checkpoints.test.ts and positions.test.ts passes; that on its own is
 * consistent both with the code being right and with the assertions being too
 * loose to notice if it were not.
 *
 * So each defect worth fearing is written out here as a MUTANT — a small
 * deliberately wrong reimplementation of one decision — and the property the
 * real suite relies on is run against it. The test passes only when the mutant
 * FAILS that property. If a mutant ever starts passing, the assertion that was
 * supposed to catch it has gone slack and the coverage it appeared to give was
 * imaginary.
 *
 * Every mutant below is a defect that would have been plausible to write. None
 * of them are strawmen: three of them are things this codebase or its
 * migrations actually did.
 */

/** Passes when the property genuinely rejects the mutant. */
function detects(property: () => void): void {
  assert.throws(
    property,
    (err: unknown) => err instanceof assert.AssertionError,
    'the mutant satisfied the property — that assertion cannot fail, so it proves nothing'
  );
}

const A = 'acct-a';
let seq = 0;
const move = (day: string, minor: number, from: string | null, to: string | null): MovementRow => ({
  id: `m-${seq++}`,
  amount_minor: minor,
  occurred_at: atLocalNoon(day),
  from_account_id: from,
  to_account_id: to,
});
const count = (day: string, minor: number, account = A): BalanceCheckpoint => ({
  id: `cp-${day}`,
  account_id: account,
  counted_at: day,
  counted_minor: minor,
  note: null,
  adjustment_transaction_id: null,
});

const CHECKS = [count('2026-08-01', 100_000)];
const ROWS = [move('2026-08-05', 30_000, A, null)];

describe('the gap direction is genuinely pinned', () => {
  test('a flipped gap is caught — derived − counted instead of counted − derived', () => {
    // This is the defect the spec calls out by name: it has been stated
    // backwards once already in design conversation, and a suite that only
    // covers gap<0 would pass while the copy told Scott the opposite.
    const mutantGap = (counted: number, derived: number) => derived - counted;

    detects(() => {
      const real = reconcileCount(A, CHECKS, ROWS, '2026-08-10', 65_000);
      assert.equal(mutantGap(real.countedMinor, real.derivedMinor!), real.gapMinor);
    });
  });

  test('collapsing both signs into one kind is caught', () => {
    // "Any disagreement is money missing" would pass every gap<0 test ever
    // written and be wrong exactly half the time.
    const mutantKind = () => 'money-missing' as const;

    detects(() => {
      const over = reconcileCount(A, CHECKS, ROWS, '2026-08-10', 78_000);
      assert.equal(mutantKind(), over.kind);
    });
  });

  test('an absolute-value gap is caught', () => {
    const mutantGap = (counted: number, derived: number) => Math.abs(counted - derived);
    detects(() => {
      const short = reconcileCount(A, CHECKS, ROWS, '2026-08-10', 65_000);
      assert.equal(mutantGap(short.countedMinor, short.derivedMinor!), short.gapMinor);
    });
  });

  test('an adjustment written with a signed amount is caught', () => {
    // transactions.amount_minor carries CHECK (> 0), so a signed amount is a
    // row the database refuses at the end of a flow the user thought worked.
    const real = adjustmentDraft(reconcileCount(A, CHECKS, ROWS, '2026-08-10', 65_000))!;
    const mutant = { ...real, amount_minor: -real.amount_minor };
    detects(() => assert.ok(mutant.amount_minor > 0));
  });

  test('an adjustment pointed the wrong way is caught', () => {
    // Money missing must LEAVE the account. An adjustment that files it as
    // income would close the gap arithmetically and double the error.
    const real = adjustmentDraft(reconcileCount(A, CHECKS, ROWS, '2026-08-10', 65_000))!;
    const mutant = { ...real, direction: 'income' as const, from_account_id: null, to_account_id: A };
    detects(() => {
      assert.equal(mutant.direction, 'expense');
      assert.equal(mutant.from_account_id, A);
    });
  });
});

describe('the checkpoint window is genuinely pinned', () => {
  test('including the count\'s own day is caught — the double-count', () => {
    // >= instead of > on the boundary. Every row typed on the day of a count
    // would be subtracted a second time, and the app would report a gap it
    // had itself created.
    const mutantBalance = (day: string, rows: MovementRow[]) => {
      const basis = basisCheckpoint(CHECKS, A, day)!;
      let moved = 0;
      for (const row of rows) {
        const d = dayKey(row.occurred_at);
        if (d < basis.counted_at || d > day) continue; // the mutation: < not <=
        moved += accountDeltaMinor(row, A);
      }
      return basis.counted_minor + moved;
    };

    const sameDay = [...ROWS, move('2026-08-01', 9_999, A, null)];
    detects(() =>
      assert.equal(mutantBalance('2026-08-01', sameDay), balanceAt(A, CHECKS, sameDay, '2026-08-01').minor)
    );
  });

  test('an adjustment that moves its own checkpoint\'s balance is caught', () => {
    // The consequence of the above, stated as the invariant that matters.
    const result = reconcileCount(A, CHECKS, ROWS, '2026-08-10', 65_000);
    const draft = adjustmentDraft(result)!;
    // The mutant dates the adjustment the day AFTER the count, which is the
    // natural-looking choice and the wrong one.
    const badlyDated = move('2026-08-11', draft.amount_minor, draft.from_account_id, draft.to_account_id);
    const withCount = [...CHECKS, count('2026-08-10', 65_000)];

    detects(() =>
      assert.equal(balanceAt(A, withCount, [...ROWS, badlyDated], '2026-08-20').minor, 65_000)
    );
  });

  test('taking the earliest checkpoint instead of the latest is caught', () => {
    const many = [count('2026-08-01', 1), count('2026-08-10', 2), count('2026-08-20', 3)];
    const mutantBasis = (day: string) =>
      many.filter((c) => c.counted_at <= day).sort((a, b) => a.counted_at.localeCompare(b.counted_at))[0];

    detects(() =>
      assert.equal(mutantBasis('2026-08-15').counted_minor, basisCheckpoint(many, A, '2026-08-15')!.counted_minor)
    );
  });

  test('measuring a recount against itself is caught', () => {
    // 'at-or-before' instead of 'before' would report every correction as a
    // perfect match — the most reassuring possible bug.
    const withToday = [...CHECKS, count('2026-08-10', 70_000)];
    const mutantBasis = basisCheckpoint(withToday, A, '2026-08-10', 'at-or-before')!;
    const realBasis = basisCheckpoint(withToday, A, '2026-08-10', 'before')!;
    detects(() => assert.equal(mutantBasis.counted_at, realBasis.counted_at));
  });
});

describe('uncounted-is-not-zero is genuinely pinned', () => {
  test('a zero for an uncounted account is caught', () => {
    const mutant = 0;
    detects(() => assert.equal(mutant, balanceAt(A, CHECKS, ROWS, '2026-07-31').minor));
  });

  test('a household total that quietly drops an uncounted account is caught', () => {
    const partial = CHECKPOINTS.filter((c) => c.account_id !== MOM_USD_ID);
    const positions = positionsAt(ACCOUNTS, partial, MOVEMENTS, '2026-08-31');
    const real = householdTotal(positions, FX_RATE);
    // The mutant says nothing about what it left out.
    const mutant = { ...real, uncounted: [] };
    detects(() => assert.equal(mutant.uncounted.length, real.uncounted.length));
  });

  test('a som-only figure presented as the household total is caught', () => {
    // The subtlest one here. With dollars uncounted-for and no rate, returning
    // the som part is a smaller number wearing the label of the whole.
    const positions = positionsAt(ACCOUNTS, CHECKPOINTS, MOVEMENTS, '2026-08-31');
    const real = householdTotal(positions, null);
    const mutantTotal = real.byCurrency.find((c) => c.currency === 'UZS')!.minor;
    detects(() => assert.equal(mutantTotal, real.totalUzsMinor));
  });

  test('adding dollars into a som opening without a rate is caught', () => {
    const real = openingFromCheckpoints(ACCOUNTS, CHECKPOINTS, null)!;
    const mutant = CHECKPOINTS.reduce((n, c) => n + c.counted_minor, 0);
    detects(() => assert.equal(mutant, real.amountMinor));
  });
});

describe('the account pointers are genuinely pinned', () => {
  test('reading `direction` instead of the pointers is caught', () => {
    // This is not hypothetical. Migration 008's backfill did exactly this, and
    // it put July's 4,625,000 salary on the wrong side of the drawer — a
    // 9,250,000 error in the position with every month total still perfect.
    const mutantDelta = (row: { direction: 'expense' | 'income'; amount_minor: number }) =>
      row.direction === 'expense' ? -row.amount_minor : row.amount_minor;

    const salary = CORPUS_RECORDS.find((r) => r.amount_minor === 462_500_000)!;
    detects(() => assert.equal(mutantDelta(salary), accountDeltaMinor(salary, MAIN_ID)));
  });

  test('and the whole-corpus consequence is caught, not just the one row', () => {
    const mutantTotal = CORPUS_RECORDS.reduce(
      (n, r) => n + (r.direction === 'expense' ? -r.amount_minor : r.amount_minor),
      0
    );
    const realTotal = MOVEMENTS.reduce((n, r) => n + accountDeltaMinor(r, MAIN_ID), 0);
    detects(() => assert.equal(mutantTotal, realTotal));
  });

  test('sidesForClass putting arriving money on the from side is caught', () => {
    const mutant = (id: string) => ({ from_account_id: id, to_account_id: null });
    detects(() => assert.deepEqual(mutant(MAIN_ID), sidesForClass('income', MAIN_ID)));
  });

  test('a transfer that fails to cancel across both accounts is caught', () => {
    // The mutant subtracts on both sides — the shape you get from asking
    // "did money leave?" per account instead of reading the two pointers. The
    // household would appear to lose 500 every time it moved 500 internally.
    const row = move('2026-08-01', 500, A, 'acct-b');
    const mutantDelta = (id: string) => (row.from_account_id === id || row.to_account_id === id ? -row.amount_minor : 0);
    detects(() => assert.equal(mutantDelta(A) + mutantDelta('acct-b'), 0));
    // And the real implementation does cancel, which is the point being made.
    assert.equal(accountDeltaMinor(row, A) + accountDeltaMinor(row, 'acct-b'), 0);
  });
});

describe('the adjustment staying out of real categories is genuinely pinned', () => {
  const key = '2026-08';
  const before = categoryBreakdown(CORPUS_ROWS, key);

  const asCategory = (slug: string, name: string) => ({
    id: 'adj-mutant',
    reimburses_transaction_id: null,
    amount_minor: 250_000 * 100,
    direction: 'expense' as const,
    occurred_at: atLocalNoon('2026-08-31'),
    date_precision: 'day' as const,
    needs_review: false,
    finance_categories: { slug, name, icon: '?', color: '#000', kind: 'expense' as const },
  });

  test('filing a gap under Groceries is caught', () => {
    const after = categoryBreakdown([...CORPUS_ROWS, asCategory('groceries', 'Groceries')], key);
    detects(() =>
      assert.deepEqual(
        after.filter((s) => s.slug !== UNACCOUNTED_SLUG).map((s) => [s.slug, s.minor]),
        before.filter((s) => s.slug !== UNACCOUNTED_SLUG).map((s) => [s.slug, s.minor])
      )
    );
  });

  test('filing it under uncategorised — the "Other" bucket — is caught too', () => {
    // The tempting compromise, and the one the spec rejects by name: burying
    // it there destroys exactly the signal worth having.
    const after = categoryBreakdown([...CORPUS_ROWS, asCategory('uncategorised', 'Uncategorised')], key);
    detects(() => {
      const slice = after.find((s) => s.slug === UNACCOUNTED_SLUG);
      assert.ok(slice);
      assert.equal(slice.minor, 250_000 * 100);
    });
  });

  test('letting an adjustment into the everyday floor is caught', () => {
    // CORE_SLUGS gaining 'unaccounted' would make the one figure Scott steers
    // by drift upward every time he lost track of cash.
    const adjustment = asCategory(UNACCOUNTED_SLUG, 'Unaccounted');
    const CORE_WITH_LEAK = ['groceries', 'transport', 'eating-out', UNACCOUNTED_SLUG];
    const mutantCore = [...CORPUS_ROWS, adjustment]
      .filter(
        (r) => classifyRow(r) === 'spend' && CORE_WITH_LEAK.includes(r.finance_categories?.slug ?? '')
      )
      .filter((r) => r.occurred_at >= '2026-08-01')
      .reduce((n, r) => n + r.amount_minor, 0);
    const [, augustBefore] = monthTotals(CORPUS_ROWS);

    detects(() => assert.equal(mutantCore, augustBefore.coreMinor));
  });

  test('an adjustment that moves no total is caught', () => {
    // A gap "closed" by a row that changes nothing has closed nothing.
    const [, augustBefore] = monthTotals(CORPUS_ROWS);
    const mutant = augustBefore.spendMinor;
    const [, augustAfter] = monthTotals([...CORPUS_ROWS, asCategory(UNACCOUNTED_SLUG, 'Unaccounted')]);
    detects(() => assert.equal(mutant, augustAfter.spendMinor));
  });
});

describe('the half-mapped-transfer queue is genuinely pinned', () => {
  test('putting ordinary expenses in the queue is caught', () => {
    // Reading `direction` rather than the movement shape sweeps 130 grocery
    // rows into a queue that asks "where did this go?" about a bag of bananas.
    const mutantQueue = PAIRABLE_ROWS.filter((r) => r.to_account_id === null);
    detects(() => assert.equal(mutantQueue.length, needsOtherSide(PAIRABLE_ROWS).length));
  });

  test('inferring a destination is caught', () => {
    // A guess written into a ledger is indistinguishable from a fact a week
    // later. The 4,850,000 must stay open until Scott answers it.
    const inferred: PairableRow[] = PAIRABLE_ROWS.map((r) =>
      r.raw_input.includes('transferred to mom for 400$')
        ? { ...r, to_account_id: MOM_USD_ID }
        : r
    );
    detects(() => assert.equal(needsOtherSide(inferred).length, 17));
  });

  test('treating an unassigned row as a resolvable transfer is caught', () => {
    // With neither side known there is no end to resolve from, so it belongs
    // to the account-assignment problem, not this queue.
    const orphan: PairableRow = {
      ...PAIRABLE_ROWS.find((r) => r.raw_input.includes('sent to PersonE'))!,
      from_account_id: null,
      to_account_id: null,
    };
    assert.equal(movementShape(orphan), 'unassigned');
    const mutantQueue = [...needsOtherSide(PAIRABLE_ROWS), { row: orphan }];
    detects(() => assert.equal(mutantQueue.length, needsOtherSide([...PAIRABLE_ROWS, orphan]).length));
  });
});

describe('the currency guard on the som totals is genuinely pinned', () => {
  test('a dollar row added raw into a som month is caught', () => {
    // $400 in a som total reads as 400 so'm — not a conspicuous number in a
    // month that runs to millions. It would simply make August a little wrong
    // forever.
    const dollarRow = {
      ...CORPUS_ROWS[0],
      id: 'usd-1',
      currency: 'USD' as const,
      amount_minor: 400 * 100,
      occurred_at: atLocalNoon('2026-08-15'),
    };
    const [, real] = monthTotals([...CORPUS_ROWS, dollarRow]);
    const [, baseline] = monthTotals(CORPUS_ROWS);
    // The mutant is the old behaviour: no currency guard, so the row lands in
    // the som spend total.
    const mutantSpend = baseline.spendMinor + 400 * 100;
    detects(() => assert.equal(mutantSpend, real.spendMinor));
  });
});


/**
 * The half-deleted pair.
 *
 * `ON DELETE SET NULL` makes this safe at the database — the survivor keeps its
 * amount and its account, and loses only the pointer. What it does not make is
 * LOUD, and the two are different requirements. The mutants below are the two
 * ways to satisfy safety and fail loudness.
 */
describe('a half-deleted pair does not orphan quietly', () => {
  const som = needsOtherSide(PAIRABLE_ROWS).find((o) =>
    o.row.raw_input.includes('transferred to mom for 400$')
  )!.row;

  const dollars: PairableRow = {
    id: 'usd-leg',
    amount_minor: 40_000,
    currency: 'USD',
    direction: 'income',
    occurred_at: som.occurred_at,
    comment: som.comment,
    raw_input: som.raw_input,
    from_account_id: null,
    to_account_id: MOM_USD_ID,
    transfer_pair_id: som.id,
    finance_categories: som.finance_categories,
  };

  const paired: PairableRow[] = [
    ...PAIRABLE_ROWS.map((r) => (r.id === som.id ? { ...r, transfer_pair_id: dollars.id } : r)),
    dollars,
  ];

  test('a local delete that forgets to null the survivor is caught', () => {
    // THE DEFECT THAT WAS ACTUALLY THERE. `deleteRow` mirrored the FK's SET
    // NULL for `reimburses_transaction_id` and not for `transfer_pair_id`, so
    // in the page's own copy the surviving leg went on pointing at a row that
    // no longer existed. It read as answered — its counterpart names where the
    // money went — and stayed out of the queue until something forced a
    // refetch. Safe, and silent, which is the combination the requirement
    // rules out.
    const mutantAfterDelete = paired.filter((r) => r.id !== dollars.id);
    const realAfterDelete = mutantAfterDelete.map((r) =>
      r.transfer_pair_id === dollars.id ? { ...r, transfer_pair_id: null } : r
    );

    assert.equal(needsOtherSide(realAfterDelete).length, 17, 'the survivor must be asked again');
    detects(() => assert.equal(needsOtherSide(mutantAfterDelete).length, 17));
  });

  test('cascading the delete instead of nulling is caught', () => {
    // The other tempting answer, and worse. Deleting the record that money
    // ARRIVED because someone deleted the record that money LEFT removes a row
    // nobody pointed at and restates the month it was in.
    const mutantAfterCascade = paired.filter(
      (r) => r.id !== dollars.id && r.id !== som.id
    );
    detects(() =>
      assert.ok(
        mutantAfterCascade.some((r) => r.id === som.id),
        'the surviving leg must survive'
      )
    );
  });

  test('a silent delete — no warning at all — is caught', () => {
    const mutantPlan = { counterpart: null, observedRateMinor: null, warning: '' };
    detects(() => assert.notEqual(mutantPlan.warning, ''));
    assert.notEqual(planPairDeletion(dollars, paired).warning, '');
  });

  test('a warning that omits the rate it is about to destroy is caught', () => {
    // The rate was never stored — it is the two amounts seen together, which
    // is exactly why pairing beats a rate field — and an observation made of
    // two amounts cannot outlive one of them. Saying so is the whole point.
    const mutantWarning = 'This row is part of a pair.';
    detects(() => assert.match(mutantWarning, /12,125/));
    assert.match(planPairDeletion(dollars, paired).warning, /12,125/);
  });

  test('warning on every delete is caught — a warning nobody reads is none', () => {
    const mutantAlwaysWarns = () => 'This row is part of a pair.';
    detects(() => assert.equal(mutantAlwaysWarns(), planPairDeletion(som, PAIRABLE_ROWS).warning));
  });
});
