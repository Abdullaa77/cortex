'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSupabase } from '@/components/providers/SupabaseProvider';
import { useCategoryAssignment } from './useCategoryAssignment';
import type { TransactionRecord } from '@/lib/finance/transactions';

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
  'finance_categories(slug, name, icon, color, kind)';

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
  const [categories, setCategories] = useState<CategoryOption[]>([]);
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
          .select('id, slug, name, icon, color, kind')
          .eq('is_archived', false)
          .order('sort_order'),
      ]);

      if (txnRes.error) throw txnRes.error;
      setRows((txnRes.data ?? []) as unknown as TransactionRecord[]);
      setCategories((catRes.data ?? []) as CategoryOption[]);
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
      const category = categories.find((c) => c.id === categoryId);
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
    [assign, categories, rows]
  );

  const updateRow = useCallback(
    async (
      transactionId: string,
      patch: { comment?: string; amount_minor?: number }
    ) => {
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
      setRows((curr) => curr.filter((r) => r.id !== transactionId));

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

  return {
    rows,
    categories,
    loading,
    error,
    refetch: fetchAll,
    setCategory,
    updateRow,
    deleteRow,
    acceptRow,
  };
}
