'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSupabase } from '@/components/providers/SupabaseProvider';
import type { Idea } from '@/lib/types';

export function useIdeas(filters?: {
  area_id?: string;
  rating?: number;
}) {
  const { supabase, session } = useSupabase();
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchIdeas = useCallback(async () => {
    if (!session?.user) return;
    setLoading(true);
    try {
      let query = supabase.from('ideas').select('*');
      if (filters?.area_id) query = query.eq('area_id', filters.area_id);
      if (filters?.rating !== undefined) query = query.eq('rating', filters.rating);

      query = query
        .order('rating', { ascending: false })
        .order('created_at', { ascending: false });

      const { data, error: err } = await query;
      if (err) throw err;
      setIdeas(data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch ideas');
    } finally {
      setLoading(false);
    }
  }, [supabase, session?.user, filters?.area_id, filters?.rating]);

  useEffect(() => {
    fetchIdeas();
  }, [fetchIdeas]);

  const createIdea = useCallback(
    async (data: {
      title: string;
      body?: string;
      area_id?: string;
      rating?: number;
    }): Promise<Idea | null> => {
      if (!session?.user) return null;
      const optimistic: Idea = {
        id: crypto.randomUUID(),
        user_id: session.user.id,
        area_id: data.area_id || null,
        title: data.title,
        body: data.body || '',
        rating: (data.rating || 0) as Idea['rating'],
        tags: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      const prev = [...ideas];
      setIdeas([optimistic, ...ideas]);

      try {
        const { data: created, error: err } = await supabase
          .from('ideas')
          .insert({
            title: data.title,
            body: data.body || '',
            area_id: data.area_id || null,
            rating: data.rating || 0,
          })
          .select()
          .single();
        if (err) throw err;
        setIdeas((curr) => curr.map((i) => (i.id === optimistic.id ? created : i)));
        return created;
      } catch (err) {
        setIdeas(prev);
        setError(err instanceof Error ? err.message : 'Failed to create idea');
        return null;
      }
    },
    [supabase, session?.user, ideas]
  );

  const updateIdea = useCallback(
    async (id: string, data: Partial<Idea>) => {
      const prev = [...ideas];
      setIdeas(ideas.map((i) => (i.id === id ? { ...i, ...data } : i)));
      const { error: err } = await supabase.from('ideas').update(data).eq('id', id);
      if (err) {
        setIdeas(prev);
        setError(err.message);
      }
    },
    [supabase, ideas]
  );

  const deleteIdea = useCallback(
    async (id: string) => {
      const prev = [...ideas];
      setIdeas(ideas.filter((i) => i.id !== id));
      const { error: err } = await supabase.from('ideas').delete().eq('id', id);
      if (err) {
        setIdeas(prev);
        setError(err.message);
      }
    },
    [supabase, ideas]
  );

  const rateIdea = useCallback(
    async (id: string, rating: 0 | 1 | 2 | 3) => {
      const prev = [...ideas];
      setIdeas(ideas.map((i) => (i.id === id ? { ...i, rating } : i)));
      const { error: err } = await supabase
        .from('ideas')
        .update({ rating })
        .eq('id', id);
      if (err) {
        setIdeas(prev);
        setError(err.message);
      }
    },
    [supabase, ideas]
  );

  return {
    ideas,
    loading,
    error,
    fetchIdeas,
    createIdea,
    updateIdea,
    deleteIdea,
    rateIdea,
  };
}
