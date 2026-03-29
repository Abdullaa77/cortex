'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSupabase } from '@/components/providers/SupabaseProvider';
import type { Routine, RoutineStep } from '@/lib/types';

export function useRoutines() {
  const { supabase, session } = useSupabase();
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchRoutines = useCallback(async () => {
    if (!session?.user) return;
    setLoading(true);
    try {
      const { data: routineData, error: rErr } = await supabase
        .from('routines')
        .select('*')
        .eq('is_archived', false)
        .order('sort_order');
      if (rErr) throw rErr;

      // Batch fetch all steps for these routines
      const routineIds = routineData.map((r) => r.id);
      const { data: stepData, error: sErr } = await supabase
        .from('routine_steps')
        .select('*')
        .in('routine_id', routineIds.length > 0 ? routineIds : ['__none__'])
        .eq('is_archived', false)
        .order('sort_order');
      if (sErr) throw sErr;

      // Merge steps into routines
      const stepsByRoutine = new Map<string, RoutineStep[]>();
      for (const step of stepData || []) {
        const list = stepsByRoutine.get(step.routine_id) || [];
        list.push(step);
        stepsByRoutine.set(step.routine_id, list);
      }

      const merged: Routine[] = routineData.map((r) => ({
        ...r,
        steps: stepsByRoutine.get(r.id) || [],
      }));

      setRoutines(merged);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch routines');
    } finally {
      setLoading(false);
    }
  }, [supabase, session?.user]);

  useEffect(() => {
    fetchRoutines();
  }, [fetchRoutines]);

  const createRoutine = useCallback(
    async (data: {
      name: string;
      icon?: string;
      color?: string;
      time_of_day?: string;
    }): Promise<Routine | null> => {
      if (!session?.user) return null;
      const maxOrder = routines.length > 0 ? Math.max(...routines.map((r) => r.sort_order)) : -1;
      const optimistic: Routine = {
        id: crypto.randomUUID(),
        user_id: session.user.id,
        name: data.name,
        icon: data.icon || '◉',
        color: data.color || '#00FF88',
        time_of_day: (data.time_of_day as Routine['time_of_day']) || 'anytime',
        sort_order: maxOrder + 1,
        is_prayer: false,
        is_archived: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        steps: [],
      };
      const prev = [...routines];
      setRoutines([...routines, optimistic]);

      try {
        const { data: created, error: err } = await supabase
          .from('routines')
          .insert({
            name: data.name,
            icon: data.icon || '◉',
            color: data.color || '#00FF88',
            time_of_day: data.time_of_day || 'anytime',
            sort_order: maxOrder + 1,
            user_id: session.user.id,
          })
          .select()
          .single();
        if (err) throw err;
        setRoutines((curr) =>
          curr.map((r) => (r.id === optimistic.id ? { ...created, steps: [] } : r))
        );
        return { ...created, steps: [] };
      } catch (err) {
        setRoutines(prev);
        setError(err instanceof Error ? err.message : 'Failed to create routine');
        return null;
      }
    },
    [supabase, session?.user, routines]
  );

  const updateRoutine = useCallback(
    async (id: string, data: Partial<Routine>) => {
      const prev = [...routines];
      setRoutines(routines.map((r) => (r.id === id ? { ...r, ...data } : r)));
      const { error: err } = await supabase.from('routines').update(data).eq('id', id);
      if (err) {
        setRoutines(prev);
        setError(err.message);
      }
    },
    [supabase, routines]
  );

  const archiveRoutine = useCallback(
    async (id: string) => {
      const prev = [...routines];
      setRoutines(routines.filter((r) => r.id !== id));
      const { error: err } = await supabase
        .from('routines')
        .update({ is_archived: true })
        .eq('id', id);
      if (err) {
        setRoutines(prev);
        setError(err.message);
      }
    },
    [supabase, routines]
  );

  const reorderRoutines = useCallback(
    async (orderedIds: string[]) => {
      const prev = [...routines];
      const reordered = orderedIds
        .map((id, i) => {
          const routine = routines.find((r) => r.id === id);
          return routine ? { ...routine, sort_order: i } : null;
        })
        .filter(Boolean) as Routine[];
      setRoutines(reordered);

      try {
        const updates = orderedIds.map((id, i) =>
          supabase.from('routines').update({ sort_order: i }).eq('id', id)
        );
        const results = await Promise.all(updates);
        const failed = results.find((r) => r.error);
        if (failed?.error) throw failed.error;
      } catch (err) {
        setRoutines(prev);
        setError(err instanceof Error ? err.message : 'Failed to reorder');
      }
    },
    [supabase, routines]
  );

  // --- Step CRUD ---

  const addStep = useCallback(
    async (routineId: string, name: string): Promise<RoutineStep | null> => {
      if (!session?.user) return null;
      const routine = routines.find((r) => r.id === routineId);
      if (!routine) return null;

      const steps = routine.steps || [];
      const maxOrder = steps.length > 0 ? Math.max(...steps.map((s) => s.sort_order)) : -1;
      const optimistic: RoutineStep = {
        id: crypto.randomUUID(),
        routine_id: routineId,
        user_id: session.user.id,
        name,
        sort_order: maxOrder + 1,
        is_archived: false,
        created_at: new Date().toISOString(),
      };

      const prev = [...routines];
      setRoutines(
        routines.map((r) =>
          r.id === routineId ? { ...r, steps: [...(r.steps || []), optimistic] } : r
        )
      );

      try {
        const { data: created, error: err } = await supabase
          .from('routine_steps')
          .insert({
            routine_id: routineId,
            user_id: session.user.id,
            name,
            sort_order: maxOrder + 1,
          })
          .select()
          .single();
        if (err) throw err;
        setRoutines((curr) =>
          curr.map((r) =>
            r.id === routineId
              ? { ...r, steps: (r.steps || []).map((s) => (s.id === optimistic.id ? created : s)) }
              : r
          )
        );
        return created;
      } catch (err) {
        setRoutines(prev);
        setError(err instanceof Error ? err.message : 'Failed to add step');
        return null;
      }
    },
    [supabase, session?.user, routines]
  );

  const updateStep = useCallback(
    async (stepId: string, data: { name?: string }) => {
      const prev = [...routines];
      setRoutines(
        routines.map((r) => ({
          ...r,
          steps: (r.steps || []).map((s) => (s.id === stepId ? { ...s, ...data } : s)),
        }))
      );
      const { error: err } = await supabase.from('routine_steps').update(data).eq('id', stepId);
      if (err) {
        setRoutines(prev);
        setError(err.message);
      }
    },
    [supabase, routines]
  );

  const removeStep = useCallback(
    async (stepId: string) => {
      const prev = [...routines];
      setRoutines(
        routines.map((r) => ({
          ...r,
          steps: (r.steps || []).filter((s) => s.id !== stepId),
        }))
      );
      const { error: err } = await supabase
        .from('routine_steps')
        .update({ is_archived: true })
        .eq('id', stepId);
      if (err) {
        setRoutines(prev);
        setError(err.message);
      }
    },
    [supabase, routines]
  );

  const reorderSteps = useCallback(
    async (routineId: string, orderedStepIds: string[]) => {
      const prev = [...routines];
      setRoutines(
        routines.map((r) => {
          if (r.id !== routineId) return r;
          const reordered = orderedStepIds
            .map((id, i) => {
              const step = (r.steps || []).find((s) => s.id === id);
              return step ? { ...step, sort_order: i } : null;
            })
            .filter(Boolean) as RoutineStep[];
          return { ...r, steps: reordered };
        })
      );

      try {
        const updates = orderedStepIds.map((id, i) =>
          supabase.from('routine_steps').update({ sort_order: i }).eq('id', id)
        );
        const results = await Promise.all(updates);
        const failed = results.find((r) => r.error);
        if (failed?.error) throw failed.error;
      } catch (err) {
        setRoutines(prev);
        setError(err instanceof Error ? err.message : 'Failed to reorder steps');
      }
    },
    [supabase, routines]
  );

  return {
    routines,
    loading,
    error,
    fetchRoutines,
    createRoutine,
    updateRoutine,
    archiveRoutine,
    reorderRoutines,
    addStep,
    updateStep,
    removeStep,
    reorderSteps,
  };
}
