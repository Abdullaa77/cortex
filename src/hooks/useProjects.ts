'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSupabase } from '@/components/providers/SupabaseProvider';
import type { Project } from '@/lib/types';

export function useProjects(filters?: {
  area_id?: string;
  status?: string;
}) {
  const { supabase, session } = useSupabase();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchProjects = useCallback(async () => {
    if (!session?.user) return;
    setLoading(true);
    try {
      let query = supabase.from('projects').select('*');
      if (filters?.area_id) query = query.eq('area_id', filters.area_id);
      if (filters?.status) query = query.eq('status', filters.status);

      query = query
        .order('priority', { ascending: true })
        .order('updated_at', { ascending: false });

      const { data, error: err } = await query;
      if (err) throw err;

      const projectIds = (data || []).map((p) => p.id);
      const taskCounts: Record<string, { total: number; done: number }> = {};

      if (projectIds.length > 0) {
        // Batch fetch tasks for all projects to avoid N+1
        const { data: taskData, error: taskErr } = await supabase
          .from('tasks')
          .select('project_id, status')
          .in('project_id', projectIds);
        if (taskErr) throw taskErr;

        for (const t of taskData || []) {
          if (!t.project_id) continue;
          if (!taskCounts[t.project_id]) taskCounts[t.project_id] = { total: 0, done: 0 };
          if (t.status !== 'cancelled') taskCounts[t.project_id].total++;
          if (t.status === 'done') taskCounts[t.project_id].done++;
        }
      }

      const enriched: Project[] = (data || []).map((p) => ({
        ...p,
        task_count: taskCounts[p.id]?.total || 0,
        completed_task_count: taskCounts[p.id]?.done || 0,
      }));

      setProjects(enriched);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch projects');
    } finally {
      setLoading(false);
    }
  }, [supabase, session?.user, filters?.area_id, filters?.status]);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  const createProject = useCallback(
    async (data: {
      title: string;
      area_id: string;
      description?: string;
      priority?: number;
      deadline?: string;
    }): Promise<Project | null> => {
      if (!session?.user) return null;
      const optimistic: Project = {
        id: crypto.randomUUID(),
        user_id: session.user.id,
        area_id: data.area_id,
        title: data.title,
        description: data.description || '',
        status: 'active',
        priority: (data.priority || 2) as Project['priority'],
        deadline: data.deadline || null,
        tags: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        completed_at: null,
        task_count: 0,
        completed_task_count: 0,
      };
      const prev = [...projects];
      setProjects([optimistic, ...projects]);

      try {
        const { data: created, error: err } = await supabase
          .from('projects')
          .insert({
            title: data.title,
            area_id: data.area_id,
            description: data.description || '',
            priority: data.priority || 2,
            deadline: data.deadline || null,
          })
          .select()
          .single();
        if (err) throw err;
        setProjects((curr) =>
          curr.map((p) =>
            p.id === optimistic.id ? { ...created, task_count: 0, completed_task_count: 0 } : p
          )
        );
        return created;
      } catch (err) {
        setProjects(prev);
        setError(err instanceof Error ? err.message : 'Failed to create project');
        return null;
      }
    },
    [supabase, session?.user, projects]
  );

  const updateProject = useCallback(
    async (id: string, data: Partial<Project>) => {
      const prev = [...projects];
      const current = projects.find((p) => p.id === id);

      // Handle completed_at based on status changes
      const updates: Partial<Project> = { ...data };
      if (data.status === 'completed' && current?.status !== 'completed') {
        updates.completed_at = new Date().toISOString();
      } else if (data.status && data.status !== 'completed' && current?.status === 'completed') {
        updates.completed_at = null;
      }

      setProjects(projects.map((p) => (p.id === id ? { ...p, ...updates } : p)));
      const { error: err } = await supabase.from('projects').update(updates).eq('id', id);
      if (err) {
        setProjects(prev);
        setError(err.message);
      }
    },
    [supabase, projects]
  );

  const deleteProject = useCallback(
    async (id: string) => {
      const prev = [...projects];
      setProjects(projects.filter((p) => p.id !== id));
      const { error: err } = await supabase.from('projects').delete().eq('id', id);
      if (err) {
        setProjects(prev);
        setError(err.message);
      }
    },
    [supabase, projects]
  );

  const archiveProject = useCallback(
    async (id: string) => {
      const prev = [...projects];
      setProjects(projects.map((p) => (p.id === id ? { ...p, status: 'abandoned' as const } : p)));
      const { error: err } = await supabase
        .from('projects')
        .update({ status: 'abandoned' })
        .eq('id', id);
      if (err) {
        setProjects(prev);
        setError(err.message);
      }
    },
    [supabase, projects]
  );

  return {
    projects,
    loading,
    error,
    fetchProjects,
    createProject,
    updateProject,
    deleteProject,
    archiveProject,
  };
}
