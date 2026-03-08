'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSupabase } from '@/components/providers/SupabaseProvider';
import type { InboxItem } from '@/lib/types';

export function useInbox() {
  const { supabase, session } = useSupabase();
  const [items, setItems] = useState<InboxItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const unprocessedCount = items.length;

  const fetchInbox = useCallback(async () => {
    if (!session?.user) return;
    setLoading(true);
    try {
      const { data, error: err } = await supabase
        .from('inbox')
        .select('*')
        .is('processed_at', null)
        .order('created_at', { ascending: false });
      if (err) throw err;
      setItems(data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch inbox');
    } finally {
      setLoading(false);
    }
  }, [supabase, session?.user]);

  useEffect(() => {
    fetchInbox();
  }, [fetchInbox]);

  const capture = useCallback(
    async (rawText: string): Promise<InboxItem | null> => {
      if (!session?.user) return null;
      const optimistic: InboxItem = {
        id: crypto.randomUUID(),
        user_id: session.user.id,
        raw_text: rawText,
        source: 'quick_capture',
        created_at: new Date().toISOString(),
        processed_at: null,
        processed_to: null,
        processed_ref_id: null,
      };
      const prev = [...items];
      setItems([optimistic, ...items]);

      try {
        const { data: created, error: err } = await supabase
          .from('inbox')
          .insert({ raw_text: rawText, source: 'quick_capture' })
          .select()
          .single();
        if (err) throw err;
        setItems((curr) => curr.map((i) => (i.id === optimistic.id ? created : i)));
        return created;
      } catch (err) {
        setItems(prev);
        setError(err instanceof Error ? err.message : 'Failed to capture');
        return null;
      }
    },
    [supabase, session?.user, items]
  );

  const processToTask = useCallback(
    async (
      inboxId: string,
      taskData: {
        title: string;
        area_id: string;
        priority?: number;
        project_id?: string;
        due_date?: string;
      }
    ) => {
      const prev = [...items];
      const item = items.find((i) => i.id === inboxId);
      setItems(items.filter((i) => i.id !== inboxId));

      try {
        // Default priority to 1 if raw_text starts with "!"
        const priority = taskData.priority ?? (item?.raw_text.startsWith('!') ? 1 : 3);

        const { data: task, error: taskErr } = await supabase
          .from('tasks')
          .insert({
            title: taskData.title,
            area_id: taskData.area_id,
            priority,
            project_id: taskData.project_id || null,
            due_date: taskData.due_date || null,
          })
          .select()
          .single();
        if (taskErr) throw taskErr;

        const { error: updateErr } = await supabase
          .from('inbox')
          .update({
            processed_at: new Date().toISOString(),
            processed_to: 'task',
            processed_ref_id: task.id,
          })
          .eq('id', inboxId);
        if (updateErr) throw updateErr;
      } catch (err) {
        setItems(prev);
        setError(err instanceof Error ? err.message : 'Failed to process to task');
      }
    },
    [supabase, items]
  );

  const processToIdea = useCallback(
    async (
      inboxId: string,
      ideaData: { title: string; area_id?: string; body?: string }
    ) => {
      const prev = [...items];
      setItems(items.filter((i) => i.id !== inboxId));

      try {
        const { data: idea, error: ideaErr } = await supabase
          .from('ideas')
          .insert({
            title: ideaData.title,
            area_id: ideaData.area_id || null,
            body: ideaData.body || '',
          })
          .select()
          .single();
        if (ideaErr) throw ideaErr;

        const { error: updateErr } = await supabase
          .from('inbox')
          .update({
            processed_at: new Date().toISOString(),
            processed_to: 'idea',
            processed_ref_id: idea.id,
          })
          .eq('id', inboxId);
        if (updateErr) throw updateErr;
      } catch (err) {
        setItems(prev);
        setError(err instanceof Error ? err.message : 'Failed to process to idea');
      }
    },
    [supabase, items]
  );

  const processToProject = useCallback(
    async (
      inboxId: string,
      projectData: { title: string; area_id: string; description?: string }
    ) => {
      const prev = [...items];
      setItems(items.filter((i) => i.id !== inboxId));

      try {
        const { data: project, error: projErr } = await supabase
          .from('projects')
          .insert({
            title: projectData.title,
            area_id: projectData.area_id,
            description: projectData.description || '',
          })
          .select()
          .single();
        if (projErr) throw projErr;

        const { error: updateErr } = await supabase
          .from('inbox')
          .update({
            processed_at: new Date().toISOString(),
            processed_to: 'project',
            processed_ref_id: project.id,
          })
          .eq('id', inboxId);
        if (updateErr) throw updateErr;
      } catch (err) {
        setItems(prev);
        setError(err instanceof Error ? err.message : 'Failed to process to project');
      }
    },
    [supabase, items]
  );

  const trash = useCallback(
    async (inboxId: string) => {
      const prev = [...items];
      setItems(items.filter((i) => i.id !== inboxId));

      const { error: err } = await supabase
        .from('inbox')
        .update({
          processed_at: new Date().toISOString(),
          processed_to: 'trashed',
        })
        .eq('id', inboxId);
      if (err) {
        setItems(prev);
        setError(err.message);
      }
    },
    [supabase, items]
  );

  return {
    items,
    loading,
    error,
    unprocessedCount,
    fetchInbox,
    capture,
    processToTask,
    processToIdea,
    processToProject,
    trash,
  };
}
