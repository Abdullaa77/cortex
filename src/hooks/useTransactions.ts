'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSupabase } from '@/components/providers/SupabaseProvider';
import { useCategoryAssignment } from './useCategoryAssignment';
import type { TransactionRecord } from '@/lib/finance/transactions';
import type { RowPatch } from '@/lib/finance/edit';
import { canLink } from '@/lib/finance/links';
import {
  clearsBeneficiary,
  takesBeneficiary,
  type Beneficiary,
} from '@/lib/finance/beneficiary';
import { UNACCOUNTED_SLUG } from '@/lib/finance/checkpoints';
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
  'reimburses_transaction_id, from_account_id, to_account_id, transfer_pair_id, ' +
  'beneficiary, ' +
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

  /**
   * Refile a row.
   *
   * Returns the beneficiary this edit DROPPED, if it dropped one, so the row
   * can say so. Migration 010's trigger clears the beneficiary when a spend row
   * becomes income, a transfer or the adjustment — correct, because for those
   * rows NULL is the only right answer, but a value the user chose vanishing
   * because they changed something else needs to be mentioned once rather than
   * discovered later. Null when nothing was lost, which is almost always.
   */
  const setCategory = useCallback(
    async (transactionId: string, categoryId: string): Promise<Beneficiary | null> => {
      // Searched across everything, not just the active list — a row already
      // filed under an archived category must still be re-assignable to it.
      const category = allCategories.find((c) => c.id === categoryId);
      const target = rows.find((r) => r.id === transactionId);
      if (!category || !target) return null;

      const dropped = clearsBeneficiary(target, {
        slug: category.slug,
        name: category.name,
        icon: category.icon,
        color: category.color,
        kind: category.kind,
      });

      const prev = rows;
      setRows((curr) =>
        curr.map((r) =>
          r.id === transactionId
            ? {
                ...r,
                category_id: categoryId,
                category_source: 'confirmed',
                needs_review: false,
                // Mirrors migration 010's trigger, the same way deleteRow
                // mirrors ON DELETE SET NULL. Filing a grocery row under
                // Income clears its beneficiary at the database; without this
                // the local copy would keep it until the next fetch. Nothing
                // would render it — beneficiaryOf() refuses non-spend rows —
                // but a local copy that disagrees with storage is how the
                // half-deleted pair got its own mutation test.
                beneficiary:
                  category.kind === 'expense' && category.slug !== UNACCOUNTED_SLUG
                    ? r.beneficiary
                    : null,
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
        return null;
      }
      return dropped;
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
          // Both pointer columns are ON DELETE SET NULL, so whatever pointed at
          // this row is un-linked rather than deleted. Mirrored here, or the
          // local copy keeps pointing at a row that is gone until the next
          // fetch.
          //
          // The repayment case reads as netted against nothing. The transfer
          // case is quieter and worse: the surviving leg of a cross-currency
          // pair would still look answered — its counterpart names where the
          // money went — while that counterpart no longer exists. It would sit
          // out of the "needs the other side" queue, silently complete, until
          // something forced a refetch. A half-deleted pair has to become
          // visibly unanswered immediately, because being asked again is the
          // only thing that recovers what the deletion cost.
          .map((r) => {
            const next = { ...r };
            if (r.reimburses_transaction_id === transactionId)
              next.reimburses_transaction_id = null;
            if (r.transfer_pair_id === transactionId) next.transfer_pair_id = null;
            return next;
          })
      );

      const { error: err } = await supabase
        .from('transactions')
        .delete()
        .eq('id', transactionId);

      if (err) setRows(prev);
    },
    [supabase, rows]
  );

  /**
   * Say who this was for — or unsay it.
   *
   * Its own call rather than a field on the edit form, because it is one tap
   * from the list and the form is behind a pencil. Null is a real answer here:
   * it puts the row back to "not recorded", which has to stay reachable, or a
   * beneficiary picked by mistake could only be replaced and never removed.
   *
   * Refused on rows that have none by definition — income, transfers, the
   * unaccounted adjustment. The database clears those anyway and the read path
   * ignores them, but writing a value that three layers will discard is not
   * something the UI should be able to ask for.
   */
  const setBeneficiary = useCallback(
    async (transactionId: string, beneficiary: Beneficiary | null) => {
      const target = rows.find((r) => r.id === transactionId);
      if (!target || (beneficiary !== null && !takesBeneficiary(target))) return;

      const prev = rows;
      setRows((curr) =>
        curr.map((r) => (r.id === transactionId ? { ...r, beneficiary } : r))
      );

      const { error: err } = await supabase
        .from('transactions')
        .update({ beneficiary })
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

  /**
   * Answer a cross-currency transfer by writing its other half.
   *
   * 4,850,000 so'm leaving and $400 arriving are two movements at a rate
   * somebody agreed to, and one row cannot hold both amounts without electing
   * one of them as the truth. So the counterpart is written in the
   * destination's own currency and the two rows are pointed at each other.
   *
   * The insert goes first and the pairing second, in the order that fails
   * safely: a counterpart with no pair is a visible, deletable row saying money
   * arrived, while a pair pointing at a row that was never written is a
   * dangling reference the read path would have to defend against.
   */
  const pairTransfer = useCallback(
    async (
      rowId: string,
      counterpart: {
        amount_minor: number;
        currency: 'UZS' | 'USD';
        direction: 'expense' | 'income';
        from_account_id: string | null;
        to_account_id: string | null;
        occurred_at: string;
        comment: string;
        raw_input: string;
        category_slug: string;
      }
    ): Promise<string | null> => {
      if (!userId) return 'Not signed in.';
      const category = allCategories.find((c) => c.slug === counterpart.category_slug);

      const { data, error: insertErr } = await supabase
        .from('transactions')
        .insert({
          user_id: userId,
          category_id: category?.id ?? null,
          direction: counterpart.direction,
          amount_minor: counterpart.amount_minor,
          currency: counterpart.currency,
          comment: counterpart.comment,
          raw_input: counterpart.raw_input,
          category_source: 'manual',
          needs_review: false,
          occurred_at: counterpart.occurred_at,
          date_precision: 'day',
          from_account_id: counterpart.from_account_id,
          to_account_id: counterpart.to_account_id,
          transfer_pair_id: rowId,
        })
        .select('id')
        .single();

      if (insertErr) return insertErr.message;

      const { error: linkErr } = await supabase
        .from('transactions')
        .update({ transfer_pair_id: data.id })
        .eq('id', rowId);

      if (linkErr) {
        await supabase.from('transactions').delete().eq('id', data.id);
        return linkErr.message;
      }

      await fetchAll();
      return null;
    },
    [supabase, userId, allCategories, fetchAll]
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
    setBeneficiary,
    updateRow,
    deleteRow,
    acceptRow,
    linkReimbursement,
    unlinkReimbursement,
    pairTransfer,
  };
}
