'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSupabase } from '@/components/providers/SupabaseProvider';
import { categorize, ruleKey } from '@/lib/finance/categorize';
import { parseLine } from '@/lib/finance/parse';
import { planNotMoney, type Booking, type RouteDecision } from '@/lib/finance/route';

interface CategoryRecord {
  id: string;
  slug: string;
  name: string;
  icon: string;
  color: string;
}

export interface BookedRow {
  id: string;
  amountMinor: number;
  currency: 'UZS' | 'USD';
  direction: 'expense' | 'income';
  comment: string;
  categorySlug: string | null;
}

export interface CaptureBooking extends Booking {
  rows: BookedRow[];
}

/**
 * Writes captures that the router judged to be money.
 *
 * Saving never waits on a category. The row lands first with whatever the
 * rules inferred — possibly nothing — and the confirmation strip is where that
 * guess gets corrected. Uncategorised is a valid resting state; /finance
 * already renders it honestly.
 */
export function useFinanceCapture() {
  const { supabase, session } = useSupabase();
  // Hoisted so the callbacks below depend on the id itself rather than on the
  // whole session object, which would re-create them on every token refresh.
  const userId = session?.user?.id ?? null;
  const categories = useRef<CategoryRecord[]>([]);
  const learned = useRef<Map<string, string>>(new Map());
  const financeAreaId = useRef<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;

    (async () => {
      const [catRes, areaRes, ruleRes] = await Promise.all([
        supabase.from('finance_categories').select('id, slug, name, icon, color'),
        supabase.from('areas').select('id').eq('name', 'Finance').limit(1),
        supabase
          .from('finance_category_rules')
          .select('keyword, finance_categories(slug)'),
      ]);
      if (cancelled) return;

      categories.current = (catRes.data ?? []) as CategoryRecord[];
      financeAreaId.current = areaRes.data?.[0]?.id ?? null;

      const map = new Map<string, string>();
      for (const row of (ruleRes.data ?? []) as unknown as {
        keyword: string;
        finance_categories: { slug: string } | null;
      }[])
        if (row.finance_categories?.slug) map.set(row.keyword, row.finance_categories.slug);
      learned.current = map;

      setReady(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [supabase, userId]);

  const idForSlug = (slug: string | null) =>
    slug ? categories.current.find((c) => c.slug === slug)?.id ?? null : null;

  /**
   * Write the parsed rows. Returns null if nothing could be written, so the
   * caller can fall back to the inbox rather than dropping the capture.
   */
  const book = useCallback(
    async (rawInput: string, decision: RouteDecision): Promise<CaptureBooking | null> => {
      if (!userId || decision.transactions.length === 0) return null;

      const flags = parseLine(rawInput).flags.map((f) => f.code);
      const now = new Date().toISOString();

      const payload = decision.transactions.map((txn) => {
        const slug = categorize(txn.comment, learned.current).slug;
        return {
          user_id: userId,
          area_id: financeAreaId.current,
          category_id: idForSlug(slug),
          direction: txn.direction,
          amount_minor: txn.amountMinor,
          currency: txn.currency,
          comment: txn.comment,
          raw_input: rawInput,
          category_source: 'inferred' as const,
          needs_review: slug === null,
          parse_flags: flags,
          occurred_at: now,
          // Typed here, so the day is real. Imported rows stay 'month'.
          date_precision: 'day' as const,
        };
      });

      const { data, error } = await supabase
        .from('transactions')
        .insert(payload)
        .select('id, amount_minor, currency, direction, comment, category_id');

      if (error || !data) {
        console.error('[Cortex] finance capture failed:', error);
        return null;
      }

      const rows: BookedRow[] = data.map((row) => ({
        id: row.id,
        amountMinor: row.amount_minor,
        currency: row.currency,
        direction: row.direction,
        comment: row.comment,
        categorySlug:
          categories.current.find((c) => c.id === row.category_id)?.slug ?? null,
      }));

      return {
        transactionIds: rows.map((r) => r.id),
        rawInput,
        transactions: decision.transactions,
        rows,
      };
    },
    [supabase, userId]
  );

  /** Undo — remove the rows this capture created. */
  const remove = useCallback(
    async (ids: string[]) => {
      if (ids.length === 0) return;
      await supabase.from('transactions').delete().in('id', ids);
    },
    [supabase]
  );

  /**
   * Correct the category, and remember the correction so the same comment maps
   * right next time.
   */
  const setCategory = useCallback(
    async (transactionId: string, comment: string, slug: string) => {
      if (!userId) return;
      const categoryId = idForSlug(slug);
      if (!categoryId) return;

      await supabase
        .from('transactions')
        .update({
          category_id: categoryId,
          category_source: 'confirmed',
          needs_review: false,
        })
        .eq('id', transactionId);

      const key = ruleKey(comment);
      if (!key) return;

      learned.current.set(key, slug);
      await supabase.from('finance_category_rules').upsert(
        { user_id: userId, keyword: key, category_id: categoryId },
        { onConflict: 'user_id,keyword' }
      );
    },
    [supabase, userId]
  );

  /**
   * "Not money" — remove every row this capture made and hand back the
   * original text so the caller can file it to inbox unchanged.
   */
  const discard = useCallback(
    async (booking: CaptureBooking): Promise<string> => {
      const plan = planNotMoney(booking);
      await remove(plan.deleteIds);
      return plan.inboxText;
    },
    [remove]
  );

  return { ready, book, remove, setCategory, discard };
}
