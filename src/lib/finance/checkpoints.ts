/**
 * The count, and what it proves.
 *
 * This is the inversion the whole household treasury rests on. An expense
 * tracker treats transactions as the truth and the balance as whatever falls
 * out of them; it has to, because it can never see your money. Scott can. He
 * is the single point every som passes through for three people in a household
 * that runs on physical cash, so he can open the drawer and count it.
 *
 * So the ledger is not the authority here. THE COUNT IS. Transactions are a
 * running story about what happened between two counts, and where the story
 * disagrees with the drawer, the drawer wins — and the disagreement is itself
 * the finding, not an error to be smoothed away.
 *
 * ONE CONCEPT, NOT TWO. There is no separate opening balance. The earliest
 * checkpoint for an account IS its opening balance, which collapses
 * reconciliation from a special case into the normal read path:
 *
 *   balance at T = latest checkpoint at-or-before T
 *                  + transactions between that checkpoint and T
 *
 * Pure, like the rest of src/lib/finance. Every judgement about whether the
 * numbers agree is testable without a session.
 */

import { dayKey, atLocalNoon } from './cutover.ts';
import type { AccountSides } from './accounts.ts';

/** The slug every adjustment is filed under. Never a real category. */
export const UNACCOUNTED_SLUG = 'unaccounted';

export interface BalanceCheckpoint {
  id: string;
  account_id: string;
  /** The day it was counted, YYYY-MM-DD. A count is a fact about a day. */
  counted_at: string;
  /** What was actually there. Zero is a real count; so is a negative card. */
  counted_minor: number;
  note: string | null;
  /** The adjustment this count wrote to close its gap, if it had one. */
  adjustment_transaction_id: string | null;
}

/** The minimum a row needs to expose to move an account's position. */
export interface MovementRow extends AccountSides {
  id: string;
  amount_minor: number;
  occurred_at: string;
}

/**
 * What this row does to one account's position, in minor units.
 *
 * READ FROM THE POINTERS, NEVER FROM `direction`. The two agree on every row
 * the app writes, but they are answering different questions: `direction` says
 * whether the household gained or lost, and the pointers say which container
 * the money left and which it entered. A transfer between two of Scott's own
 * accounts has a direction and yet the household is unchanged — only the
 * pointers know that the som left the drawer and arrived in the envelope.
 *
 * RAW AMOUNTS, NOT `effectiveMinor`. Everywhere else in this codebase a repaid
 * expense contributes its remainder and the repayment contributes nothing,
 * because that keeps the month's spending honest. A drawer does not net: the
 * 166,100 physically left and the 113,000 physically came back, in two
 * separate motions, and a count taken between them sees the money gone. Over a
 * window holding both rows the two conventions agree exactly — that is worth a
 * test — but a checkpoint can fall between them, and there the netted figure
 * would be wrong in the one direction that matters.
 */
export function accountDeltaMinor(row: MovementRow, accountId: string): number {
  let delta = 0;
  if (row.from_account_id === accountId) delta -= row.amount_minor;
  if (row.to_account_id === accountId) delta += row.amount_minor;
  return delta;
}

/**
 * The checkpoint a balance for `day` is derived from: the latest one at or
 * before it, or null when the account had not been counted by then.
 *
 * `before` excludes the day itself, which is what re-deriving an existing
 * count needs — it must be measured against its predecessor, not against
 * itself.
 */
export function basisCheckpoint(
  checkpoints: BalanceCheckpoint[],
  accountId: string,
  day: string,
  bound: 'at-or-before' | 'before' = 'at-or-before'
): BalanceCheckpoint | null {
  let best: BalanceCheckpoint | null = null;
  for (const c of checkpoints) {
    if (c.account_id !== accountId) continue;
    const within = bound === 'before' ? c.counted_at < day : c.counted_at <= day;
    if (!within) continue;
    if (!best || c.counted_at > best.counted_at) best = c;
  }
  return best;
}

export interface DerivedBalance {
  accountId: string;
  /** The day this balance is for. */
  day: string;
  /**
   * The balance, or NULL when the account had not been counted by this day.
   *
   * Null is not zero and must never be rendered as it. An account nobody has
   * counted yet holds an unknown amount, and the honest thing for the app to
   * say is that nobody has counted it — the whole premise here is that a
   * position comes from a count. Rolling backwards from the first checkpoint
   * would produce a confident figure out of exactly the pre-count rows the
   * cutover exists to mark as reference rather than truth.
   */
  minor: number | null;
  /** The count it was derived from. Null when there is none. */
  basis: BalanceCheckpoint | null;
  /** Net of the rows since that count. Zero when there is no basis. */
  movedMinor: number;
  /** How many rows moved it. Shown so the figure can be opened up. */
  movementCount: number;
}

/**
 * What the transactions say this account holds on a given day.
 *
 * The window is `(basis.counted_at, day]` — rows strictly AFTER the count's
 * day, up to and including the target day. The exclusion of the count's own
 * day is the load-bearing decision here, and it goes the way it does because
 * the count is the authority.
 *
 * Scott empties the drawer on the 3rd and enters 500,000. Later that evening
 * he types the taxi he took that morning. The 500,000 he counted already had
 * the taxi missing from it — the cash was gone before he opened the drawer.
 * Counting rows from the 3rd would subtract it a second time. So a checkpoint
 * supersedes its entire day, and everything dated that day is treated as
 * already reflected in the number he wrote down.
 *
 * That also makes the adjustment safe: a gap is closed by a row dated on the
 * count's own day, so it explains the ledger without ever being added back on
 * top of the count.
 */
export function balanceAt(
  accountId: string,
  checkpoints: BalanceCheckpoint[],
  rows: MovementRow[],
  day: string
): DerivedBalance {
  const basis = basisCheckpoint(checkpoints, accountId, day);
  if (!basis)
    return { accountId, day, minor: null, basis: null, movedMinor: 0, movementCount: 0 };

  let movedMinor = 0;
  let movementCount = 0;
  for (const row of rows) {
    const delta = accountDeltaMinor(row, accountId);
    if (delta === 0) continue;
    const rowDay = dayKey(row.occurred_at);
    if (rowDay <= basis.counted_at || rowDay > day) continue;
    movedMinor += delta;
    movementCount++;
  }

  return {
    accountId,
    day,
    minor: basis.counted_minor + movedMinor,
    basis,
    movedMinor,
    movementCount,
  };
}

/**
 * What a gap means. The sign is the whole message, so it is named rather than
 * left to a caller to work out from a minus.
 */
export type GapKind =
  /** The first count of this account. There is nothing to disagree with. */
  | 'opening'
  /**
   * A count taken ON the cutover date. Ground zero, not a reconciliation.
   *
   * Distinct from 'opening' because the account may well have a prior
   * checkpoint — Main carries one, migrated from the opening balance 009 moved
   * across — and yet the cutover count is still the first figure anybody is
   * entitled to hold the ledger to. See `reconcileCount`.
   */
  | 'cutover'
  /** Counted matches derived. The story and the drawer agree. */
  | 'matched'
  /** gap < 0 — money left that was never logged. Expenses understated. */
  | 'money-missing'
  /** gap > 0 — money arrived unlogged, or a logged expense was overstated. */
  | 'money-appeared';

export interface CountResult {
  accountId: string;
  countedAt: string;
  countedMinor: number;
  /** What the transactions said it should be. Null on the first count. */
  derivedMinor: number | null;
  /**
   * counted − derived. Null on the first count.
   *
   * THE DIRECTION, stated once so nothing downstream has to re-derive it:
   *
   *   gap < 0  the drawer holds LESS than the ledger claims. Money left that
   *            was never logged — the common case, cash spent and not typed.
   *            Spending is understated, so the derived balance reads too HIGH.
   *
   *   gap > 0  the drawer holds MORE than the ledger claims. Money arrived
   *            that was never logged, or a logged expense was overstated.
   */
  gapMinor: number | null;
  kind: GapKind;
  /** The count this was measured against. Null on the first count. */
  basis: BalanceCheckpoint | null;
}

/**
 * Compare a physical count against what the ledger derived for that day.
 *
 * Existing checkpoints ON the counted day are ignored — a recount replaces the
 * count for that day, and measuring a figure against itself would report every
 * correction as a perfect match.
 *
 * TWO COUNTS ESTABLISH GROUND ZERO RATHER THAN RECONCILE, and both must come
 * out with no gap and therefore no adjustment:
 *
 *   - THE FIRST COUNT OF AN ACCOUNT. There is nothing to disagree with. A
 *     fresh account for mom or for his sister derives nothing at all, and a
 *     gap measured against nothing would book the entire counted amount as
 *     income that never arrived.
 *
 *   - ANY COUNT ON THE CUTOVER DATE, prior checkpoint or not. This is the case
 *     the first rule does not cover and the one that would have done the
 *     damage. Main already holds a checkpoint — the 1 July opening migration
 *     009 carried across — so its cutover count HAS a basis, and that basis is
 *     a figure derived from two months of reconstructed notes. Reconciling
 *     against it would file the whole difference between the reconstruction
 *     and the drawer as `unaccounted` spend dated on the cutover, and every
 *     downstream figure — the everyday floor, both waterfalls, the month
 *     totals — would carry millions of som of fiction into September.
 *
 *     The cutover screen states the rule in its own copy: everything before
 *     the line is reference, "never expected to reconcile against a drawer".
 *     A cutover count that wrote an adjustment would be the app disagreeing
 *     with its own promise, in the ledger, permanently.
 *
 * Every count AFTER the cutover reconciles normally against its predecessor,
 * which is the entire point of the feature and is untouched here.
 */
export function reconcileCount(
  accountId: string,
  checkpoints: BalanceCheckpoint[],
  rows: MovementRow[],
  countedAt: string,
  countedMinor: number,
  cutoverDate: string | null = null
): CountResult {
  // Asked BEFORE the basis lookup, deliberately. The whole hazard is an
  // account that does have a basis and must not be measured against it.
  // Falsy, not `!== null`, matching `isPreCutover`: an empty string is unset,
  // not the year zero.
  if (cutoverDate && countedAt === cutoverDate)
    return {
      accountId,
      countedAt,
      countedMinor,
      derivedMinor: null,
      gapMinor: null,
      kind: 'cutover',
      basis: null,
    };

  const basis = basisCheckpoint(checkpoints, accountId, countedAt, 'before');

  if (!basis)
    return {
      accountId,
      countedAt,
      countedMinor,
      derivedMinor: null,
      gapMinor: null,
      kind: 'opening',
      basis: null,
    };

  // Same window rule as balanceAt, measured from the previous count. Passing
  // only the earlier checkpoints keeps the two paths identical rather than
  // similar.
  const earlier = checkpoints.filter((c) => c.counted_at < countedAt);
  const derived = balanceAt(accountId, earlier, rows, countedAt);
  const derivedMinor = derived.minor as number;
  const gapMinor = countedMinor - derivedMinor;

  return {
    accountId,
    countedAt,
    countedMinor,
    derivedMinor,
    gapMinor,
    kind:
      gapMinor === 0 ? 'matched' : gapMinor < 0 ? 'money-missing' : 'money-appeared',
    basis,
  };
}

/** One sentence stating what the gap is, in the direction it actually points. */
export function explainGap(result: CountResult): string {
  switch (result.kind) {
    case 'opening':
      return 'First count of this account. This is where it starts.';
    case 'cutover':
      return 'The cutover count. This is where the ledger starts being held to the drawer — nothing before it is reconciled.';
    case 'matched':
      return 'The count matches the ledger exactly.';
    case 'money-missing':
      return 'Less here than the ledger claims — money left that was never logged.';
    case 'money-appeared':
      return 'More here than the ledger claims — money arrived that was never logged, or an expense was overstated.';
  }
}

/**
 * The transaction a count writes to close its gap.
 *
 * Null when there is nothing to close: a first count has nothing to disagree
 * with, a cutover count is establishing ground zero rather than reconciling a
 * period, and a matched count has a gap of zero, which could not be written
 * anyway — `transactions.amount_minor` carries CHECK (> 0), and a zero-som row
 * saying nothing happened would be noise in a list whose value is that every
 * line means something.
 *
 * VISIBLE, AND NEVER MERGED INTO A REAL CATEGORY. It is filed under
 * 'unaccounted' because a recurring gap of the same sign is information — it
 * says Scott is systematically not logging one kind of spend — and folding it
 * into Groceries or Other would destroy exactly that signal while making a
 * real category's total wrong.
 *
 * Dated on the count's own day, which is what keeps it from being counted
 * twice: `balanceAt` treats a checkpoint as superseding its whole day, so the
 * adjustment explains the ledger without ever being added back on top of the
 * figure that produced it.
 */
export interface AdjustmentDraft extends AccountSides {
  amount_minor: number;
  direction: 'expense' | 'income';
  occurred_at: string;
  date_precision: 'day';
  comment: string;
  raw_input: string;
  category_slug: typeof UNACCOUNTED_SLUG;
}

export function adjustmentDraft(result: CountResult): AdjustmentDraft | null {
  const gap = result.gapMinor;
  if (gap === null || gap === 0) return null;

  const missing = gap < 0;
  return {
    amount_minor: Math.abs(gap),
    direction: missing ? 'expense' : 'income',
    from_account_id: missing ? result.accountId : null,
    to_account_id: missing ? null : result.accountId,
    occurred_at: atLocalNoon(result.countedAt),
    date_precision: 'day',
    comment: missing ? 'Unaccounted — spent and not logged' : 'Unaccounted — arrived and not logged',
    raw_input: `count ${result.countedAt}: ${result.countedMinor / 100} counted, ${
      (result.derivedMinor ?? 0) / 100
    } derived`,
    category_slug: UNACCOUNTED_SLUG,
  };
}

/**
 * Every count on one account, oldest first, each with the gap it found.
 *
 * This is the adjustment history the page shows per account, and it is worth
 * showing for one reason: a single gap is noise, a column of gaps all pointing
 * the same way is a habit. See `gapPattern`.
 */
export function checkpointLedger(
  accountId: string,
  checkpoints: BalanceCheckpoint[],
  rows: MovementRow[],
  cutoverDate: string | null = null
): CountResult[] {
  return checkpoints
    .filter((c) => c.account_id === accountId)
    .sort((a, b) => a.counted_at.localeCompare(b.counted_at))
    .map((c) =>
      reconcileCount(
        accountId,
        checkpoints,
        rows,
        c.counted_at,
        c.counted_minor,
        // The same date the count was judged by when it was taken. Without it
        // the history would re-derive the cutover count as a nine-million-som
        // gap that no adjustment ever closed, and `gapPattern` would read that
        // invented figure as evidence of a habit.
        cutoverDate
      )
    );
}

export interface GapPattern {
  /** Counts that actually found a gap. Openings and matches are not evidence. */
  gapCount: number;
  /** Sum of those gaps, signed. Negative means money keeps going missing. */
  netMinor: number;
  /** Mean gap per count that had one. Signed, same convention. */
  averageMinor: number;
  /** True when every gap points the same way — the case worth naming. */
  consistent: boolean;
  kind: 'money-missing' | 'money-appeared' | 'mixed' | 'none';
}

/**
 * Whether the gaps are a leak or just noise.
 *
 * Two counts short by 30,000 and 40,000 is not two mistakes, it is a habit of
 * not logging about 35,000 of cash spending between counts. One short and one
 * over is measurement noise and should not be dressed up as a finding. The
 * threshold for calling it is unanimity, which is deliberately strict: this is
 * the sentence that makes Scott change what he types, and it has to be earned.
 */
export function gapPattern(ledger: CountResult[]): GapPattern {
  const gaps = ledger
    .filter((r) => r.kind === 'money-missing' || r.kind === 'money-appeared')
    .map((r) => r.gapMinor as number);

  if (gaps.length === 0)
    return { gapCount: 0, netMinor: 0, averageMinor: 0, consistent: false, kind: 'none' };

  const netMinor = gaps.reduce((n, g) => n + g, 0);
  const allNegative = gaps.every((g) => g < 0);
  const allPositive = gaps.every((g) => g > 0);
  const consistent = allNegative || allPositive;

  return {
    gapCount: gaps.length,
    netMinor,
    // Rounded, because a mean of minor units is not itself a real amount and
    // a fraction of a tiyin rendered on screen would be an invented precision.
    averageMinor: Math.round(netMinor / gaps.length),
    consistent,
    kind: allNegative ? 'money-missing' : allPositive ? 'money-appeared' : 'mixed',
  };
}

/**
 * The line this count is judged against, and whether the count is drawing it.
 *
 * A MAN COUNTING EVERY DRAWER HE OWNS IS DRAWING A LINE. That is the whole
 * rule. There are two ways to reach a count — the wizard at /finance/cutover,
 * which sets the date at step 0, and the `count` button on PositionsCard,
 * which does not — and only one of them ever established the cutover. So a
 * count taken with no line set draws it, at its own day.
 *
 * WHY THIS RATHER THAN A REFUSAL. Requiring Scott to find a wizard before the
 * app will accept a physical count is ceremony charged for the app's own
 * bookkeeping. And the alternative is worse than ceremony: with no line set,
 * the old code reconciled a first count against a MIGRATED OPENING BALANCE —
 * a figure derived from two months of notes reconstructed after the fact — and
 * filed the difference as spending that never happened. Thirteen counts, one
 * evening, 3,488,123.87 so'm of fiction, on the night the ledger was supposed
 * to become trustworthy.
 *
 * IT IS ANNOUNCED, NEVER INFERRED SILENTLY. `establishes` exists so the screen
 * can say what is about to happen before it happens — CountDialog renders it,
 * and the write path persists the date rather than leaving it to be re-derived.
 * A setting whose absence quietly changes behaviour is the defect being fixed
 * here; replacing it with a different silent behaviour would fix nothing.
 *
 * Once persisted the rule stops applying: every later count sees a date, and
 * only one taken ON it is ground zero. Two counts on the same evening both
 * reach this with no date set and both name the same day, so the order they
 * are saved in cannot change the answer.
 */
export function cutoverLineFor(
  countedAt: string,
  cutoverDate: string | null
): { cutoverDate: string; establishes: boolean } {
  // Falsy, not `!== null`, matching `isPreCutover`: an empty string is unset,
  // not the year zero.
  if (cutoverDate) return { cutoverDate, establishes: false };
  return { cutoverDate: countedAt, establishes: true };
}

/**
 * Everything a recorded count decides, before anything is written.
 *
 * THE SPLIT EXISTS BECAUSE OF WHAT WENT WRONG. `reconcileCount` was tested to
 * death — including the case that says, in as many words, that a cutover count
 * taken without the date books millions of fiction — and the fiction was
 * booked anyway, thirteen times, because the DATE WAS NEVER SET. The suite
 * could not see it: every assertion passed the date in by hand, and the one
 * thing that actually varied in production was the one thing no test supplied.
 *
 * So the decision the write path makes now lives here, whole, with the two
 * pieces that used to sit inside a React hook and could not be run without a
 * browser: which rows the gap is measured against, and which adjustment the
 * count replaces. `useAccounts.recordCount` is now I/O around this and nothing
 * else, which is what lets a test take the path the button takes.
 */
export interface CountPlan {
  /**
   * The date to write to `finance_settings.cutover_date`, when this count is
   * the one drawing the line. Null when a line was already set.
   *
   * The caller MUST persist it. Left unwritten, the next count would find no
   * line again and draw a second one at its own day, and the first count's
   * suppression would look like a bug rather than a decision.
   */
  establishesLine: string | null;
  /**
   * The adjustment written by the count this one supersedes, if there was one.
   *
   * Re-counting a day that has already been counted supersedes it, and that
   * has to include the adjustment the first count wrote. Left in, that row is
   * part of the movements the new gap is measured against, so the second count
   * writes a small correction on top of the first — arithmetically right, and
   * a ledger with two Unaccounted rows for one drawer on one afternoon, one of
   * which describes a count that no longer exists. One count, one adjustment.
   */
  supersededAdjustmentId: string | null;
  /** The rows the gap is measured against, with that superseded row removed. */
  movements: MovementRow[];
  result: CountResult;
  /** The adjustment to write. Null when there is nothing to close. */
  draft: AdjustmentDraft | null;
}

export function planCount(input: {
  accountId: string;
  countedAt: string;
  countedMinor: number;
  checkpoints: BalanceCheckpoint[];
  movements: MovementRow[];
  /**
   * The line. NOT optional and with no default, deliberately: a default of
   * null here is exactly the shape of the bug — a caller that forgets it gets
   * silently told there is no cutover, and a count on the line reconciles
   * against two months of reconstructed notes. Making it required means
   * forgetting is a type error rather than a ledger entry.
   */
  cutoverDate: string | null;
}): CountPlan {
  const line = cutoverLineFor(input.countedAt, input.cutoverDate);

  const supersededAdjustmentId =
    input.checkpoints.find(
      (c) => c.account_id === input.accountId && c.counted_at === input.countedAt
    )?.adjustment_transaction_id ?? null;

  const movements = supersededAdjustmentId
    ? input.movements.filter((m) => m.id !== supersededAdjustmentId)
    : input.movements;

  const result = reconcileCount(
    input.accountId,
    input.checkpoints,
    movements,
    input.countedAt,
    input.countedMinor,
    line.cutoverDate
  );

  return {
    establishesLine: line.establishes ? line.cutoverDate : null,
    supersededAdjustmentId,
    movements,
    result,
    draft: adjustmentDraft(result),
  };
}
