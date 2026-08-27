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

import type { MonthTotals } from './summarize.ts';

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
 * Roll the months forward from an opening balance.
 *
 * `months` must be oldest first and must be every month that has rows — a
 * gap would silently hand a month the wrong opening. `summarize` returns them
 * in that order.
 *
 * The opening balance applies to the first month regardless of its as-of date.
 * Pinning it to a matching month would mean an as-of of 3 July quietly
 * excludes the first two days of July, and a person entering "what I had when
 * this starts" does not mean that. The as-of is kept and shown so the claim
 * stays auditable; it is not used to slice.
 */
export function reconcile(
  months: MonthTotals[],
  opening: OpeningBalance | null
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

  let balance = opening ? opening.amountMinor : null;
  const ledgers: MonthLedger[] = [];

  for (const month of months) {
    const netMinor = netChangeMinor(month);
    const openingMinor = balance;
    const closingMinor = openingMinor === null ? null : openingMinor + netMinor;

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
