'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSupabase } from '@/components/providers/SupabaseProvider';
import type { Task } from '@/lib/types';
import { computeTodayTasks } from '@/lib/today-algorithm';

export function useTasks(filters?: {
  project_id?: string;
  area_id?: string;
  status?: string | string[];
  is_pinned?: boolean;
}) {
  const { supabase, session } = useSupabase();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTasks = useCallback(async () => {
    if (!session?.user) return;
    setLoading(true);
    try {
      let query = supabase.from('tasks').select('*');

      if (filters?.project_id) {
        query = query.eq('project_id', filters.project_id);
        // For project view, include done tasks to show progress
      } else if (filters?.status) {
        const statuses = Array.isArray(filters.status) ? filters.status : [filters.status];
        query = query.in('status', statuses);
      } else {
        // Default: exclude done and cancelled
        query = query.in('status', ['todo', 'in_progress']);
      }

      if (filters?.area_id) query = query.eq('area_id', filters.area_id);
      if (filters?.is_pinned !== undefined) query = query.eq('is_pinned', filters.is_pinned);

      query = query.order('priority', { ascending: true })
        .order('due_date', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: false });

      const { data, error: err } = await query;
      if (err) throw err;
      setTasks(data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch tasks');
    } finally {
      setLoading(false);
    }
  }, [supabase, session?.user, filters?.project_id, filters?.area_id, filters?.status, filters?.is_pinned]);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  const createTask = useCallback(
    async (data: {
      title: string;
      area_id: string;
      project_id?: string;
      priority?: number;
      due_date?: string;
      description?: string;
      estimated_minutes?: number;
    }): Promise<Task | null> => {
      if (!session?.user) return null;
      const optimistic: Task = {
        id: crypto.randomUUID(),
        user_id: session.user.id,
        project_id: data.project_id || null,
        area_id: data.area_id,
        title: data.title,
        description: data.description || '',
        status: 'todo',
        priority: (data.priority || 3) as Task['priority'],
        due_date: data.due_date || null,
        estimated_minutes: data.estimated_minutes || null,
        is_pinned: false,
        tags: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        completed_at: null,
      };
      const prev = [...tasks];
      setTasks([optimistic, ...tasks]);

      try {
        const { data: created, error: err } = await supabase
          .from('tasks')
          .insert({
            title: data.title,
            area_id: data.area_id,
            project_id: data.project_id || null,
            priority: data.priority || 3,
            due_date: data.due_date || null,
            description: data.description || '',
            estimated_minutes: data.estimated_minutes || null,
            user_id: session.user.id,
          })
          .select()
          .single();
        if (err) throw err;
        setTasks((curr) => curr.map((t) => (t.id === optimistic.id ? created : t)));
        return created;
      } catch (err) {
        setTasks(prev);
        setError(err instanceof Error ? err.message : 'Failed to create task');
        return null;
      }
    },
    [supabase, session?.user, tasks]
  );

  const updateTask = useCallback(
    async (id: string, data: Partial<Task>) => {
      const prev = [...tasks];
      setTasks(tasks.map((t) => (t.id === id ? { ...t, ...data } : t)));
      const { error: err } = await supabase.from('tasks').update(data).eq('id', id);
      if (err) {
        setTasks(prev);
        setError(err.message);
      }
    },
    [supabase, tasks]
  );

  const deleteTask = useCallback(
    async (id: string) => {
      const prev = [...tasks];
      setTasks(tasks.filter((t) => t.id !== id));
      const { error: err } = await supabase.from('tasks').delete().eq('id', id);
      if (err) {
        setTasks(prev);
        setError(err.message);
      }
    },
    [supabase, tasks]
  );

  const completeTask = useCallback(
    async (id: string) => {
      const prev = [...tasks];
      setTasks(
        tasks.map((t) =>
          t.id === id ? { ...t, status: 'done' as const, completed_at: new Date().toISOString() } : t
        )
      );
      const { error: err } = await supabase
        .from('tasks')
        .update({ status: 'done', completed_at: new Date().toISOString() })
        .eq('id', id);
      if (err) {
        setTasks(prev);
        setError(err.message);
      }
    },
    [supabase, tasks]
  );

  const togglePin = useCallback(
    async (id: string) => {
      const task = tasks.find((t) => t.id === id);
      if (!task) return;
      const prev = [...tasks];
      setTasks(tasks.map((t) => (t.id === id ? { ...t, is_pinned: !t.is_pinned } : t)));
      const { error: err } = await supabase
        .from('tasks')
        .update({ is_pinned: !task.is_pinned })
        .eq('id', id);
      if (err) {
        setTasks(prev);
        setError(err.message);
      }
    },
    [supabase, tasks]
  );

  const getTodayTasks = useCallback((): Task[] => {
    return computeTodayTasks(tasks);
  }, [tasks]);

  return {
    tasks,
    loading,
    error,
    fetchTasks,
    createTask,
    updateTask,
    deleteTask,
    completeTask,
    togglePin,
    getTodayTasks,
  };
}
