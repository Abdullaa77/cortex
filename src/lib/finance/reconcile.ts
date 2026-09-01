/**
 * Making the months close.
 *
 * Every month's totals were already right. What was missing was the sentence
 * that ties them together: a month does not start from nothing, it starts from
 * whatever the month before ended with. Without an opening figure, July read
 * as −6,256,049.74 of net change and the page said nothing about how that was
 * possible.
 *
 * The identity, per month:
 *
 *   opening + income − spend + moved_in − moved_out = closing
 *
 * That is arithmetic, so it is always satisfied. The thing worth checking is
 * whether the result is a balance a person could actually have held. A closing
 * below zero is not a rounding problem — it means the ledger is missing rows.
 *
 * Pure, like the rest of src/lib/finance. The React path cannot be checked
 * without a session, so none of the judgement lives there.
 */

import { monthTotalsAfter, type MonthTotals, type TransactionRow } from './summarize.ts';
import { householdAt, type FxRate } from './positions.ts';
import type { AccountRecord } from './accounts.ts';
import type { BalanceCheckpoint, MovementRow } from './checkpoints.ts';
import { dayBefore } from './cutover.ts';
import { monthLabel } from './format.ts';

/**
 * The month a YYYY-MM-DD day belongs to, by slicing rather than by parsing.
 *
 * `format.monthKey` takes an instant and reads it in local time, which is
 * right for a timestamp and wrong for a day that is already written down: west
 * of UTC, `new Date('2026-09-01')` reads back as 31 August. Checkpoint dates
 * and the cutover are DATEs, so the month is in the string.
 */
function monthOfDay(day: string): string {
  return day.slice(0, 7);
}

/**
 * How far below zero a closing balance may land before it is worth saying
 * anything. 50,000 so'm against months that run 3–6 million is under one
 * percent — small enough to be a forgotten taxi, not a missing income.
 *
 * The band exists because an app that complains about 1,200 so'm gets closed
 * and never opened again. Silence about small gaps is what buys attention for
 * the large ones.
 */
export const TOLERANCE_MINOR = 50_000 * 100;

export interface OpeningBalance {
  amountMinor: number;
  /** ISO date, "2026-07-01". The day the amount was held. */
  asOf: string;
}

export interface MonthLedger {
  key: string;
  label: string;
  /** Null when there is no opening balance to derive from. */
  openingMinor: number | null;
  incomeMinor: number;
  spendMinor: number;
  transferInMinor: number;
  transferOutMinor: number;
  /** income − spend + moved_in − moved_out. Always known. */
  netMinor: number;
  /** opening + net. Null when the opening is unknown. */
  closingMinor: number | null;
  /**
   * True when the closing balance is below zero by more than the tolerance —
   * a balance that could not have been held, so the ledger is incomplete.
   */
  impossible: boolean;
  /** How far below zero, or 0. Positive number. */
  shortfallMinor: number;
  /**
   * The day this month's opening is a fact about, when it came from a count
   * rather than from the month before. Null for a month that simply chained.
   *
   * Shown, so the panel can say which months rest on a measurement and which
   * rest on arithmetic. A re-seeded month is where the chain is CUT — nothing
   * before it can move it.
   */
  seededAsOf: string | null;
}

/**
 * A measured figure that opens one month, replacing whatever the month before
 * closed at.
 *
 * THE CUTOVER IS GROUND ZERO FOR THE ROLLFORWARD TOO. Positions already treat
 * it that way — `balanceAt` rests on the latest count and nothing before it
 * gets a second vote. Without the same rule here, the morning after the count
 * the two halves of /finance say different things about the same household:
 * positions read what Scott counted, and the panel underneath goes on chaining
 * out of a July figure derived from notes reconstructed after the fact. That
 * is worse than either being wrong on its own, because the page stops being
 * one claim.
 *
 * `monthTotals` MUST ALREADY EXCLUDE WHAT THE COUNT ABSORBED. A count is the
 * last word for the day it was taken — the same rule `balanceAt` keeps, for
 * the same reason: Scott empties the drawer on the 1st and types that
 * morning's taxi that evening, and the figure he wrote down already had it
 * missing. So the seeded month's totals must cover only rows dated strictly
 * after `asOf`, or the day's spending is subtracted twice. See
 * `monthTotalsAfter`.
 */
export interface MonthSeed {
  /** The month this figure opens. */
  monthKey: string;
  amountMinor: number;
  /** The day the figure is a fact about. */
  asOf: string;
}

export interface Reconciliation {
  months: MonthLedger[];
  /** Echoed back so the view does not need to hold it separately. */
  opening: OpeningBalance | null;
  /**
   * The smallest opening balance that would keep every month's closing at or
   * above zero. This is the figure to state when no opening balance is set —
   * "July would need to start with at least this" — instead of printing a
   * closing balance that cannot be right.
   */
  requiredOpeningMinor: number;
  /** The first month, whose opening is the one that gets entered. */
  firstMonthKey: string | null;
  /** The last month's closing, or null when the opening is unknown. */
  closingMinor: number | null;
  /** Keys of months whose closing is impossible. Empty when everything closes. */
  impossibleKeys: string[];
}

export const EMPTY_RECONCILIATION: Reconciliation = {
  months: [],
  opening: null,
  requiredOpeningMinor: 0,
  firstMonthKey: null,
  closingMinor: null,
  impossibleKeys: [],
};

/** income − spend + moved_in − moved_out. */
export function netChangeMinor(month: MonthTotals): number {
  return (
    month.incomeMinor - month.spendMinor + month.transferInMinor - month.transferOutMinor
  );
}

/**
 * The first month an as-of figure is entitled to open.
 *
 * A count is a fact about the END of its day, so it can open any month that
 * starts after it, and the EARLIEST such month is the one it opens. It cannot
 * open the month it falls inside — half that month happened before it was
 * taken — and it cannot open a month that had already closed.
 *
 * This is the rule that used to be missing, and its absence was stated in the
 * old comment as if it were a decision: "the opening balance applies to the
 * first month regardless of its as-of date". Regardless is the defect. An
 * opening dated 1 July applied to July claims to be the balance before 65 rows
 * that are themselves stamped 1 July, and the month then derives as though
 * none of them happened.
 *
 * Returns null when no month starts after the figure — it is too late to open
 * anything, which is a thing to say rather than a thing to round away.
 */
export function openingMonthKey(months: MonthTotals[], asOf: string): string | null {
  const asOfMonth = monthOfDay(asOf);
  for (const month of months) {
    // Strictly later: a figure from inside a month cannot open that month.
    if (month.key > asOfMonth) return month.key;
  }
  return null;
}

/**
 * Roll the months forward from an opening balance, re-seeding where a count
 * says what the household actually held.
 *
 * `months` must be oldest first and must be every month that has rows — a
 * gap would silently hand a month the wrong opening. `summarize` returns them
 * in that order.
 *
 * Two things can set a month's opening, and both are measurements rather than
 * arithmetic:
 *
 *   - `opening`, which opens the first month that starts after its as-of.
 *     Months before that have NO opening. That is the honest answer and the
 *     page already knows how to say it — `requiredOpeningMinor` states what
 *     the run would have needed — where inventing one would print a closing
 *     balance that cannot be right.
 *
 *   - `seeds`, each naming the month it opens. The cutover count is one of
 *     these. A seed CUTS the chain: everything before it stops being able to
 *     move it, which is the whole point of a ground zero.
 *
 * A seed whose as-of falls after the month it claims to open is refused, not
 * applied — the same rule as the opening, and the one mid-month checkpoints
 * would otherwise break.
 */
export function reconcile(
  months: MonthTotals[],
  opening: OpeningBalance | null,
  seeds: MonthSeed[] = []
): Reconciliation {
  if (months.length === 0) return { ...EMPTY_RECONCILIATION, opening };

  // Walk once from zero to find the deepest point the running balance reaches.
  // Whatever that low point is, the opening has to cover it — so the minimum
  // workable opening is the depth of the deepest trough, never less than zero.
  let running = 0;
  let lowest = 0;
  for (const month of months) {
    running += netChangeMinor(month);
    if (running < lowest) lowest = running;
  }
  const requiredOpeningMinor = Math.max(0, -lowest);

  // Where the opening lands, if anywhere. Not assumed to be months[0].
  const openingKey = opening ? openingMonthKey(months, opening.asOf) : null;

  // A seed may only open a month at or after the one its as-of falls in.
  // Refused rather than shifted: moving it to a month it can legitimately open
  // would be the app choosing a different claim than the one it was handed.
  const seedByMonth = new Map<string, MonthSeed>();
  for (const seed of seeds) {
    if (seed.monthKey < monthOfDay(seed.asOf)) continue;
    const held = seedByMonth.get(seed.monthKey);
    // Latest as-of wins: it rests on the most recent count.
    if (!held || seed.asOf > held.asOf) seedByMonth.set(seed.monthKey, seed);
  }

  let balance: number | null = null;
  const ledgers: MonthLedger[] = [];

  for (const month of months) {
    const seed = seedByMonth.get(month.key);
    if (seed) balance = seed.amountMinor;
    else if (opening && month.key === openingKey) balance = opening.amountMinor;

    const netMinor = netChangeMinor(month);
    const openingMinor: number | null = balance;
    const closingMinor: number | null =
      openingMinor === null ? null : openingMinor + netMinor;

    const shortfallMinor =
      closingMinor !== null && closingMinor < 0 ? -closingMinor : 0;

    ledgers.push({
      key: month.key,
      label: month.label,
      openingMinor,
      incomeMinor: month.incomeMinor,
      spendMinor: month.spendMinor,
      transferInMinor: month.transferInMinor,
      transferOutMinor: month.transferOutMinor,
      netMinor,
      closingMinor,
      impossible: shortfallMinor > TOLERANCE_MINOR,
      shortfallMinor,
      seededAsOf: seed
        ? seed.asOf
        : opening && month.key === openingKey
          ? opening.asOf
          : null,
    });

    balance = closingMinor;
  }

  return {
    months: ledgers,
    opening,
    requiredOpeningMinor,
    firstMonthKey: months[0].key,
    closingMinor: balance,
    impossibleKeys: ledgers.filter((l) => l.impossible).map((l) => l.key),
  };
}

/** Look one month's ledger up by key. */
export function ledgerFor(
  reconciliation: Reconciliation,
  monthKey: string
): MonthLedger | null {
  return reconciliation.months.find((m) => m.key === monthKey) ?? null;
}


/**
 * The whole rollforward, assembled once.
 *
 * THE INVARIANT THIS EXISTS TO KEEP: the last month's closing equals the
 * household position on the same day. Two independent routes to one number —
 * `reconcile` walks month totals through classifyRow's four buckets, and
 * `positionsAt` walks individual rows through the account pointers. A green
 * suite that reads one of them cannot catch a ledger that is consistent and
 * false; the two landing on the same figure can. See two-derivations.test.ts.
 *
 * Assembled HERE rather than in the hook so the test can check the path the
 * page actually renders. A test that reassembles these calls itself would
 * verify a shape nobody uses, and would go on passing after the page stopped
 * using it.
 *
 * Three decisions, all of them the same decision:
 *
 *   - The opening is the household AS OF the day before the ledger starts,
 *     asked for by date. Not the sum of whichever checkpoint happened to be
 *     each account's first.
 *
 *   - The cutover count SEEDS its month. The line is ground zero for the
 *     rollforward exactly as it already is for positions, so nothing before it
 *     can move what comes after.
 *
 *   - The seeded month's totals cover only the rows dated after the count,
 *     because the count already had that day's spending missing from it.
 */
export interface RollforwardInput {
  rows: TransactionRow[];
  /** Every month with rows, oldest first. */
  months: MonthTotals[];
  accounts: AccountRecord[];
  checkpoints: BalanceCheckpoint[];
  movements: MovementRow[];
  rate: FxRate | null;
  cutoverDate: string | null;
}

/** A month with rows still to come. Zeroed, never invented. */
function emptyMonth(key: string): MonthTotals {
  return {
    key,
    label: monthLabel(key),
    spendMinor: 0,
    incomeMinor: 0,
    transferInMinor: 0,
    transferOutMinor: 0,
    txnCount: 0,
    coreMinor: 0,
  };
}

export function rollforward(input: RollforwardInput): Reconciliation {
  const { rows, months, accounts, checkpoints, movements, rate, cutoverDate } = input;
  if (months.length === 0) return { ...EMPTY_RECONCILIATION };

  /**
   * The household on a day, or nothing.
   *
   * REFUSED WHEN IT WOULD BE PARTIAL. `householdAt` reports how many drawers
   * it had to leave out, and for the positions list a partial total plus a
   * sentence naming what is missing is the honest answer. For a figure the
   * whole household's months are then walked on top of, it is not: every row
   * of every account gets applied to it, so an opening covering three drawers
   * out of four is a smaller number wearing the label of the whole, and every
   * month after it inherits the error silently.
   */
  const askHousehold = (day: string) => {
    const snapshot = householdAt(accounts, checkpoints, movements, rate, day);
    return snapshot && snapshot.skippedAccounts === 0 ? snapshot : null;
  };

  // The day before the ledger starts. The opening is a fact about that day and
  // is stamped with it — never with the earliest date some account was counted.
  const openingSnapshot = askHousehold(dayBefore(`${months[0].key}-01`));

  const cutoverSnapshot = cutoverDate ? askHousehold(cutoverDate) : null;
  const seeds: MonthSeed[] = cutoverSnapshot
    ? [
        {
          monthKey: cutoverDate!.slice(0, 7),
          amountMinor: cutoverSnapshot.amountMinor,
          asOf: cutoverDate!,
        },
      ]
    : [];

  // Only the seeded month is cut back, and only for the rollforward. The month
  // tabs and both waterfalls go on showing the cutover month's real spend —
  // the reference rows are still real, they simply do not get a second vote on
  // a figure that already contains them.
  const seed = seeds[0];

  // The month the count opens may have no rows yet — he counts on the 1st and
  // has typed nothing since. Without a row for it the seed would have nothing
  // to land on and the count would silently never reach the panel, which is
  // the failure this whole change exists to remove.
  const withSeedMonth =
    seed && !months.some((m) => m.key === seed.monthKey)
      ? [...months, emptyMonth(seed.monthKey)].sort((a, b) => a.key.localeCompare(b.key))
      : months;

  const walked = seed
    ? withSeedMonth.map((m) =>
        m.key === seed.monthKey
          ? (monthTotalsAfter(rows, seed.asOf).find((r) => r.key === seed.monthKey) ?? {
              ...m,
              spendMinor: 0,
              incomeMinor: 0,
              transferInMinor: 0,
              transferOutMinor: 0,
              coreMinor: 0,
              txnCount: 0,
            })
          : m
      )
    : withSeedMonth;

  return reconcile(
    walked,
    openingSnapshot
      ? { amountMinor: openingSnapshot.amountMinor, asOf: openingSnapshot.asOf }
      : null,
    seeds
  );
}
