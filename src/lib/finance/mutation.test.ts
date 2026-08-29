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
import { ACCOUNT_OWNERS, movementShape, sidesForClass } from './accounts.ts';
import {
  HOUSEHOLD,
  UNRECORDED,
  backfillBeneficiary,
  beneficiaryBreakdown,
  beneficiaryKeyOf,
  beneficiaryOf,
  clearsBeneficiary,
  floorSplit,
  takesBeneficiary,
  type BeneficiaryRow,
} from './beneficiary.ts';
import { CATEGORY_BY_SLUG } from './categorize.ts';
import { dayKey, atLocalNoon, isPreCutover } from './cutover.ts';
import {
  ACCOUNTS,
  CHECKPOINTS,
  MOVEMENTS,
  PAIRABLE_ROWS,
  CORPUS_ROWS,
  CORPUS_RECORDS,
  BENEFICIARY_CORPUS,
  CAPTURE_ROWS,
  CUTOVER_DATE,
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

/** A spend-shaped row filed under `slug`, for the Stage 3 mutants. */
let benSeq = 0;
const row_for = (slug: string): BeneficiaryRow => {
  const c = CATEGORY_BY_SLUG.get(slug);
  return {
    id: `ben-${benSeq++}`,
    reimburses_transaction_id: null,
    amount_minor: 100_00,
    direction: slug === 'income' ? 'income' : 'expense',
    occurred_at: atLocalNoon('2026-08-20'),
    date_precision: 'day',
    needs_review: false,
    beneficiary: null,
    finance_categories: c
      ? { slug: c.slug, name: c.name, icon: c.icon, color: c.color, kind: c.kind }
      : { slug, name: slug, icon: '?', color: '#000', kind: 'expense' },
  };
};

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


/**
 * STAGE 3 — the beneficiary.
 *
 * The new axis is who CONSUMED the money, as against whose money it was. Two
 * different facts, and every mutant below is a way of collapsing them, or of
 * turning "nobody recorded this" into a claim that somebody did.
 *
 * The first of them is the one worth the most. A backfill that writes
 * 'household' across 153 historical rows does not merely add wrong rows — it
 * makes them INDISTINGUISHABLE from the rows where Scott really did choose
 * household, which destroys the meaning of the right ones too. There is no
 * later repair for that, which is why it is pinned before anything else.
 */
describe('the cleared-beneficiary notice is genuinely pinned', () => {
  test('a notice that never fires is caught', () => {
    // Silent is the correct BEHAVIOUR and the wrong amount of explanation. A
    // clearsBeneficiary that always returned null would leave the trigger doing
    // exactly the right thing with nobody told about it.
    const mutant = () => null;
    const spend: BeneficiaryRow = { ...row_for('groceries'), beneficiary: HOUSEHOLD };

    detects(() =>
      assert.equal(mutant(), clearsBeneficiary(spend, row_for('income').finance_categories))
    );
  });

  test('a notice that fires on every recategorisation is caught', () => {
    // The other failure. A warning shown when nothing was taken away is a
    // warning nobody reads by the third time — the same argument the pair
    // deletion warning already makes.
    const spend: BeneficiaryRow = { ...row_for('groceries'), beneficiary: HOUSEHOLD };
    const mutant = () => HOUSEHOLD;

    detects(() =>
      assert.equal(mutant(), clearsBeneficiary(spend, row_for('transport').finance_categories))
    );
  });

  test('reporting a beneficiary the row never had is caught', () => {
    // Announcing that "for household" was cleared on a row that was unrecorded
    // all along tells the user they lost something they never chose.
    const unrecorded = row_for('groceries');
    const mutant = () => HOUSEHOLD;

    detects(() =>
      assert.equal(mutant(), clearsBeneficiary(unrecorded, row_for('income').finance_categories))
    );
  });
});

describe('the honesty of the backfill is genuinely pinned', () => {
  const decide = (r: BeneficiaryRow) =>
    backfillBeneficiary(r, CUTOVER_DATE, isPreCutover(r, CUTOVER_DATE));

  test('backfilling the 153 imported rows as household is caught', () => {
    // THE ONE THAT MATTERS. The mutant is the obvious implementation: give
    // every expense the common answer and move on.
    const mutant = (r: BeneficiaryRow) => (takesBeneficiary(r) ? HOUSEHOLD : null);

    detects(() => {
      for (const r of CORPUS_ROWS as BeneficiaryRow[])
        assert.equal(mutant(r), decide(r), `${r.id} was given a consumer nobody checked`);
    });
  });

  test('backfilling pre-cutover rows as household is caught on its own', () => {
    // Narrower than the above: this mutant respects the cutover for the
    // reconstructed rows but not for a pre-cutover capture, which is the
    // version somebody would actually write while believing they had handled
    // it.
    const mutant = (r: BeneficiaryRow) =>
      takesBeneficiary(r) && r.date_precision === 'day' ? HOUSEHOLD : null;
    const preCutoverCapture = {
      ...CAPTURE_ROWS[0],
      id: 'pre-cutover-capture',
      occurred_at: atLocalNoon('2026-08-14'),
    };

    assert.equal(isPreCutover(preCutoverCapture, CUTOVER_DATE), true);
    detects(() => assert.equal(mutant(preCutoverCapture), decide(preCutoverCapture)));
  });

  test('a backfill that ignores a missing cutover is caught', () => {
    // With no line drawn, isPreCutover is false for everything by design. A
    // backfill that only asks that question would then claim the whole of
    // history — the exact opposite of what the absence of a cutover means.
    const mutant = (r: BeneficiaryRow) =>
      takesBeneficiary(r) && r.date_precision === 'day' && !isPreCutover(r, null)
        ? HOUSEHOLD
        : null;
    const capture = CAPTURE_ROWS[0];

    detects(() =>
      assert.equal(mutant(capture), backfillBeneficiary(capture, null, isPreCutover(capture, null)))
    );
  });

  test('the default reaching income is caught', () => {
    // Income has no beneficiary: money arriving has not been consumed by
    // anyone. A default applied by direction alone would hand every salary a
    // consumer.
    const mutantDefault = () => HOUSEHOLD;
    const salary = row_for('income');

    detects(() => assert.equal(mutantDefault(), decide(salary)));
    detects(() => assert.equal(mutantDefault(), beneficiaryOf({ ...salary, beneficiary: HOUSEHOLD })));
  });

  test('the default reaching a transfer or the adjustment is caught', () => {
    const mutantDefault = () => HOUSEHOLD;
    for (const r of [row_for('transfer'), row_for('unaccounted')])
      detects(() => assert.equal(mutantDefault(), beneficiaryOf({ ...r, beneficiary: HOUSEHOLD })));
  });
});

describe('null-is-not-household is genuinely pinned', () => {
  test('rendering an unrecorded row as household is caught', () => {
    // The read-path version of the backfill defect, and the one that survives
    // a correct backfill: `beneficiaryOf(row) ?? 'household'` anywhere between
    // the query and the screen puts the same falsehood on the page.
    const mutantKey = (r: BeneficiaryRow) => beneficiaryOf(r) ?? HOUSEHOLD;
    const unrecorded = CORPUS_ROWS[0] as BeneficiaryRow;

    detects(() => assert.equal(mutantKey(unrecorded), beneficiaryKeyOf(unrecorded)));
  });

  test('a breakdown that folds the unrecorded group into household is caught', () => {
    const real = beneficiaryBreakdown(BENEFICIARY_CORPUS, '2026-08');
    const household = real.find((g) => g.key === HOUSEHOLD)!;
    const unrecorded = real.find((g) => g.key === UNRECORDED)!;
    assert.ok(unrecorded.minor > 0, 'August must have unrecorded spend for this to mean anything');

    const mutantHousehold = household.minor + unrecorded.minor;
    detects(() => assert.equal(mutantHousehold, household.minor));
  });

  test('dropping the unrecorded rows from the denominator is caught', () => {
    // The subtlest of the three. Every group still exists, every figure is a
    // real sum — only the shares are computed over a smaller whole, so the
    // household reads as a larger fraction of the month than the money
    // supports. Nothing on screen looks wrong.
    const real = beneficiaryBreakdown(BENEFICIARY_CORPUS, '2026-08');
    const recorded = real
      .filter((g) => g.key !== UNRECORDED)
      .reduce((n, g) => n + g.minor, 0);
    const household = real.find((g) => g.key === HOUSEHOLD)!;
    const mutantShare = household.minor / recorded;

    detects(() => assert.equal(mutantShare, household.share));
  });

  test('a breakdown that omits the unrecorded group entirely is caught', () => {
    const real = beneficiaryBreakdown(BENEFICIARY_CORPUS, '2026-08');
    const mutant = real.filter((g) => g.key !== UNRECORDED);
    const month = monthTotals(BENEFICIARY_CORPUS).find((m) => m.key === '2026-08')!;

    detects(() =>
      assert.equal(
        mutant.reduce((n, g) => n + g.minor, 0),
        month.spendMinor
      )
    );
  });

  test('a floor split that loses its unrecorded part is caught', () => {
    const real = floorSplit(BENEFICIARY_CORPUS, '2026-08');
    const mutant = { ...real, unrecordedMinor: 0 };
    detects(() =>
      assert.equal(
        mutant.householdMinor + mutant.personalMinor + mutant.unrecordedMinor,
        real.coreMinor
      )
    );
  });

  test('a floor split that quietly absorbs it into household is caught', () => {
    // Adds up perfectly, which is what makes it dangerous — the arithmetic
    // check alone would pass it.
    const real = floorSplit(BENEFICIARY_CORPUS, '2026-08');
    const mutant = {
      ...real,
      householdMinor: real.householdMinor + real.unrecordedMinor,
      unrecordedMinor: 0,
    };
    assert.equal(
      mutant.householdMinor + mutant.personalMinor + mutant.unrecordedMinor,
      real.coreMinor
    );
    detects(() => assert.equal(mutant.householdMinor, real.householdMinor));
  });
});

describe('funding is not consumption — the collapse is genuinely pinned', () => {
  /** The captures, as the database holds them: funded from Scott's own drawer. */
  const funded = CAPTURE_ROWS.map((r) => ({
    ...r,
    from_account_id: MAIN_ID,
    to_account_id: null,
  }));

  test('reading the paying account\'s owner as the beneficiary is caught', () => {
    // THE COLLAPSE, stated exactly. Scott is the single point every som passes
    // through, so every row is funded from his drawer; a view that read the
    // owner would report the household's groceries as his personal spending
    // and turn the whole page into an accusation.
    const ownerOf = (id: string | null) =>
      ACCOUNTS.find((a) => a.id === id)?.owner ?? null;
    const mutant = (r: (typeof funded)[number]) => ownerOf(r.from_account_id);

    for (const r of funded) {
      assert.equal(mutant(r), 'me', 'every capture is funded from Main, by construction');
      if (beneficiaryOf(r) !== 'me') detects(() => assert.equal(mutant(r), beneficiaryOf(r)));
    }
  });

  test('and the whole-month consequence is caught, not just one row', () => {
    const real = beneficiaryBreakdown(funded, '2026-08');
    const mutantMe = funded.reduce((n, r) => n + r.amount_minor, 0);
    const realMe = real.find((g) => g.key === 'me')!.minor;

    detects(() => assert.equal(mutantMe, realMe));
    // What it would have claimed: everything, under one name.
    assert.ok(real.find((g) => g.key === HOUSEHOLD)!.minor > realMe);
  });

  test('an owner used as a beneficiary value is caught', () => {
    // The other direction of the same collapse: 'household' is a beneficiary
    // and never an owner, so a value list built from ACCOUNT_OWNERS alone
    // would have nowhere to put the common answer.
    const mutantValues = [...ACCOUNT_OWNERS];
    detects(() => assert.ok(mutantValues.includes(HOUSEHOLD as never)));
  });
});

describe('the new axis moving an old figure is genuinely pinned', () => {
  test('beneficiary leaking into a category total is caught', () => {
    // A category total is about WHAT the money was, and must not change when
    // WHO it was for does. The mutant is a breakdown that counts only the rows
    // with a recorded beneficiary — the shape you get from an inner join.
    const key = '2026-08';
    const real = categoryBreakdown(BENEFICIARY_CORPUS, key);
    const mutant = categoryBreakdown(
      BENEFICIARY_CORPUS.filter((r) => beneficiaryOf(r) !== null),
      key
    );

    detects(() =>
      assert.deepEqual(
        mutant.map((s) => [s.slug, s.minor]),
        real.map((s) => [s.slug, s.minor])
      )
    );
  });

  test('beneficiary leaking into the everyday floor is caught', () => {
    const key = '2026-08';
    const real = monthTotals(BENEFICIARY_CORPUS).find((m) => m.key === key)!;
    const mutant = monthTotals(
      BENEFICIARY_CORPUS.filter((r) => beneficiaryOf(r) !== null)
    ).find((m) => m.key === key)!;

    detects(() => assert.equal(mutant.coreMinor, real.coreMinor));
    detects(() => assert.equal(mutant.spendMinor, real.spendMinor));
  });

  test('a second everyday floor is caught', () => {
    // floorSplit derives coreMinor itself rather than being handed it. If its
    // filter ever drifted from CORE_SLUGS there would be two floors on one
    // page disagreeing, and no way to tell which was the one being steered by.
    const key = '2026-08';
    const real = monthTotals(BENEFICIARY_CORPUS).find((m) => m.key === key)!;
    const mutantCore = real.coreMinor + 1;

    detects(() => assert.equal(mutantCore, floorSplit(BENEFICIARY_CORPUS, key).coreMinor));
    assert.equal(floorSplit(BENEFICIARY_CORPUS, key).coreMinor, real.coreMinor);
  });
});
