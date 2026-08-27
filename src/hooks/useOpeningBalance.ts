'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSupabase } from '@/components/providers/SupabaseProvider';
import type { OpeningBalance } from '@/lib/finance/reconcile';

export type { OpeningBalance } from '@/lib/finance/reconcile';

/**
 * The one balance the user enters by hand.
 *
 * One row per user, so saving is an upsert on user_id and never an insert —
 * a second row would be a second source of truth for where the ledger starts,
 * and the two would drift the moment one was edited.
 */
export function useOpeningBalance() {
  const { supabase, session } = useSupabase();
  const userId = session?.user?.id ?? null;

  const [balance, setBalance] = useState<OpeningBalance | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchBalance = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const { data, error: err } = await supabase
        .from('finance_opening_balance')
        .select('amount_minor, as_of')
        .maybeSingle();

      if (err) throw err;
      setBalance(
        data ? { amountMinor: Number(data.amount_minor), asOf: data.as_of } : null
      );
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load opening balance');
    } finally {
      setLoading(false);
    }
  }, [supabase, userId]);

  useEffect(() => {
    fetchBalance();
  }, [fetchBalance]);

  /** Set or replace it. Optimistic, and rolled back if the write fails. */
  const save = useCallback(
    async (next: OpeningBalance) => {
      if (!userId) return;
      const prev = balance;
      setBalance(next);

      const { error: err } = await supabase.from('finance_opening_balance').upsert(
        {
          user_id: userId,
          amount_minor: next.amountMinor,
          as_of: next.asOf,
        },
        { onConflict: 'user_id' }
      );

      if (err) {
        setBalance(prev);
        setError(err.message);
      } else {
        setError(null);
      }
    },
    [supabase, userId, balance]
  );

  /** Remove it — the page goes back to stating what the first month would need. */
  const clear = useCallback(async () => {
    if (!userId) return;
    const prev = balance;
    setBalance(null);

    const { error: err } = await supabase
      .from('finance_opening_balance')
      .delete()
      .eq('user_id', userId);

    if (err) {
      setBalance(prev);
      setError(err.message);
    }
  }, [supabase, userId, balance]);

  return { balance, loading, error, save, clear, refetch: fetchBalance };
}
