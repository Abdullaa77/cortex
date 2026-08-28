'use client';

import { useCallback, useMemo } from 'react';
import {
  summarizeMonths,
  monthTotals,
  categoryBreakdown,
  availableMonthTabs,
  allMonthKeys,
  foreignRowCount,
} from '@/lib/finance/summarize';
import { reconcile } from '@/lib/finance/reconcile';
import { positionsAt, householdTotal, openingFromCheckpoints, today } from '@/lib/finance/positions';
import { checkpointLedger, gapPattern, type MovementRow } from '@/lib/finance/checkpoints';
import { needsOtherSide } from '@/lib/finance/transfers';
import { UNACCOUNTED_SLUG } from '@/lib/finance/checkpoints';
import { beneficiaryBreakdown, floorSplit } from '@/lib/finance/beneficiary';
import { useTransactions } from './useTransactions';
import { useAccounts } from './useAccounts';

export type {
  MonthTotals,
  CategoryComparison,
  CategorySlice,
  FinanceSummary,
} from '@/lib/finance/summarize';

/**
 * Everything /finance needs, derived from the one row store.
 *
 * The rows come from `useTransactions`, whole, once. Aggregation is a pure
 * function of them, the drill-down is a filter over the same array, and edits
 * go through the same optimistic path the list uses — a correction made in the
 * modal moves the bar behind it immediately, because there is only one copy of
 * the data to move.
 *
 * Stage 2 adds the accounts beside them, and with them the second, independent
 * route to the same figures: the months still walk forward from an opening
 * balance, and the positions still walk forward from a physical count, and
 * where the two disagree the count wins. The opening balance is no longer a
 * table of its own — it is the sum of every account's first checkpoint, which
 * is what an opening balance always was.
 */
export function useFinanceSummary() {
  const store = useTransactions();
  const accounts = useAccounts();
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

  /**
   * The household opening, out of the counts.
   *
   * Same arithmetic `reconcile` has always run; one fewer source of truth
   * behind it. Before any account has been counted there is no opening, and
   * the page states what the first month would have needed instead of printing
   * a closing balance that cannot be right — exactly as before.
   */
  const opening = useMemo(
    () => openingFromCheckpoints(accounts.accounts, accounts.checkpoints, accounts.rate),
    [accounts.accounts, accounts.checkpoints, accounts.rate]
  );

  const reconciliation = useMemo(
    () =>
      reconcile(
        allMonths,
        opening ? { amountMinor: opening.amountMinor, asOf: opening.asOf } : null
      ),
    [allMonths, opening]
  );

  /** The rows in the shape the position math reads. Built once. */
  const movements = useMemo<MovementRow[]>(
    () =>
      rows.map((r) => ({
        id: r.id,
        amount_minor: r.amount_minor,
        occurred_at: r.occurred_at,
        from_account_id: r.from_account_id,
        to_account_id: r.to_account_id,
      })),
    [rows]
  );

  const asOfToday = useMemo(() => today(), []);

  const positions = useMemo(
    () => positionsAt(accounts.accounts, accounts.checkpoints, movements, asOfToday),
    [accounts.accounts, accounts.checkpoints, movements, asOfToday]
  );

  const household = useMemo(
    () => householdTotal(positions, accounts.rate),
    [positions, accounts.rate]
  );

  /** Every count on one account, each with the gap it found, and the pattern. */
  const historyFor = useCallback(
    (accountId: string) => {
      const ledger = checkpointLedger(accountId, accounts.checkpoints, movements);
      return { ledger, pattern: gapPattern(ledger) };
    },
    [accounts.checkpoints, movements]
  );

  /** Transfers still waiting on their other end. He knows; the machine does not. */
  const openTransfers = useMemo(
    () => needsOtherSide(rows.map((r) => ({ ...r, transfer_pair_id: r.transfer_pair_id ?? null }))),
    [rows]
  );

  /** Where an adjustment gets filed. Never a real category. */
  const unaccountedCategoryId = useMemo(
    () => store.allCategories.find((c) => c.slug === UNACCOUNTED_SLUG)?.id ?? null,
    [store.allCategories]
  );

  /** Comparison figures for a chosen pair of months. */
  const compareOn = useCallback(
    (compareKeys: string[]) => summarizeMonths(rows, compareKeys),
    [rows]
  );

  /** One month's spending, per category, largest first. */
  const breakdownOn = useCallback((key: string) => categoryBreakdown(rows, key), [rows]);

  /**
   * The same month's spending, grouped by who consumed it rather than by what
   * it was. A new axis over the same money — the groups re-run the arithmetic
   * `breakdownOn` runs and only bucket the result differently, which is why
   * they add up to the same total.
   */
  const beneficiaryOn = useCallback((key: string) => beneficiaryBreakdown(rows, key), [rows]);

  /**
   * The everyday floor, split into what is genuinely shared and what is one
   * person's. The floor barely moved between July and August while total spend
   * swung 74%; knowing which part of it is household and which is personal is
   * what says what can actually be cut, and by whom.
   */
  const floorOn = useCallback((key: string) => floorSplit(rows, key), [rows]);

  const flags = useMemo(
    () => ({
      needsReviewCount: rows.filter((r) => r.needs_review).length,
      monthPrecisionCount: rows.filter((r) => r.date_precision === 'month').length,
      totalRows: rows.length,
      // Rows the month figures leave out because they are not so'm. Stated
      // rather than silently dropped.
      foreignRowCount: foreignRowCount(rows),
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
    accounts,
    movements,
    positions,
    household,
    historyFor,
    openTransfers,
    unaccountedCategoryId,
    asOfToday,
    flags,
    compareOn,
    breakdownOn,
    beneficiaryOn,
    floorOn,
    loading: store.loading || accounts.loading,
  };
}
