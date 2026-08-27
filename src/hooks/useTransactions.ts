'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSupabase } from '@/components/providers/SupabaseProvider';
import { useCategoryAssignment } from './useCategoryAssignment';
import type { TransactionRecord } from '@/lib/finance/transactions';
import type { RowPatch } from '@/lib/finance/edit';
import { canLink } from '@/lib/finance/links';
import { activeCategories, type CategoryRecord } from '@/lib/finance/categories';

export interface CategoryOption {
  id: string;
  slug: string;
  name: string;
  icon: string;
  color: string;
  kind: 'expense' | 'income' | 'transfer';
}

const SELECT =
  'id, amount_minor, currency, direction, comment, raw_input, category_id, ' +
  'category_source, needs_review, parse_flags, occurred_at, date_precision, ' +
  'reimburses_transaction_id, finance_categories(slug, name, icon, color, kind)';

/**
 * The transactions log. Optimistic with rollback, matching the other hooks —
 * an edit or a delete should feel instant, and put the row back if the write
 * fails.
 */
export function useTransactions() {
  const { supabase, session } = useSupabase();
  const { assign } = useCategoryAssignment();
  const userId = session?.user?.id ?? null;

  const [rows, setRows] = useState<TransactionRecord[]>([]);
  // Every category, archived included. Pickers get the active ones; the
  // manager needs to see what has been retired in order to restore it.
  const [allCategories, setAllCategories] = useState<CategoryRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const [txnRes, catRes] = await Promise.all([
        supabase
          .from('transactions')
          .select(SELECT)
          .order('occurred_at', { ascending: false })
          .limit(5000),
        supabase
          .from('finance_categories')
          .select('id, slug, name, icon, color, kind, sort_order, is_archived')
          .order('sort_order'),
      ]);

      if (txnRes.error) throw txnRes.error;
      setRows((txnRes.data ?? []) as unknown as TransactionRecord[]);
      setAllCategories((catRes.data ?? []) as CategoryRecord[]);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load transactions');
    } finally {
      setLoading(false);
    }
  }, [supabase, userId]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const setCategory = useCallback(
    async (transactionId: string, categoryId: string) => {
      // Searched across everything, not just the active list — a row already
      // filed under an archived category must still be re-assignable to it.
      const category = allCategories.find((c) => c.id === categoryId);
      const target = rows.find((r) => r.id === transactionId);
      if (!category || !target) return;

      const prev = rows;
      setRows((curr) =>
        curr.map((r) =>
          r.id === transactionId
            ? {
                ...r,
                category_id: categoryId,
                category_source: 'confirmed',
                needs_review: false,
                finance_categories: {
                  slug: category.slug,
                  name: category.name,
                  icon: category.icon,
                  color: category.color,
                  kind: category.kind,
                },
              }
            : r
        )
      );

      try {
        await assign(transactionId, target.comment, categoryId);
      } catch {
        setRows(prev);
      }
    },
    [assign, allCategories, rows]
  );

  /**
   * Apply an edit. The patch is built by `buildRowPatch`, which decides which
   * fields actually changed and whether date_precision has to be upgraded —
   * this only writes what it is handed.
   */
  const updateRow = useCallback(
    async (transactionId: string, patch: RowPatch) => {
      if (Object.keys(patch).length === 0) return;

      const prev = rows;
      setRows((curr) =>
        curr.map((r) => (r.id === transactionId ? { ...r, ...patch } : r))
      );

      const { error: err } = await supabase
        .from('transactions')
        .update(patch)
        .eq('id', transactionId);

      if (err) setRows(prev);
    },
    [supabase, rows]
  );

  const deleteRow = useCallback(
    async (transactionId: string) => {
      const prev = rows;
      setRows((curr) =>
        curr
          .filter((r) => r.id !== transactionId)
          // The column is ON DELETE SET NULL, so anything repaying this row is
          // un-linked rather than deleted. Mirrored here, or the repayment
          // would keep pointing at a row that is gone until the next fetch and
          // read as netted against nothing.
          .map((r) =>
            r.reimburses_transaction_id === transactionId
              ? { ...r, reimburses_transaction_id: null }
              : r
          )
      );

      const { error: err } = await supabase
        .from('transactions')
        .delete()
        .eq('id', transactionId);

      if (err) setRows(prev);
    },
    [supabase, rows]
  );

  /** Clear the review flag without changing the category. */
  const acceptRow = useCallback(
    async (transactionId: string) => {
      const prev = rows;
      setRows((curr) =>
        curr.map((r) => (r.id === transactionId ? { ...r, needs_review: false } : r))
      );

      const { error: err } = await supabase
        .from('transactions')
        .update({ needs_review: false })
        .eq('id', transactionId);

      if (err) setRows(prev);
    },
    [supabase, rows]
  );

  /**
   * Attach an incoming row to the expense it repays.
   *
   * Never guessed — the caller passes the pair the user pointed at. `canLink`
   * is the gate, and it is checked here as well as in the picker so a stale
   * list cannot write a link the rules would refuse.
   */
  const linkReimbursement = useCallback(
    async (sourceId: string, targetId: string): Promise<string | null> => {
      const source = rows.find((r) => r.id === sourceId);
      const target = rows.find((r) => r.id === targetId);
      if (!source || !target) return 'That row is no longer here.';

      const check = canLink(source, target, rows);
      if (!check.ok) return check.reason;

      const prev = rows;
      setRows((curr) =>
        curr.map((r) =>
          r.id === sourceId ? { ...r, reimburses_transaction_id: targetId } : r
        )
      );

      const { error: err } = await supabase
        .from('transactions')
        .update({ reimburses_transaction_id: targetId })
        .eq('id', sourceId);

      if (err) {
        setRows(prev);
        return err.message;
      }
      return null;
    },
    [supabase, rows]
  );

  /** Detach. Both rows keep their amounts, so this restores the earlier totals. */
  const unlinkReimbursement = useCallback(
    async (sourceId: string) => {
      const prev = rows;
      setRows((curr) =>
        curr.map((r) =>
          r.id === sourceId ? { ...r, reimburses_transaction_id: null } : r
        )
      );

      const { error: err } = await supabase
        .from('transactions')
        .update({ reimburses_transaction_id: null })
        .eq('id', sourceId);

      if (err) setRows(prev);
    },
    [supabase, rows]
  );

  /** What the pickers offer. Archived categories are not choices any more. */
  const categories = useMemo(
    () => activeCategories(allCategories) as CategoryOption[],
    [allCategories]
  );

  return {
    rows,
    categories,
    allCategories,
    loading,
    error,
    refetch: fetchAll,
    setCategory,
    updateRow,
    deleteRow,
    acceptRow,
    linkReimbursement,
    unlinkReimbursement,
  };
}
