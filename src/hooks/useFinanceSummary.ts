'use client';

import { useCallback, useMemo } from 'react';
import {
  summarizeMonths,
  monthTotals,
  categoryBreakdown,
  availableMonthTabs,
  allMonthKeys,
} from '@/lib/finance/summarize';
import { reconcile } from '@/lib/finance/reconcile';
import { useTransactions } from './useTransactions';
import { useOpeningBalance } from './useOpeningBalance';

export type {
  MonthTotals,
  CategoryComparison,
  CategorySlice,
  FinanceSummary,
} from '@/lib/finance/summarize';

/**
 * Everything /finance needs, derived from the one row store.
 *
 * This used to fetch its own narrow projection of the transactions — enough
 * columns for the totals and no more. That was fine while the page was
 * read-only, and stopped being fine the moment a figure became clickable: a
 * drill-down that re-queries can come back with a different set of rows than
 * the one the figure was computed from, and then the modal and the number
 * above it quietly disagree.
 *
 * So the rows come from `useTransactions`, whole, once. Aggregation is a pure
 * function of them, the drill-down is a filter over the same array, and edits
 * go through the same optimistic path the list uses — a correction made in the
 * modal moves the bar behind it immediately, because there is only one copy of
 * the data to move.
 */
export function useFinanceSummary() {
  const store = useTransactions();
  const opening = useOpeningBalance();
  const { rows } = store;

  /** Every month with rows, oldest first — this is what drives the tabs. */
  const tabs = useMemo(() => availableMonthTabs(rows), [rows]);
  const keys = useMemo(() => allMonthKeys(rows), [rows]);

  /**
   * Totals for the whole run, not just the months on screen. The
   * reconciliation walks all of them — a month's opening comes from its
   * predecessor's closing, so skipping a month would hand the next one the
   * wrong figure.
   */
  const allMonths = useMemo(() => monthTotals(rows), [rows]);

  const reconciliation = useMemo(
    () => reconcile(allMonths, opening.balance),
    [allMonths, opening.balance]
  );

  /** Comparison figures for a chosen pair of months. */
  const compareOn = useCallback(
    (compareKeys: string[]) => summarizeMonths(rows, compareKeys),
    [rows]
  );

  /** One month's spending, per category, largest first. */
  const breakdownOn = useCallback((key: string) => categoryBreakdown(rows, key), [rows]);

  const flags = useMemo(
    () => ({
      needsReviewCount: rows.filter((r) => r.needs_review).length,
      monthPrecisionCount: rows.filter((r) => r.date_precision === 'month').length,
      totalRows: rows.length,
    }),
    [rows]
  );

  return {
    ...store,
    tabs,
    keys,
    allMonths,
    reconciliation,
    opening,
    flags,
    compareOn,
    breakdownOn,
    loading: store.loading || opening.loading,
  };
}
