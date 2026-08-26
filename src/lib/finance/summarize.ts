/**
 * Aggregate transaction rows into the month-beside-month summary.
 *
 * Pure, so it can be checked against the real corpus without a browser or a
 * session. The hook does the fetching and calls this.
 */

import { monthKey, monthLabel } from './format.ts';

/** Categories that make up the everyday floor, as opposed to one-off purchases. */
export const CORE_SLUGS = ['groceries', 'transport', 'eating-out'] as const;

export interface JoinedCategory {
  slug: string;
  name: string;
  icon: string;
  color: string;
  kind: 'expense' | 'income' | 'transfer';
}

export interface TransactionRow {
  amount_minor: number;
  direction: 'expense' | 'income';
  occurred_at: string;
  date_precision: 'day' | 'month';
  needs_review: boolean;
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

export interface FinanceSummary {
  /** Up to two months, oldest first. */
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

export function summarize(rows: TransactionRow[]): FinanceSummary {
  if (rows.length === 0) return EMPTY_SUMMARY;

  // The two most recent months that actually have rows — never hardcoded, so
  // this keeps working in September without a code change.
  const monthKeys = [...new Set(rows.map((r) => monthKey(r.occurred_at)))].sort().slice(-2);

  const totals = new Map<string, MonthTotals>();
  for (const key of monthKeys)
    totals.set(key, {
      key,
      label: monthLabel(key),
      spendMinor: 0,
      incomeMinor: 0,
      transferInMinor: 0,
      transferOutMinor: 0,
      txnCount: 0,
      coreMinor: 0,
    });

  const perCategory = new Map<string, Map<string, number>>();
  const categoryMeta = new Map<string, JoinedCategory>();

  for (const row of rows) {
    const key = monthKey(row.occurred_at);
    const month = totals.get(key);
    if (!month) continue;

    const category = row.finance_categories ?? UNCATEGORISED;
    categoryMeta.set(category.slug, category);
    month.txnCount++;

    // Transfers are money moving, not money spent. Kept visible so income and
    // spend can be made to meet, but never counted as spending.
    if (category.kind === 'transfer') {
      if (row.direction === 'income') month.transferInMinor += row.amount_minor;
      else month.transferOutMinor += row.amount_minor;
      continue;
    }

    if (category.kind === 'income' || row.direction === 'income') {
      month.incomeMinor += row.amount_minor;
      continue;
    }

    month.spendMinor += row.amount_minor;
    if ((CORE_SLUGS as readonly string[]).includes(category.slug))
      month.coreMinor += row.amount_minor;

    if (!perCategory.has(category.slug)) perCategory.set(category.slug, new Map());
    const byMonth = perCategory.get(category.slug)!;
    byMonth.set(key, (byMonth.get(key) ?? 0) + row.amount_minor);
  }

  const earlierKey = monthKeys[0];
  const laterKey = monthKeys.length === 2 ? monthKeys[1] : null;

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

  return {
    months: monthKeys.map((k) => totals.get(k)!),
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
