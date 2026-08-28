'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSupabase } from '@/components/providers/SupabaseProvider';
import { categorize, ruleKey } from '@/lib/finance/categorize';
import { parseLine } from '@/lib/finance/parse';
import { planNotMoney, type Booking, type RouteDecision } from '@/lib/finance/route';
import { classifyRow } from '@/lib/finance/summarize';
import { sidesForClass } from '@/lib/finance/accounts';
import { HOUSEHOLD, takesBeneficiary } from '@/lib/finance/beneficiary';

interface CategoryRecord {
  id: string;
  slug: string;
  name: string;
  icon: string;
  color: string;
  kind: 'expense' | 'income' | 'transfer';
}

export interface BookedRow {
  id: string;
  amountMinor: number;
  currency: 'UZS' | 'USD';
  direction: 'expense' | 'income';
  comment: string;
  categorySlug: string | null;
  /** When it happened. Editable from the confirmation strip after the save. */
  occurredAt: string;
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
  /**
   * Where a capture lands when nobody said. Read once at mount and held in a
   * ref, so booking never waits on a query.
   *
   * THIS IS WHY THERE IS NO ACCOUNT PICKER. `-10k two bananas` plus enter is a
   * ten-second action, and the reason the thing gets used every day. The moment
   * it costs thirty seconds it stops being used, and every number downstream
   * rots — a picker would buy an account on each row at the price of having no
   * rows. The account is editable afterwards, from the confirmation strip and
   * from the list, which is where a correction belongs.
   */
  const defaultAccountId = useRef<string | null>(null);
  /** The default account's currency. A mismatch is refused by the database. */
  const defaultCurrency = useRef<'UZS' | 'USD'>('UZS');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;

    (async () => {
      const [catRes, areaRes, ruleRes, setRes] = await Promise.all([
        supabase.from('finance_categories').select('id, slug, name, icon, color, kind'),
        supabase.from('areas').select('id').eq('name', 'Finance').limit(1),
        supabase
          .from('finance_category_rules')
          .select('keyword, finance_categories(slug)'),
        supabase
          .from('finance_settings')
          .select('default_account_id, accounts:default_account_id(currency)')
          .maybeSingle(),
      ]);
      if (cancelled) return;

      categories.current = (catRes.data ?? []) as CategoryRecord[];
      financeAreaId.current = areaRes.data?.[0]?.id ?? null;
      defaultAccountId.current = setRes.data?.default_account_id ?? null;
      defaultCurrency.current =
        (setRes.data as { accounts?: { currency: 'UZS' | 'USD' } | null } | null)?.accounts
          ?.currency ?? 'UZS';

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
        const category = slug ? categories.current.find((c) => c.slug === slug) : undefined;

        /**
         * Which side of the default account this touched, decided by what the
         * row COUNTS AS rather than by its direction — the same rule the read
         * path uses. "4,625,000 salary" carries direction 'expense' because the
         * line has no leading plus, and it is money arriving. Reading direction
         * here would put it on the wrong side of the drawer, which is exactly
         * what migration 008's backfill did.
         *
         * A capture in a currency the default account does not hold gets no
         * account at all: the database refuses the mismatch, and dropping the
         * row would lose the capture. It lands unassigned and shows up in the
         * list to be pointed at the right drawer.
         */
        const account =
          defaultAccountId.current && txn.currency === defaultCurrency.current
            ? defaultAccountId.current
            : null;

        /**
         * The row as the read path sees it. Built once and asked twice — which
         * side of the account it touched, and whether it has a beneficiary at
         * all. Two questions, one description of the row, so they cannot come
         * to answer different rows.
         */
        const classifiable = {
          direction: txn.direction,
          occurred_at: now,
          finance_categories: category
            ? {
                slug: category.slug,
                name: category.name,
                icon: category.icon,
                color: category.color,
                kind: category.kind,
              }
            : null,
        };

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
          /**
           * Who it was for. The household is the ordinary answer in a household
           * that eats together, so it is the default — and defaulting is honest
           * HERE and nowhere else, because the person is sitting in front of the
           * confirmation strip and can change it in one tap. A migration writing
           * the same value across history has nobody in front of it, which is
           * why backfillBeneficiary refuses to.
           *
           * Income, transfers and the adjustment get NULL: they have no
           * beneficiary at all, rather than one nobody has chosen yet.
           *
           * NO SIGIL FOR IT IN THE CAPTURE GRAMMAR. No `@me`, no `>mom`. That
           * parser has produced two real bugs already — the k/m suffix
           * swallowing the first letter of the next word turned `87,549
           * korzinka` into 87.5 million — and it is the only thing standing
           * between a typo and a wrong ledger. Adding a sigil to it to save
           * four seconds is a bad trade. The beneficiary is set by editing the
           * row afterwards.
           */
          beneficiary: takesBeneficiary(classifiable) ? HOUSEHOLD : null,
          ...(account
            ? sidesForClass(classifyRow(classifiable), account)
            : { from_account_id: null, to_account_id: null }),
        };
      });

      const { data, error } = await supabase
        .from('transactions')
        .insert(payload)
        .select(
          'id, amount_minor, currency, direction, comment, category_id, occurred_at'
        );

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
        occurredAt: row.occurred_at,
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
   * Move a booked row to a different instant.
   *
   * Offered after the save, never before it. Asking for a date in front of the
   * input would put friction on the one thing that has to stay frictionless —
   * "-10k banana" plus enter still books immediately, and the date is there
   * afterwards for the times it was not today.
   *
   * Rows written here are always 'day' precision already, so there is no
   * precision to upgrade; that rule only applies to the imported month-only
   * rows, and it lives in buildRowPatch.
   */
  const setOccurredAt = useCallback(
    async (transactionId: string, occurredAt: string) => {
      if (!userId) return;
      await supabase
        .from('transactions')
        .update({ occurred_at: occurredAt, date_precision: 'day' })
        .eq('id', transactionId);
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

  return { ready, book, remove, setCategory, setOccurredAt, discard };
}
