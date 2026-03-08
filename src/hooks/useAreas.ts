'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSupabase } from '@/components/providers/SupabaseProvider';
import type { Area } from '@/lib/types';

export function useAreas() {
  const { supabase, session } = useSupabase();
  const [areas, setAreas] = useState<Area[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAreas = useCallback(async () => {
    if (!session?.user) return;
    setLoading(true);
    try {
      const { data, error: err } = await supabase
        .from('areas')
        .select('*')
        .eq('is_archived', false)
        .order('sort_order');
      if (err) throw err;

      if (data.length === 0) {
        // Seed defaults on first use
        await supabase.rpc('seed_default_areas', { p_user_id: session.user.id });
        const { data: seeded, error: seedErr } = await supabase
          .from('areas')
          .select('*')
          .eq('is_archived', false)
          .order('sort_order');
        if (seedErr) throw seedErr;
        setAreas(seeded || []);
      } else {
        setAreas(data);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch areas');
    } finally {
      setLoading(false);
    }
  }, [supabase, session?.user]);

  useEffect(() => {
    fetchAreas();
  }, [fetchAreas]);

  const createArea = useCallback(
    async (data: { name: string; icon: string; color: string }): Promise<Area | null> => {
      if (!session?.user) return null;
      const maxOrder = areas.length > 0 ? Math.max(...areas.map((a) => a.sort_order)) : -1;
      const optimistic: Area = {
        id: crypto.randomUUID(),
        user_id: session.user.id,
        sort_order: maxOrder + 1,
        is_archived: false,
        created_at: new Date().toISOString(),
        ...data,
      };
      const prev = [...areas];
      setAreas([...areas, optimistic]);

      try {
        const { data: created, error: err } = await supabase
          .from('areas')
          .insert({ ...data, sort_order: maxOrder + 1 })
          .select()
          .single();
        if (err) throw err;
        setAreas((curr) => curr.map((a) => (a.id === optimistic.id ? created : a)));
        return created;
      } catch (err) {
        setAreas(prev);
        setError(err instanceof Error ? err.message : 'Failed to create area');
        return null;
      }
    },
    [supabase, session?.user, areas]
  );

  const updateArea = useCallback(
    async (id: string, data: Partial<Area>) => {
      const prev = [...areas];
      setAreas(areas.map((a) => (a.id === id ? { ...a, ...data } : a)));
      const { error: err } = await supabase.from('areas').update(data).eq('id', id);
      if (err) {
        setAreas(prev);
        setError(err.message);
      }
    },
    [supabase, areas]
  );

  const archiveArea = useCallback(
    async (id: string) => {
      const prev = [...areas];
      setAreas(areas.filter((a) => a.id !== id));
      const { error: err } = await supabase
        .from('areas')
        .update({ is_archived: true })
        .eq('id', id);
      if (err) {
        setAreas(prev);
        setError(err.message);
      }
    },
    [supabase, areas]
  );

  const reorderAreas = useCallback(
    async (orderedIds: string[]) => {
      const prev = [...areas];
      const reordered = orderedIds
        .map((id, i) => {
          const area = areas.find((a) => a.id === id);
          return area ? { ...area, sort_order: i } : null;
        })
        .filter(Boolean) as Area[];
      setAreas(reordered);

      try {
        const updates = orderedIds.map((id, i) =>
          supabase.from('areas').update({ sort_order: i }).eq('id', id)
        );
        const results = await Promise.all(updates);
        const failed = results.find((r) => r.error);
        if (failed?.error) throw failed.error;
      } catch (err) {
        setAreas(prev);
        setError(err instanceof Error ? err.message : 'Failed to reorder');
      }
    },
    [supabase, areas]
  );

  return { areas, loading, error, fetchAreas, createArea, updateArea, archiveArea, reorderAreas };
}
