'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSupabase } from '@/components/providers/SupabaseProvider';
import {
  activeAccounts,
  nextDefaultAfterRetiring,
  nextSortOrder,
  validateAccountDraft,
  type AccountDraft,
  type AccountRecord,
} from '@/lib/finance/accounts';
import {
  adjustmentDraft,
  reconcileCount,
  UNACCOUNTED_SLUG,
  type BalanceCheckpoint,
  type MovementRow,
} from '@/lib/finance/checkpoints';
import type { FxRate } from '@/lib/finance/positions';

export interface FinanceSettings {
  cutoverDate: string | null;
  defaultAccountId: string | null;
  /** So'm per dollar, in tiyin. Null until someone enters one. */
  uzsPerUsdMinor: number | null;
  fxRateSetAt: string | null;
}

const NO_SETTINGS: FinanceSettings = {
  cutoverDate: null,
  defaultAccountId: null,
  uzsPerUsdMinor: null,
  fxRateSetAt: null,
};

const ACCOUNT_SELECT = 'id, name, owner, currency, kind, is_active, sort_order';
const CHECKPOINT_SELECT =
  'id, account_id, counted_at, counted_minor, note, adjustment_transaction_id';

/**
 * The containers, the counts, and the two settings that steer them.
 *
 * Optimistic with rollback, matching the other hooks — except for recording a
 * count, which is not optimistic and should not be. A count writes two rows
 * that only mean anything together: the checkpoint, and the adjustment that
 * closes its gap. Showing a balance that has moved before knowing whether both
 * landed would put a figure on screen that the drawer does not back, which is
 * the one thing this whole stage exists to prevent.
 */
export function useAccounts() {
  const { supabase, session } = useSupabase();
  const userId = session?.user?.id ?? null;

  const [accounts, setAccounts] = useState<AccountRecord[]>([]);
  const [checkpoints, setCheckpoints] = useState<BalanceCheckpoint[]>([]);
  const [settings, setSettings] = useState<FinanceSettings>(NO_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const [accRes, cpRes, setRes] = await Promise.all([
        supabase.from('accounts').select(ACCOUNT_SELECT).order('sort_order'),
        supabase.from('balance_checkpoints').select(CHECKPOINT_SELECT).order('counted_at'),
        supabase
          .from('finance_settings')
          .select('cutover_date, default_account_id, uzs_per_usd, fx_rate_set_at')
          .maybeSingle(),
      ]);

      // All three are checked, including settings. `.maybeSingle()` reports no
      // rows as data:null with error:null, so a real failure here is a real
      // failure — and swallowing it is how a missing finance_settings table
      // became "no settings set yet" instead of "could not ask".
      if (accRes.error) throw accRes.error;
      if (cpRes.error) throw cpRes.error;
      if (setRes.error) throw setRes.error;

      setAccounts((accRes.data ?? []) as AccountRecord[]);
      setCheckpoints(
        ((cpRes.data ?? []) as BalanceCheckpoint[]).map((c) => ({
          ...c,
          counted_minor: Number(c.counted_minor),
        }))
      );
      setSettings(
        setRes.data
          ? {
              cutoverDate: setRes.data.cutover_date,
              defaultAccountId: setRes.data.default_account_id,
              uzsPerUsdMinor:
                setRes.data.uzs_per_usd === null ? null : Number(setRes.data.uzs_per_usd),
              fxRateSetAt: setRes.data.fx_rate_set_at,
            }
          : NO_SETTINGS
      );
      setError(null);
    } catch (err) {
      // The lists are cleared, not left holding a stale copy — but `error` is
      // what the UI must key off. An empty array means "there are none"; it
      // must never be the only trace of "the question failed". See
      // PositionsCard, which renders those two as different things.
      setAccounts([]);
      setCheckpoints([]);
      setSettings(NO_SETTINGS);
      setError(err instanceof Error ? err.message : 'Failed to load accounts');
    } finally {
      setLoading(false);
    }
  }, [supabase, userId]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  /** The rate, in the shape the position math wants. Null until it is set. */
  const rate = useMemo<FxRate | null>(
    () =>
      settings.uzsPerUsdMinor !== null && settings.fxRateSetAt
        ? { uzsPerUsdMinor: settings.uzsPerUsdMinor, setAt: settings.fxRateSetAt }
        : null,
    [settings.uzsPerUsdMinor, settings.fxRateSetAt]
  );

  const saveSettings = useCallback(
    async (patch: Partial<FinanceSettings>): Promise<string | null> => {
      if (!userId) return 'Not signed in.';
      const next = { ...settings, ...patch };
      const prev = settings;
      setSettings(next);

      const { error: err } = await supabase.from('finance_settings').upsert(
        {
          user_id: userId,
          cutover_date: next.cutoverDate,
          default_account_id: next.defaultAccountId,
          uzs_per_usd: next.uzsPerUsdMinor,
          fx_rate_set_at: next.fxRateSetAt,
        },
        { onConflict: 'user_id' }
      );

      if (err) {
        setSettings(prev);
        return err.message;
      }
      return null;
    },
    [supabase, userId, settings]
  );

  const createAccount = useCallback(
    async (draft: AccountDraft): Promise<string | null> => {
      if (!userId) return 'Not signed in.';
      const check = validateAccountDraft(draft, accounts);
      if (!check.ok) return check.errors[0];

      const { data, error: err } = await supabase
        .from('accounts')
        .insert({
          user_id: userId,
          name: draft.name.trim(),
          owner: draft.owner,
          currency: draft.currency,
          kind: draft.kind,
          sort_order: nextSortOrder(accounts),
        })
        .select(ACCOUNT_SELECT)
        .single();

      if (err) return err.message;
      setAccounts((curr) => [...curr, data as AccountRecord]);

      // The first account a user creates becomes the one capture lands in, so
      // `-10k banana` never has to ask. Only the first: silently re-pointing
      // the default at whatever was made most recently would move where
      // yesterday's habit lands without telling anyone.
      if (!settings.defaultAccountId) await saveSettings({ defaultAccountId: data.id });
      return null;
    },
    [supabase, userId, accounts, settings.defaultAccountId, saveSettings]
  );

  const updateAccount = useCallback(
    async (id: string, patch: Partial<AccountDraft> & { is_active?: boolean }) => {
      const prev = accounts;
      setAccounts((curr) => curr.map((a) => (a.id === id ? { ...a, ...patch } : a)));

      const { error: err } = await supabase.from('accounts').update(patch).eq('id', id);
      if (err) {
        setAccounts(prev);
        return err.message;
      }
      return null;
    },
    [supabase, accounts]
  );

  /**
   * Rename in place.
   *
   * Goes through the same check the add row does, with the same sentences, so
   * a duplicate name is refused identically whether it is typed into a new
   * account or into an existing one — and self-excluded, so an account can
   * keep its own name and fix its own capitalisation.
   */
  const renameAccount = useCallback(
    async (id: string, name: string): Promise<string | null> => {
      const account = accounts.find((a) => a.id === id);
      if (!account) return 'That account is gone.';

      const check = validateAccountDraft({ ...account, name }, accounts, id);
      if (!check.ok) return check.errors[0];

      const trimmed = name.trim();
      if (trimmed === account.name) return null;
      return updateAccount(id, { name: trimmed });
    },
    [accounts, updateAccount]
  );

  /**
   * Retire an account. Never delete one.
   *
   * Transactions point at accounts, and a delete would take the record of what
   * was spent from a drawer along with the drawer. Retiring keeps every row
   * exactly where it is and only stops the account claiming to hold something:
   * `positionsAt` lists active accounts, so a retired one leaves the positions
   * list and the uncounted list together, and stops dragging on a household
   * total it can no longer be counted for.
   *
   * Two refusals and one consequence, in that order:
   *
   *   - The last active account cannot be retired. Capture would have nowhere
   *     to land, and a capture that books into no account is a row that moves
   *     no position — the number on /finance and the money in the drawer would
   *     part company on the next thing typed.
   *
   *   - If this is where captures land, the default moves FIRST, then the
   *     account is retired. That order is the whole point: if the retire then
   *     fails, the default has merely moved to another live account, which is
   *     harmless. The other order can leave capture pointing at a retired
   *     drawer, which is the state this exists to prevent.
   *
   * Returns which account took over, so the screen can say so. The default is
   * never re-pointed without telling anyone — that is the same rule
   * `createAccount` keeps when it declines to move the default to whatever was
   * made most recently.
   */
  const retireAccount = useCallback(
    async (
      id: string
    ): Promise<{ error: string | null; defaultMovedTo: AccountRecord | null }> => {
      const account = accounts.find((a) => a.id === id);
      if (!account) return { error: 'That account is gone.', defaultMovedTo: null };
      if (!account.is_active) return { error: null, defaultMovedTo: null };

      const successor = nextDefaultAfterRetiring(accounts, id);
      if (!successor)
        return {
          error:
            'This is the only account left. Add another before retiring it — captures have to land somewhere.',
          defaultMovedTo: null,
        };

      let movedTo: AccountRecord | null = null;
      if (settings.defaultAccountId === id) {
        const err = await saveSettings({ defaultAccountId: successor.id });
        if (err) return { error: err, defaultMovedTo: null };
        movedTo = successor;
      }

      const err = await updateAccount(id, { is_active: false });
      return { error: err, defaultMovedTo: err ? null : movedTo };
    },
    [accounts, settings.defaultAccountId, saveSettings, updateAccount]
  );

  /**
   * Record a physical count.
   *
   * Two writes, in the order that fails safely. The adjustment goes first, so
   * that if the checkpoint write then fails there is a visible, deletable row
   * in the ledger rather than a checkpoint claiming a gap it never closed. The
   * reverse order would leave the count standing with its gap silently
   * unexplained, which reads as agreement.
   *
   * `movements` is passed in rather than fetched, so the gap is measured
   * against exactly the rows the page is showing. Re-querying here could
   * measure against a different set than the one Scott is looking at, and then
   * the number he is asked to accept is not the number he can check.
   */
  const recordCount = useCallback(
    async (input: {
      accountId: string;
      countedAt: string;
      countedMinor: number;
      note: string | null;
      movements: MovementRow[];
      unaccountedCategoryId: string | null;
    }): Promise<string | null> => {
      if (!userId) return 'Not signed in.';

      /**
       * Re-counting a day that has already been counted supersedes it, and
       * that has to include the adjustment the first count wrote.
       *
       * Left in, that row is part of the movements the new gap is measured
       * against, so the second count writes a small correction on top of the
       * first — arithmetically right, and a ledger with two Unaccounted rows
       * for one drawer on one afternoon, one of which describes a count that
       * no longer exists. One count, one adjustment. The superseded row is
       * excluded from the derivation here and deleted once its replacement is
       * safely written.
       */
      const superseded =
        checkpoints.find(
          (c) => c.account_id === input.accountId && c.counted_at === input.countedAt
        )?.adjustment_transaction_id ?? null;

      const movements = superseded
        ? input.movements.filter((m) => m.id !== superseded)
        : input.movements;

      const result = reconcileCount(
        input.accountId,
        checkpoints,
        movements,
        input.countedAt,
        input.countedMinor
      );
      const draft = adjustmentDraft(result);
      const account = accounts.find((a) => a.id === input.accountId);
      if (!account) return 'That account is no longer here.';

      let adjustmentId: string | null = null;

      if (draft) {
        if (!input.unaccountedCategoryId)
          return `The ${UNACCOUNTED_SLUG} category is missing, so the gap has nowhere to go.`;

        const { data, error: err } = await supabase
          .from('transactions')
          .insert({
            user_id: userId,
            category_id: input.unaccountedCategoryId,
            direction: draft.direction,
            amount_minor: draft.amount_minor,
            // The account's currency, not the ledger's. An adjustment to a
            // dollar drawer is a dollar amount, and the currency trigger would
            // refuse anything else.
            currency: account.currency,
            comment: draft.comment,
            raw_input: draft.raw_input,
            category_source: 'manual',
            needs_review: false,
            occurred_at: draft.occurred_at,
            date_precision: draft.date_precision,
            from_account_id: draft.from_account_id,
            to_account_id: draft.to_account_id,
          })
          .select('id')
          .single();

        if (err) return err.message;
        adjustmentId = data.id;
      }

      const { data: cp, error: cpErr } = await supabase
        .from('balance_checkpoints')
        .upsert(
          {
            user_id: userId,
            account_id: input.accountId,
            counted_at: input.countedAt,
            counted_minor: input.countedMinor,
            note: input.note,
            adjustment_transaction_id: adjustmentId,
          },
          { onConflict: 'account_id,counted_at' }
        )
        .select(CHECKPOINT_SELECT)
        .single();

      if (cpErr) {
        // Take the orphan back out. It explains a count that does not exist.
        if (adjustmentId) await supabase.from('transactions').delete().eq('id', adjustmentId);
        return cpErr.message;
      }

      // Only now, with the replacement written and the checkpoint pointing at
      // it. Deleting first would leave a window where a failed write had
      // removed the explanation for a gap that still existed.
      if (superseded) await supabase.from('transactions').delete().eq('id', superseded);

      setCheckpoints((curr) => [
        ...curr.filter(
          (c) => !(c.account_id === input.accountId && c.counted_at === input.countedAt)
        ),
        { ...(cp as BalanceCheckpoint), counted_minor: Number(cp.counted_minor) },
      ]);
      return null;
    },
    [supabase, userId, checkpoints, accounts]
  );

  /**
   * Remove a count.
   *
   * The adjustment it wrote is deliberately left alone. It is a row in the
   * ledger saying money went missing, and that claim does not stop being true
   * because the count that discovered it was deleted — usually the count is
   * being deleted precisely because its date was wrong. Removing the
   * adjustment as well would quietly restate a month.
   */
  const deleteCheckpoint = useCallback(
    async (id: string): Promise<string | null> => {
      const prev = checkpoints;
      setCheckpoints((curr) => curr.filter((c) => c.id !== id));
      const { error: err } = await supabase.from('balance_checkpoints').delete().eq('id', id);
      if (err) {
        setCheckpoints(prev);
        return err.message;
      }
      return null;
    },
    [supabase, checkpoints]
  );

  const active = useMemo(() => activeAccounts(accounts), [accounts]);

  return {
    accounts,
    activeAccounts: active,
    checkpoints,
    settings,
    rate,
    loading,
    error,
    refetch: fetchAll,
    createAccount,
    updateAccount,
    renameAccount,
    retireAccount,
    saveSettings,
    recordCount,
    deleteCheckpoint,
  };
}
