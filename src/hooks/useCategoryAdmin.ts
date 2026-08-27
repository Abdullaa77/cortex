'use client';

import { useCallback, useMemo } from 'react';
import { useSupabase } from '@/components/providers/SupabaseProvider';
import {
  buildInsert,
  buildUpdate,
  planRetire,
  usageByCategory,
  type CategoryDraft,
  type CategoryRecord,
} from '@/lib/finance/categories';

export type { CategoryRecord, CategoryDraft } from '@/lib/finance/categories';

/**
 * Creating, renaming and retiring categories.
 *
 * Takes the rows it already has rather than fetching its own — the usage
 * counts that decide delete-versus-archive have to be counted from the same
 * set the rest of the page is showing, or a category could read as unused and
 * be deleted while rows still point at it.
 *
 * Every write refetches through the caller's `onChanged`. These are rare,
 * deliberate actions on a small table; an optimistic path here would be more
 * code than it saves, and getting a category's identity wrong optimistically
 * is worse than a moment's wait.
 */
export function useCategoryAdmin(
  /** Every category, archived included. */
  categories: CategoryRecord[],
  /** Every transaction, for usage counts. */
  rows: { category_id: string | null }[],
  onChanged: () => Promise<unknown> | unknown
) {
  const { supabase, session } = useSupabase();
  const userId = session?.user?.id ?? null;

  const usage = useMemo(() => usageByCategory(rows), [rows]);

  const usageFor = useCallback(
    (categoryId: string) => usage.get(categoryId) ?? 0,
    [usage]
  );

  const create = useCallback(
    async (draft: CategoryDraft): Promise<string | null> => {
      if (!userId) return 'Not signed in.';

      const { error } = await supabase
        .from('finance_categories')
        .insert({ user_id: userId, ...buildInsert(draft, categories) });

      if (error) return error.message;
      await onChanged();
      return null;
    },
    [supabase, userId, categories, onChanged]
  );

  const update = useCallback(
    async (category: CategoryRecord, draft: CategoryDraft): Promise<string | null> => {
      const patch = buildUpdate(category, draft);
      // The slug is deliberately absent from every patch — see categories.ts.
      if (Object.keys(patch).length === 0) return null;

      const { error } = await supabase
        .from('finance_categories')
        .update(patch)
        .eq('id', category.id);

      if (error) return error.message;
      await onChanged();
      return null;
    },
    [supabase, onChanged]
  );

  /**
   * Archive if anything points at it, delete if nothing does.
   *
   * `transactions.category_id` is ON DELETE SET NULL, so a delete here would
   * drop rows into uncategorised without a word. The decision is made in
   * `planRetire` and this only carries it out.
   */
  const retire = useCallback(
    async (category: CategoryRecord): Promise<string | null> => {
      const plan = planRetire(category, usageFor(category.id));

      const { error } =
        plan.action === 'delete'
          ? await supabase.from('finance_categories').delete().eq('id', category.id)
          : await supabase
              .from('finance_categories')
              .update({ is_archived: true })
              .eq('id', category.id);

      if (error) return error.message;
      await onChanged();
      return null;
    },
    [supabase, usageFor, onChanged]
  );

  const restore = useCallback(
    async (category: CategoryRecord): Promise<string | null> => {
      const { error } = await supabase
        .from('finance_categories')
        .update({ is_archived: false })
        .eq('id', category.id);

      if (error) return error.message;
      await onChanged();
      return null;
    },
    [supabase, onChanged]
  );

  return { usageFor, create, update, retire, restore, planRetire };
}
