'use client';

import { useCallback } from 'react';
import { useSupabase } from '@/components/providers/SupabaseProvider';
import { ruleKey } from '@/lib/finance/categorize';

/**
 * Assigning a category and remembering the correction, in one place.
 *
 * Both the capture confirmation and the transactions list do this, and the two
 * must not drift — a correction made in one surface has to teach the other.
 */
export function useCategoryAssignment() {
  const { supabase, session } = useSupabase();
  const userId = session?.user?.id ?? null;

  const assign = useCallback(
    async (transactionId: string, comment: string, categoryId: string) => {
      if (!userId) return;

      await supabase
        .from('transactions')
        .update({
          category_id: categoryId,
          // A person chose this, so it is no longer a guess and no longer
          // something to review.
          category_source: 'confirmed',
          needs_review: false,
        })
        .eq('id', transactionId);

      const key = ruleKey(comment);
      if (!key) return;

      // Latest correction wins — the same comment should classify this way
      // next time it is captured.
      await supabase
        .from('finance_category_rules')
        .upsert(
          { user_id: userId, keyword: key, category_id: categoryId },
          { onConflict: 'user_id,keyword' }
        );
    },
    [supabase, userId]
  );

  return { assign };
}
