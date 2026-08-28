/**
 * Aggregate transaction rows into month totals and category breakdowns.
 *
 * Pure, so it can be checked against the real corpus without a browser or a
 * session. The hook does the fetching and calls this.
 */

import { monthKey, monthLabel } from './format.ts';
import {
  reimbursementsByTarget,
  effectiveMinor,
  type LinkableRow,
} from './links.ts';

/** Categories that make up the everyday floor, as opposed to one-off purchases. */
export const CORE_SLUGS = ['groceries', 'transport', 'eating-out'] as const;

export interface JoinedCategory {
  slug: string;
  name: string;
  icon: string;
  color: string;
  kind: 'expense' | 'income' | 'transfer';
}

export interface TransactionRow extends LinkableRow {
  id: string;
  amount_minor: number;
  direction: 'expense' | 'income';
  occurred_at: string;
  date_precision: 'day' | 'month';
  needs_review: boolean;
  reimburses_transaction_id: string | null;
  finance_categories: JoinedCategory | null;
}

export interface MonthTotals {
  key: string;
  label: string;
  spendMinor: number;
  incomeMinor: number;
  transferInMinor: number;
  transferOutMinor: number;
  txnCount: number;
  /** Spend in the everyday categories only — the controllable floor. */
  coreMinor: number;
}

export interface CategoryComparison {
  slug: string;
  name: string;
  icon: string;
  color: string;
  earlierMinor: number;
  laterMinor: number;
  totalMinor: number;
  deltaMinor: number;
  inBoth: boolean;
}

/** One category's spend inside a single month. */
export interface CategorySlice {
  slug: string;
  name: string;
  icon: string;
  color: string;
  minor: number;
  /** Share of that month's spend, 0–1. Zero when the month spent nothing. */
  share: number;
}

export interface FinanceSummary {
  /** The months being compared, oldest first. Up to two. */
  months: MonthTotals[];
  inBoth: CategoryComparison[];
  oneMonthOnly: CategoryComparison[];
  needsReviewCount: number;
  monthPrecisionCount: number;
  totalRows: number;
}

export const UNCATEGORISED: JoinedCategory = {
  slug: 'uncategorised',
  name: 'Uncategorised',
  icon: '?',
  color: '#6B7280',
  kind: 'expense',
};

export const EMPTY_SUMMARY: FinanceSummary = {
  months: [],
  inBoth: [],
  oneMonthOnly: [],
  needsReviewCount: 0,
  monthPrecisionCount: 0,
  totalRows: 0,
};

/** The minimum a row needs to expose to be classified and bucketed. */
export interface ClassifiableRow {
  direction: 'expense' | 'income';
  occurred_at: string;
  finance_categories: JoinedCategory | null;
  /**
   * Optional, and optional on purpose: every row that has ever existed here is
   * so'm, and the 153 imported ones do not carry the column at all. See
   * `countsTowardLedger`.
   */
  currency?: 'UZS' | 'USD';
}

/** The currency every figure on /finance is stated in. */
export const LEDGER_CURRENCY = 'UZS';

/**
 * Whether this row belongs in the month totals.
 *
 * Every figure on /finance — spend, income, the everyday floor, the waterfall,
 * the reconciliation — is a so'm figure, and always has been, because until
 * now every row was so'm. Stage 2 introduces the first dollar account, and
 * with it the first way for that assumption to be wrong in a way nobody would
 * notice: $400 added into a som total reads as 400 so'm, which is not a
 * conspicuous number in a month that runs to millions. It would simply make
 * the month a little wrong forever.
 *
 * So a foreign row is left out rather than converted. Converting would put a
 * hand-entered exchange rate underneath the month totals, and those totals are
 * what the reconciliation and both waterfalls are built on — one rate edit
 * would restate history. Positions are where currency is handled honestly:
 * native per account, converted once, at a stated rate. See positions.ts.
 *
 * Left out is not the same as hidden. `foreignRowCount` exists so the page can
 * say how many rows are not in the figures above it.
 *
 * A row with no currency is so'm. That is what the imported corpus is, and
 * defaulting the other way would empty the page.
 */
export function countsTowardLedger(row: ClassifiableRow): boolean {
  return (row.currency ?? LEDGER_CURRENCY) === LEDGER_CURRENCY;
}

/** How many rows the month figures leave out because they are not so'm. */
export function foreignRowCount(rows: ClassifiableRow[]): number {
  return rows.filter((r) => !countsTowardLedger(r)).length;
}

export type RowClass = 'transfer-in' | 'transfer-out' | 'income' | 'spend';

/**
 * What a row counts as. The single answer to that question.
 *
 * The month totals, the transactions list and the category drill-down all ask
 * it, and if any two of them answered differently the drill-down would show a
 * set of rows that does not add up to the figure the user clicked. That is the
 * one failure that costs the page its credibility, so there is one function.
 */
export function classifyRow(row: ClassifiableRow): RowClass {
  const kind = row.finance_categories?.kind ?? 'expense';

  // Transfers are money moving, not money spent. Kept visible so income and
  // spend can be made to meet, but never counted as spending.
  if (kind === 'transfer') return row.direction === 'income' ? 'transfer-in' : 'transfer-out';
  if (kind === 'income' || row.direction === 'income') return 'income';
  return 'spend';
}

/**
 * The slug a row is filed under, including the fallback.
 *
 * A row with no category still appears in the breakdown as "uncategorised" —
 * dropping it would make the bars add up to less than the month total. The
 * drill-down has to use this same fallback or clicking that bar finds nothing.
 */
export function categorySlugOf(row: ClassifiableRow): string {
  return row.finance_categories?.slug ?? UNCATEGORISED.slug;
}

/** Every month that has rows, oldest first. Never hardcoded. */
export function allMonthKeys(rows: ClassifiableRow[]): string[] {
  return [...new Set(rows.map((r) => monthKey(r.occurred_at)))].sort();
}

/** Every month that has rows, oldest first, with its display label. */
export function availableMonthTabs(
  rows: ClassifiableRow[]
): { key: string; label: string; year: string }[] {
  return allMonthKeys(rows).map((key) => ({
    key,
    label: monthLabel(key),
    year: key.slice(0, 4),
  }));
}

function emptyTotals(key: string): MonthTotals {
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

/**
 * Totals for every month with rows, oldest first.
 *
 * This is what the reconciliation walks — it needs the whole run, not the two
 * months the comparison happens to be showing, or a month's opening would be
 * derived from the wrong predecessor.
 */
export function monthTotals(rows: TransactionRow[]): MonthTotals[] {
  const totals = new Map<string, MonthTotals>();
  const reimbursed = reimbursementsByTarget(rows);

  for (const row of rows) {
    // Not so'm, so it belongs to no figure on this page. See countsTowardLedger.
    if (!countsTowardLedger(row)) continue;

    const key = monthKey(row.occurred_at);
    let month = totals.get(key);
    if (!month) {
      month = emptyTotals(key);
      totals.set(key, month);
    }

    // Counted whatever it contributes. A repayment is still an entry that was
    // captured, and hiding it from the count would make the list and the
    // header disagree about how many rows the month has.
    month.txnCount++;

    // Netted, not raw. A repaid expense contributes its remainder and the
    // repayment contributes nothing — equal and opposite, so the month's net
    // change is the same either way and the closing balance does not move.
    const minor = effectiveMinor(row, reimbursed);
    if (minor === 0) continue;

    switch (classifyRow(row)) {
      case 'transfer-in':
        month.transferInMinor += minor;
        break;
      case 'transfer-out':
        month.transferOutMinor += minor;
        break;
      case 'income':
        month.incomeMinor += minor;
        break;
      case 'spend':
        month.spendMinor += minor;
        if ((CORE_SLUGS as readonly string[]).includes(categorySlugOf(row)))
          month.coreMinor += minor;
        break;
    }
  }

  return [...totals.values()].sort((a, b) => a.key.localeCompare(b.key));
}

/**
 * One month's spending, per category, largest first.
 *
 * This is what the single-month view draws, and what the waterfall's outgoing
 * steps come from. Spend only — transfers and income have their own steps.
 */
export function categoryBreakdown(
  rows: TransactionRow[],
  key: string
): CategorySlice[] {
  const totals = new Map<string, number>();
  const meta = new Map<string, JoinedCategory>();
  const reimbursed = reimbursementsByTarget(rows);

  for (const row of rows) {
    if (monthKey(row.occurred_at) !== key) continue;
    if (!countsTowardLedger(row)) continue;
    if (classifyRow(row) !== 'spend') continue;

    // Net of anything that came back against it. This is the figure the
    // drill-down has to reproduce.
    const minor = effectiveMinor(row, reimbursed);
    if (minor === 0) continue;

    const category = row.finance_categories ?? UNCATEGORISED;
    meta.set(category.slug, category);
    totals.set(category.slug, (totals.get(category.slug) ?? 0) + minor);
  }

  const monthSpend = [...totals.values()].reduce((n, v) => n + v, 0);

  return [...totals.entries()]
    .map(([slug, minor]) => {
      const category = meta.get(slug) ?? UNCATEGORISED;
      return {
        slug,
        name: category.name,
        icon: category.icon,
        color: category.color,
        minor,
        share: monthSpend > 0 ? minor / monthSpend : 0,
      };
    })
    .sort((a, b) => b.minor - a.minor);
}

/**
 * Compare the given months — one or two keys, oldest first.
 *
 * Passing one key produces a summary with a single month and no comparison
 * rows; the single-month view uses `categoryBreakdown` instead.
 */
export function summarizeMonths(
  rows: TransactionRow[],
  keys: string[]
): FinanceSummary {
  if (rows.length === 0 || keys.length === 0) return EMPTY_SUMMARY;

  const wanted = new Set(keys);
  const perCategory = new Map<string, Map<string, number>>();
  const categoryMeta = new Map<string, JoinedCategory>();
  const reimbursed = reimbursementsByTarget(rows);

  for (const row of rows) {
    const key = monthKey(row.occurred_at);
    if (!wanted.has(key)) continue;
    if (!countsTowardLedger(row)) continue;
    if (classifyRow(row) !== 'spend') continue;

    const minor = effectiveMinor(row, reimbursed);
    if (minor === 0) continue;

    const category = row.finance_categories ?? UNCATEGORISED;
    categoryMeta.set(category.slug, category);

    if (!perCategory.has(category.slug)) perCategory.set(category.slug, new Map());
    const byMonth = perCategory.get(category.slug)!;
    byMonth.set(key, (byMonth.get(key) ?? 0) + minor);
  }

  const earlierKey = keys[0];
  const laterKey = keys.length > 1 ? keys[1] : null;

  const comparisons: CategoryComparison[] = [...perCategory.entries()]
    .map(([slug, byMonth]) => {
      const meta = categoryMeta.get(slug) ?? UNCATEGORISED;
      const earlierMinor = byMonth.get(earlierKey) ?? 0;
      const laterMinor = laterKey ? byMonth.get(laterKey) ?? 0 : 0;
      return {
        slug,
        name: meta.name,
        icon: meta.icon,
        color: meta.color,
        earlierMinor,
        laterMinor,
        totalMinor: earlierMinor + laterMinor,
        deltaMinor: laterMinor - earlierMinor,
        inBoth: earlierMinor > 0 && laterMinor > 0,
      };
    })
    .sort((a, b) => b.totalMinor - a.totalMinor);

  const byKey = new Map(monthTotals(rows).map((m) => [m.key, m]));

  return {
    months: keys.map((k) => byKey.get(k) ?? emptyTotals(k)),
    // Split rather than one combined-total list. Sorting everything together
    // puts a single one-off purchase at the top, which is the opposite of what
    // "what am I spending most on" is asking.
    inBoth: comparisons.filter((c) => c.inBoth),
    oneMonthOnly: comparisons.filter((c) => !c.inBoth),
    needsReviewCount: rows.filter((r) => r.needs_review).length,
    monthPrecisionCount: rows.filter((r) => r.date_precision === 'month').length,
    totalRows: rows.length,
  };
}

/** The two most recent months with rows — the default comparison. */
export function summarize(rows: TransactionRow[]): FinanceSummary {
  if (rows.length === 0) return EMPTY_SUMMARY;
  // Never hardcoded, so this keeps working in September without a code change.
  return summarizeMonths(rows, allMonthKeys(rows).slice(-2));
}
