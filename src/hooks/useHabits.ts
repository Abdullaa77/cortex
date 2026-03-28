'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSupabase } from '@/components/providers/SupabaseProvider';
import type { Habit } from '@/lib/types';

export function useHabits() {
  const { supabase, session } = useSupabase();
  const [habits, setHabits] = useState<Habit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchHabits = useCallback(async () => {
    if (!session?.user) return;
    setLoading(true);
    try {
      const { data, error: err } = await supabase
        .from('habits')
        .select('*')
        .eq('is_archived', false)
        .order('sort_order');
      if (err) throw err;

      if (data.length === 0) {
        // Seed defaults (seeds both routines and habits)
        await supabase.rpc('seed_default_routines', { p_user_id: session.user.id });
        const { data: seeded, error: seedErr } = await supabase
          .from('habits')
          .select('*')
          .eq('is_archived', false)
          .order('sort_order');
        if (seedErr) throw seedErr;
        setHabits(seeded || []);
      } else {
        setHabits(data);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch habits');
    } finally {
      setLoading(false);
    }
  }, [supabase, session?.user]);

  useEffect(() => {
    fetchHabits();
  }, [fetchHabits]);

  const createHabit = useCallback(
    async (data: {
      name: string;
      icon?: string;
      color?: string;
      track_type?: 'checkbox' | 'number';
      target_value?: number;
      unit?: string;
    }): Promise<Habit | null> => {
      if (!session?.user) return null;
      const maxOrder = habits.length > 0 ? Math.max(...habits.map((h) => h.sort_order)) : -1;
      const optimistic: Habit = {
        id: crypto.randomUUID(),
        user_id: session.user.id,
        name: data.name,
        icon: data.icon || '○',
        color: data.color || '#00FF88',
        track_type: data.track_type || 'checkbox',
        target_value: data.target_value ?? null,
        unit: data.unit ?? null,
        sort_order: maxOrder + 1,
        is_archived: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      const prev = [...habits];
      setHabits([...habits, optimistic]);

      try {
        const { data: created, error: err } = await supabase
          .from('habits')
          .insert({
            name: data.name,
            icon: data.icon || '○',
            color: data.color || '#00FF88',
            track_type: data.track_type || 'checkbox',
            target_value: data.target_value ?? null,
            unit: data.unit ?? null,
            sort_order: maxOrder + 1,
            user_id: session.user.id,
          })
          .select()
          .single();
        if (err) throw err;
        setHabits((curr) => curr.map((h) => (h.id === optimistic.id ? created : h)));
        return created;
      } catch (err) {
        setHabits(prev);
        setError(err instanceof Error ? err.message : 'Failed to create habit');
        return null;
      }
    },
    [supabase, session?.user, habits]
  );

  const updateHabit = useCallback(
    async (id: string, data: Partial<Habit>) => {
      const prev = [...habits];
      setHabits(habits.map((h) => (h.id === id ? { ...h, ...data } : h)));
      const { error: err } = await supabase.from('habits').update(data).eq('id', id);
      if (err) {
        setHabits(prev);
        setError(err.message);
      }
    },
    [supabase, habits]
  );

  const archiveHabit = useCallback(
    async (id: string) => {
      const prev = [...habits];
      setHabits(habits.filter((h) => h.id !== id));
      const { error: err } = await supabase
        .from('habits')
        .update({ is_archived: true })
        .eq('id', id);
      if (err) {
        setHabits(prev);
        setError(err.message);
      }
    },
    [supabase, habits]
  );

  const reorderHabits = useCallback(
    async (orderedIds: string[]) => {
      const prev = [...habits];
      const reordered = orderedIds
        .map((id, i) => {
          const habit = habits.find((h) => h.id === id);
          return habit ? { ...habit, sort_order: i } : null;
        })
        .filter(Boolean) as Habit[];
      setHabits(reordered);

      try {
        const updates = orderedIds.map((id, i) =>
          supabase.from('habits').update({ sort_order: i }).eq('id', id)
        );
        const results = await Promise.all(updates);
        const failed = results.find((r) => r.error);
        if (failed?.error) throw failed.error;
      } catch (err) {
        setHabits(prev);
        setError(err instanceof Error ? err.message : 'Failed to reorder');
      }
    },
    [supabase, habits]
  );

  return {
    habits,
    loading,
    error,
    fetchHabits,
    createHabit,
    updateHabit,
    archiveHabit,
    reorderHabits,
  };
}
