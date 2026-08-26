'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSupabase } from '@/components/providers/SupabaseProvider';
import { summarize, type TransactionRow } from '@/lib/finance/summarize';

export type {
  MonthTotals,
  CategoryComparison,
  FinanceSummary,
} from '@/lib/finance/summarize';

/**
 * Fetches the user's transactions and hands them to the pure aggregator.
 *
 * Read-only — this view never mutates, so there is no optimistic path to roll
 * back. Editing transactions is a separate step.
 */
export function useFinanceSummary() {
  const { supabase, session } = useSupabase();
  const [rows, setRows] = useState<TransactionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTransactions = useCallback(async () => {
    if (!session?.user) return;
    setLoading(true);
    try {
      const { data, error: err } = await supabase
        .from('transactions')
        .select(
          'amount_minor, direction, occurred_at, date_precision, needs_review, ' +
            'finance_categories(slug, name, icon, color, kind)'
        )
        .order('occurred_at', { ascending: false })
        .limit(5000);

      if (err) throw err;
      setRows((data ?? []) as unknown as TransactionRow[]);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load transactions');
    } finally {
      setLoading(false);
    }
  }, [supabase, session?.user]);

  useEffect(() => {
    fetchTransactions();
  }, [fetchTransactions]);

  const summary = useMemo(() => summarize(rows), [rows]);

  return { summary, loading, error, refetch: fetchTransactions };
}
