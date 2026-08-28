/**
 * Linked transactions — money that came back.
 *
 * -166,100 for lunch and +113,000 when two people paid him back is one event,
 * and the lunch cost 53,100. Without the link the app shows a 166,100 expense
 * and an unrelated transfer in, and neither figure is a lie but the pair reads
 * as 279,100 of activity that never happened.
 *
 * The rules, in one place because everything downstream depends on them:
 *
 *   * The link is a pointer. Both amounts stay exactly as captured. Netting is
 *     a read-path decision, so removing the link restores both rows untouched.
 *   * A repaid expense contributes its net to spending.
 *   * The incoming row it is linked to contributes nothing — its value has
 *     already been counted, as a reduction of the expense.
 *   * Both rows stay visible everywhere. Hiding the repayment would make the
 *     link invisible and the netted figure unexplainable.
 *
 * Those last two together are what keeps the arithmetic whole: the pair
 * removes 113,000 from spending and 113,000 from money-in, so the month's net
 * change is identical before and after linking. Linking never moves the
 * closing balance. That property is worth more than any of the totals, and it
 * is the first thing the tests check.
 */

import { monthKey } from './format.ts';

export interface LinkableRow {
  id: string;
  amount_minor: number;
  direction: 'expense' | 'income';
  occurred_at: string;
  /** Optional for the same reason as on ClassifiableRow — everything is so'm. */
  currency?: 'UZS' | 'USD';
  /** Set on the incoming row, pointing at the expense it repays. */
  reimburses_transaction_id: string | null;
}

/**
 * Total repaid against each expense, keyed by the expense's id.
 *
 * Built once per render and passed down, rather than each caller scanning for
 * its own — with several thousand rows a per-row scan is the difference
 * between one pass and thousands.
 */
export function reimbursementsByTarget(rows: LinkableRow[]): Map<string, number> {
  const totals = new Map<string, number>();
  const ids = new Set(rows.map((r) => r.id));

  for (const row of rows) {
    const target = row.reimburses_transaction_id;
    // A pointer to a row that is not in this set is a dangling link — the
    // expense was deleted, or the page is showing a slice. Counting it would
    // subtract from nothing, so it is ignored and the row stands alone.
    if (!target || !ids.has(target)) continue;
    totals.set(target, (totals.get(target) ?? 0) + row.amount_minor);
  }

  return totals;
}

/** True when this row is a repayment attached to some expense. */
export function isReimbursement(row: LinkableRow, reimbursed: Map<string, number>): boolean {
  const target = row.reimburses_transaction_id;
  if (!target) return false;
  // Consistent with reimbursementsByTarget: a dangling pointer is not a link.
  return reimbursed.has(target);
}

/**
 * What a row actually contributes, once links are applied.
 *
 * An expense that was partly repaid contributes the remainder. A repayment
 * contributes nothing, because it has already been subtracted from the expense
 * it belongs to. Everything else contributes its own amount.
 *
 * Clamped at zero. Over-repayment is refused at link time, so a negative here
 * means data that predates the check or was written by hand — and a negative
 * expense would flow into a category total and make it read as income.
 */
export function effectiveMinor(row: LinkableRow, reimbursed: Map<string, number>): number {
  if (isReimbursement(row, reimbursed)) return 0;
  const back = reimbursed.get(row.id);
  if (!back) return row.amount_minor;
  return Math.max(0, row.amount_minor - back);
}

/** How much came back against this row. Zero when nothing did. */
export function reimbursedMinor(row: LinkableRow, reimbursed: Map<string, number>): number {
  return reimbursed.get(row.id) ?? 0;
}

export interface LinkCheck {
  ok: boolean;
  /** Why not, phrased for the user. Empty when ok. */
  reason: string;
}

const OK: LinkCheck = { ok: true, reason: '' };

/**
 * May this incoming row be attached to this expense?
 *
 * Nothing is ever auto-detected. Scott points at the pair, and this only
 * refuses the combinations that would produce a number the app could not
 * stand behind.
 *
 * The same-month rule is the one worth explaining. Netting moves value from
 * the repayment to the expense; when both sit in one month that is invisible,
 * because the month's totals change by equal and opposite amounts. Across two
 * months it would take 113,000 out of August's money-in and out of July's
 * spending, which raises July's closing balance and lowers August's — and
 * those closing balances are the whole point of the reconciliation. A repaid
 * lunch is not worth breaking them for. Money that genuinely moves between
 * months is what the accounts work is for.
 */
export function canLink(
  source: LinkableRow,
  target: LinkableRow,
  rows: LinkableRow[]
): LinkCheck {
  if (source.id === target.id) return { ok: false, reason: 'A row cannot repay itself.' };

  if (source.direction !== 'income')
    return { ok: false, reason: 'Only money coming in can repay an expense.' };

  if (target.direction !== 'expense')
    return { ok: false, reason: 'Money that came back can only be linked to an expense.' };

  if (target.reimburses_transaction_id)
    return { ok: false, reason: 'That row is itself a repayment.' };

  // Netting subtracts one amount from the other, so the two amounts have to
  // mean the same thing. $10 taken off a 166,100 so'm lunch would read as ten
  // so'm and quietly understate the expense by almost nothing — the worst size
  // of error, too small to notice and permanent.
  if ((source.currency ?? 'UZS') !== (target.currency ?? 'UZS'))
    return {
      ok: false,
      reason: 'Those are different currencies. One cannot be subtracted from the other.',
    };

  if (monthKey(source.occurred_at) !== monthKey(target.occurred_at))
    return {
      ok: false,
      reason:
        'Both rows must be in the same month, or the closing balances stop being true.',
    };

  // Everything already attached to this expense, minus this row if it is
  // being moved from somewhere — re-linking a row must not count it twice.
  const already = rows
    .filter(
      (r) =>
        r.id !== source.id &&
        r.reimburses_transaction_id === target.id
    )
    .reduce((n, r) => n + r.amount_minor, 0);

  if (already + source.amount_minor > target.amount_minor)
    return {
      ok: false,
      reason: 'That is more than the expense. A repayment cannot exceed what was spent.',
    };

  return OK;
}

/**
 * The expenses this row could be linked to, newest first.
 *
 * Only what `canLink` would accept, so the picker cannot offer a choice that
 * is then refused.
 */
export function linkCandidates<T extends LinkableRow>(source: T, rows: T[]): T[] {
  return rows
    .filter((candidate) => canLink(source, candidate, rows).ok)
    .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
}
