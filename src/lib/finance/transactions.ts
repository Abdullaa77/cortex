/**
 * Filtering, grouping and date presentation for the transactions list.
 *
 * Pure, same as the rest of src/lib/finance — the React path can't be checked
 * without a session, so the logic stays outside it.
 */

import { monthKey, monthLabel } from './format.ts';
import { classifyRow, categorySlugOf, type JoinedCategory } from './summarize.ts';
import {
  reimbursementsByTarget,
  effectiveMinor,
  isReimbursement,
} from './links.ts';

export interface TransactionRecord {
  id: string;
  amount_minor: number;
  currency: 'UZS' | 'USD';
  direction: 'expense' | 'income';
  comment: string;
  raw_input: string;
  category_id: string | null;
  category_source: 'inferred' | 'confirmed' | 'manual';
  needs_review: boolean;
  parse_flags: string[];
  occurred_at: string;
  date_precision: 'day' | 'month';
  /** Set on an incoming row, pointing at the expense it repays. */
  reimburses_transaction_id: string | null;
  finance_categories: JoinedCategory | null;
}

export interface TransactionFilters {
  month: string | null;
  categorySlug: string | null;
  flaggedOnly: boolean;
  uncategorisedOnly: boolean;
}

export const NO_FILTERS: TransactionFilters = {
  month: null,
  categorySlug: null,
  flaggedOnly: false,
  uncategorisedOnly: false,
};

export interface MonthGroup {
  key: string;
  label: string;
  rows: TransactionRecord[];
  /** Spending only — transfers and income are excluded, as everywhere else. */
  spendMinor: number;
}

/**
 * True when this row counts as money spent, rather than moved or earned.
 *
 * Delegates rather than deciding again — see `classifyRow`. The list's totals
 * and the /finance figures have to agree row for row.
 */
export function isSpendRow(row: TransactionRecord): boolean {
  return classifyRow(row) === 'spend';
}

/** True when this row is a repayment attached to an expense in the set. */
export function isLinkedRepayment(
  row: TransactionRecord,
  rows: TransactionRecord[]
): boolean {
  return isReimbursement(row, reimbursementsByTarget(rows));
}

/**
 * The rows behind one category's figure for one month.
 *
 * This is the drill-down, and its whole value is that it adds up. It filters
 * on exactly what `categoryBreakdown` aggregated on — same month bucket, same
 * spend classification, same uncategorised fallback — so the modal's total and
 * the number that was clicked are the same arithmetic run twice. A test pins
 * that; if it ever drifts the page stops being worth trusting.
 *
 * Newest first, matching the list.
 */
export function drilldownRows(
  rows: TransactionRecord[],
  key: string,
  slug: string
): TransactionRecord[] {
  const spend = rows.filter(
    (row) =>
      monthKey(row.occurred_at) === key &&
      classifyRow(row) === 'spend' &&
      categorySlugOf(row) === slug
  );

  // The repayments attached to those expenses come too. The figure above is
  // net of them, so a list without them would be a list that does not add up —
  // and the repayment is the explanation for why the number is what it is.
  const ids = new Set(spend.map((r) => r.id));
  const repayments = rows.filter(
    (row) => row.reimburses_transaction_id && ids.has(row.reimburses_transaction_id)
  );

  return [...spend, ...repayments].sort((a, b) =>
    b.occurred_at.localeCompare(a.occurred_at)
  );
}

/**
 * Sum of a set of rows, net of links, in minor units.
 *
 * A repaid expense counts its remainder and the repayment counts nothing, so
 * passing an expense and its repayment together yields what the expense
 * actually cost. That is the same arithmetic `categoryBreakdown` runs, which
 * is why the drill-down total and the figure that opened it agree.
 *
 * Links are resolved against the rows given. Pass a whole set, not a slice, or
 * a repayment whose expense was filtered out will read as a standalone row.
 */
export function sumMinor(rows: TransactionRecord[]): number {
  const reimbursed = reimbursementsByTarget(rows);
  return rows.reduce((n, r) => n + effectiveMinor(r, reimbursed), 0);
}

/** The rows repaying this one, newest first. Empty when nothing repays it. */
export function repaymentsFor(
  row: TransactionRecord,
  rows: TransactionRecord[]
): TransactionRecord[] {
  return rows
    .filter((r) => r.reimburses_transaction_id === row.id)
    .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
}

/** The expense this row repays, or null. */
export function repaidTarget(
  row: TransactionRecord,
  rows: TransactionRecord[]
): TransactionRecord | null {
  if (!row.reimburses_transaction_id) return null;
  return rows.find((r) => r.id === row.reimburses_transaction_id) ?? null;
}

export function filterTransactions(
  rows: TransactionRecord[],
  filters: TransactionFilters
): TransactionRecord[] {
  return rows.filter((row) => {
    if (filters.month && monthKey(row.occurred_at) !== filters.month) return false;
    // categorySlugOf, not finance_categories?.slug — otherwise a link that
    // filters to "uncategorised" matches nothing at all.
    if (filters.categorySlug && categorySlugOf(row) !== filters.categorySlug)
      return false;
    if (filters.flaggedOnly && !row.needs_review) return false;
    if (filters.uncategorisedOnly && row.finance_categories !== null) return false;
    return true;
  });
}

/** Newest month first; rows inside a month stay newest first too. */
export function groupByMonth(rows: TransactionRecord[]): MonthGroup[] {
  const reimbursed = reimbursementsByTarget(rows);
  const groups = new Map<string, TransactionRecord[]>();
  for (const row of rows) {
    const key = monthKey(row.occurred_at);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  }

  return [...groups.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([key, groupRows]) => ({
      key,
      label: `${monthLabel(key)} ${key.slice(0, 4)}`,
      rows: [...groupRows].sort((a, b) => b.occurred_at.localeCompare(a.occurred_at)),
      spendMinor: groupRows
        .filter(isSpendRow)
        .reduce((n, r) => n + effectiveMinor(r, reimbursed), 0),
    }));
}

/** Every month present, newest first — drives the month filter. */
export function availableMonths(rows: TransactionRecord[]): { key: string; label: string }[] {
  return [...new Set(rows.map((r) => monthKey(r.occurred_at)))]
    .sort((a, b) => b.localeCompare(a))
    .map((key) => ({ key, label: `${monthLabel(key)} ${key.slice(0, 4)}` }));
}

/** Every category present, for the category filter. */
export function availableCategories(
  rows: TransactionRecord[]
): { slug: string; name: string; color: string }[] {
  const seen = new Map<string, { slug: string; name: string; color: string }>();
  for (const row of rows)
    if (row.finance_categories)
      seen.set(row.finance_categories.slug, {
        slug: row.finance_categories.slug,
        name: row.finance_categories.name,
        color: row.finance_categories.color,
      });
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export interface OccurredDisplay {
  text: string;
  /** True when only the month is real. The day must not be shown. */
  approximate: boolean;
}

/**
 * How to print a row's date.
 *
 * A row imported from the notes knows its month and nothing more. Rendering
 * "1 Aug" for it would invent a day that was never recorded, and would put a
 * month of spending on a single date. Those rows say "Aug 2026" instead.
 */
export function formatOccurred(row: TransactionRecord): OccurredDisplay {
  const date = new Date(row.occurred_at);

  if (row.date_precision === 'month')
    return {
      text: date.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }),
      approximate: true,
    };

  return {
    text: date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
    approximate: false,
  };
}

export interface ListStats {
  shown: number;
  total: number;
  flagged: number;
  uncategorised: number;
  spendMinor: number;
}

export function listStats(
  all: TransactionRecord[],
  shown: TransactionRecord[]
): ListStats {
  // Links are resolved against everything, not just what is on screen — a
  // filter that hides a repayment must not make its expense read as unrepaid.
  const reimbursed = reimbursementsByTarget(all);
  return {
    shown: shown.length,
    total: all.length,
    flagged: all.filter((r) => r.needs_review).length,
    uncategorised: all.filter((r) => r.finance_categories === null).length,
    spendMinor: shown
      .filter(isSpendRow)
      .reduce((n, r) => n + effectiveMinor(r, reimbursed), 0),
  };
}
