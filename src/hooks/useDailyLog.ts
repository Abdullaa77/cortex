'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSupabase } from '@/components/providers/SupabaseProvider';
import type { DailyLogEntry, DisciplineScore, Routine, Habit } from '@/lib/types';

function todayDate(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function useDailyLog(
  routines: Routine[],
  habits: Habit[],
  date?: string
) {
  const { supabase, session } = useSupabase();
  const logDate = date || todayDate();

  const [entries, setEntries] = useState<DailyLogEntry[]>([]);
  const [disciplineScore, setDisciplineScore] = useState<DisciplineScore>({
    total: 0,
    completed: 0,
    percentage: 0,
  });
  const [streaks, setStreaks] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // --- Discipline Score ---
  const computeDisciplineScore = useCallback(
    (currentEntries: DailyLogEntry[]): DisciplineScore => {
      const allSteps = routines.flatMap((r) => r.steps || []);
      const total = allSteps.length + habits.length;
      if (total === 0) return { total: 0, completed: 0, percentage: 0 };

      let completed = 0;
      for (const entry of currentEntries) {
        if (entry.completed) completed++;
      }

      return {
        total,
        completed,
        percentage: Math.round((completed / total) * 100),
      };
    },
    [routines, habits]
  );

  // --- Fetch ---
  const fetchDailyLog = useCallback(async () => {
    if (!session?.user) return;
    setLoading(true);
    try {
      const { data, error: err } = await supabase
        .from('daily_log')
        .select('*')
        .eq('log_date', logDate);
      if (err) throw err;

      const fetched = data || [];
      setEntries(fetched);
      setDisciplineScore(computeDisciplineScore(fetched));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch daily log');
    } finally {
      setLoading(false);
    }
  }, [supabase, session?.user, logDate, computeDisciplineScore]);

  useEffect(() => {
    fetchDailyLog();
  }, [fetchDailyLog]);

  // --- Find or create entry helper ---
  const findEntry = useCallback(
    (field: 'routine_step_id' | 'habit_id', itemId: string): DailyLogEntry | undefined => {
      return entries.find((e) => e[field] === itemId && e.log_date === logDate);
    },
    [entries, logDate]
  );

  // --- Toggle Step ---
  const toggleStep = useCallback(
    async (routineStepId: string) => {
      if (!session?.user) return;
      const existing = findEntry('routine_step_id', routineStepId);
      const newCompleted = existing ? !existing.completed : true;
      const now = new Date().toISOString();

      const prev = [...entries];

      if (existing) {
        // Optimistic update
        const updated = entries.map((e) =>
          e.id === existing.id
            ? { ...e, completed: newCompleted, completed_at: newCompleted ? now : null }
            : e
        );
        setEntries(updated);
        setDisciplineScore(computeDisciplineScore(updated));

        const { error: err } = await supabase
          .from('daily_log')
          .update({ completed: newCompleted, completed_at: newCompleted ? now : null })
          .eq('id', existing.id);
        if (err) {
          setEntries(prev);
          setDisciplineScore(computeDisciplineScore(prev));
          setError(err.message);
        }
      } else {
        // Optimistic insert
        const optimistic: DailyLogEntry = {
          id: crypto.randomUUID(),
          user_id: session.user.id,
          log_date: logDate,
          routine_step_id: routineStepId,
          habit_id: null,
          completed: true,
          value: null,
          completed_at: now,
          created_at: now,
        };
        const updated = [...entries, optimistic];
        setEntries(updated);
        setDisciplineScore(computeDisciplineScore(updated));

        const { data: created, error: err } = await supabase
          .from('daily_log')
          .insert({
            user_id: session.user.id,
            log_date: logDate,
            routine_step_id: routineStepId,
            completed: true,
            completed_at: now,
          })
          .select()
          .single();
        if (err) {
          setEntries(prev);
          setDisciplineScore(computeDisciplineScore(prev));
          setError(err.message);
        } else if (created) {
          setEntries((curr) => curr.map((e) => (e.id === optimistic.id ? created : e)));
        }
      }
    },
    [supabase, session?.user, entries, logDate, findEntry, computeDisciplineScore]
  );

  // --- Toggle Habit (checkbox) ---
  const toggleHabit = useCallback(
    async (habitId: string) => {
      if (!session?.user) return;
      const existing = findEntry('habit_id', habitId);
      const newCompleted = existing ? !existing.completed : true;
      const now = new Date().toISOString();

      const prev = [...entries];

      if (existing) {
        const updated = entries.map((e) =>
          e.id === existing.id
            ? { ...e, completed: newCompleted, completed_at: newCompleted ? now : null }
            : e
        );
        setEntries(updated);
        setDisciplineScore(computeDisciplineScore(updated));

        const { error: err } = await supabase
          .from('daily_log')
          .update({ completed: newCompleted, completed_at: newCompleted ? now : null })
          .eq('id', existing.id);
        if (err) {
          setEntries(prev);
          setDisciplineScore(computeDisciplineScore(prev));
          setError(err.message);
        }
      } else {
        const optimistic: DailyLogEntry = {
          id: crypto.randomUUID(),
          user_id: session.user.id,
          log_date: logDate,
          routine_step_id: null,
          habit_id: habitId,
          completed: true,
          value: null,
          completed_at: now,
          created_at: now,
        };
        const updated = [...entries, optimistic];
        setEntries(updated);
        setDisciplineScore(computeDisciplineScore(updated));

        const { data: created, error: err } = await supabase
          .from('daily_log')
          .insert({
            user_id: session.user.id,
            log_date: logDate,
            habit_id: habitId,
            completed: true,
            completed_at: now,
          })
          .select()
          .single();
        if (err) {
          setEntries(prev);
          setDisciplineScore(computeDisciplineScore(prev));
          setError(err.message);
        } else if (created) {
          setEntries((curr) => curr.map((e) => (e.id === optimistic.id ? created : e)));
        }
      }
    },
    [supabase, session?.user, entries, logDate, findEntry, computeDisciplineScore]
  );

  // --- Set Habit Value (number type) ---
  const setHabitValue = useCallback(
    async (habitId: string, value: number) => {
      if (!session?.user) return;
      const habit = habits.find((h) => h.id === habitId);
      const isCompleted = habit?.target_value ? value >= habit.target_value : value > 0;
      const now = new Date().toISOString();
      const existing = findEntry('habit_id', habitId);

      const prev = [...entries];

      if (existing) {
        const updated = entries.map((e) =>
          e.id === existing.id
            ? { ...e, value, completed: isCompleted, completed_at: isCompleted ? now : null }
            : e
        );
        setEntries(updated);
        setDisciplineScore(computeDisciplineScore(updated));

        const { error: err } = await supabase
          .from('daily_log')
          .update({ value, completed: isCompleted, completed_at: isCompleted ? now : null })
          .eq('id', existing.id);
        if (err) {
          setEntries(prev);
          setDisciplineScore(computeDisciplineScore(prev));
          setError(err.message);
        }
      } else {
        const optimistic: DailyLogEntry = {
          id: crypto.randomUUID(),
          user_id: session.user.id,
          log_date: logDate,
          routine_step_id: null,
          habit_id: habitId,
          completed: isCompleted,
          value,
          completed_at: isCompleted ? now : null,
          created_at: now,
        };
        const updated = [...entries, optimistic];
        setEntries(updated);
        setDisciplineScore(computeDisciplineScore(updated));

        const { data: created, error: err } = await supabase
          .from('daily_log')
          .insert({
            user_id: session.user.id,
            log_date: logDate,
            habit_id: habitId,
            value,
            completed: isCompleted,
            completed_at: isCompleted ? now : null,
          })
          .select()
          .single();
        if (err) {
          setEntries(prev);
          setDisciplineScore(computeDisciplineScore(prev));
          setError(err.message);
        } else if (created) {
          setEntries((curr) => curr.map((e) => (e.id === optimistic.id ? created : e)));
        }
      }
    },
    [supabase, session?.user, entries, habits, logDate, findEntry, computeDisciplineScore]
  );

  // --- Streaks ---
  const fetchStreaks = useCallback(
    async (itemIds: { id: string; type: 'step' | 'habit' }[]) => {
      if (!session?.user || itemIds.length === 0) return;

      const stepIds = itemIds.filter((i) => i.type === 'step').map((i) => i.id);
      const habitIds = itemIds.filter((i) => i.type === 'habit').map((i) => i.id);

      try {
        // Fetch separately for steps and habits since Supabase can't OR across different columns
        const allEntries: { routine_step_id: string | null; habit_id: string | null; log_date: string }[] = [];

        if (stepIds.length > 0) {
          const { data } = await supabase
            .from('daily_log')
            .select('routine_step_id, habit_id, log_date')
            .eq('completed', true)
            .in('routine_step_id', stepIds)
            .order('log_date', { ascending: false })
            .limit(3600);
          if (data) allEntries.push(...data);
        }

        if (habitIds.length > 0) {
          const { data } = await supabase
            .from('daily_log')
            .select('routine_step_id, habit_id, log_date')
            .eq('completed', true)
            .in('habit_id', habitIds)
            .order('log_date', { ascending: false })
            .limit(3600);
          if (data) allEntries.push(...data);
        }

        // Build a set of completed dates per item
        const completedDates = new Map<string, Set<string>>();
        for (const entry of allEntries) {
          const key = entry.routine_step_id || entry.habit_id;
          if (!key) continue;
          const set = completedDates.get(key) || new Set();
          set.add(entry.log_date);
          completedDates.set(key, set);
        }

        // Compute streaks: count consecutive days backward from yesterday
        const newStreaks = new Map<string, number>();
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);

        for (const item of itemIds) {
          const dates = completedDates.get(item.id);
          if (!dates) {
            newStreaks.set(item.id, 0);
            continue;
          }

          let streak = 0;
          const checkDate = new Date(yesterday);
          for (let i = 0; i < 60; i++) {
            const dateStr = `${checkDate.getFullYear()}-${String(checkDate.getMonth() + 1).padStart(2, '0')}-${String(checkDate.getDate()).padStart(2, '0')}`;
            if (dates.has(dateStr)) {
              streak++;
              checkDate.setDate(checkDate.getDate() - 1);
            } else {
              break;
            }
          }
          newStreaks.set(item.id, streak);
        }

        setStreaks(newStreaks);
      } catch (err) {
        console.error('Failed to fetch streaks:', err);
      }
    },
    [supabase, session?.user]
  );

  return {
    entries,
    disciplineScore,
    streaks,
    loading,
    error,
    fetchDailyLog,
    toggleStep,
    toggleHabit,
    setHabitValue,
    fetchStreaks,
  };
}
