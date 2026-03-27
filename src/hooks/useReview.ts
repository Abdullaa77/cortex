'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSupabase } from '@/components/providers/SupabaseProvider';
import type { Task, Project, Area, WeeklyReview } from '@/lib/types';

export interface AreaActivity {
  area: Area;
  tasksDone: number;
  tasksOpen: number;
}

export interface WeekData {
  tasksCompletedThisWeek: Task[];
  tasksCreatedThisWeek: number;
  activeProjects: Project[];
  inboxCount: number;
  ideasThisWeek: number;
  areasWithActivity: AreaActivity[];
}

function getMonday(d: Date): Date {
  const date = new Date(d);
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1);
  date.setDate(diff);
  date.setHours(0, 0, 0, 0);
  return date;
}

export function useReview() {
  const { supabase, session } = useSupabase();
  const [currentStep, setCurrentStep] = useState(0);
  const [weekData, setWeekData] = useState<WeekData>({
    tasksCompletedThisWeek: [],
    tasksCreatedThisWeek: 0,
    activeProjects: [],
    inboxCount: 0,
    ideasThisWeek: 0,
    areasWithActivity: [],
  });
  const [reflection, setReflection] = useState('');
  const [energyRating, setEnergyRating] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastReview, setLastReview] = useState<WeeklyReview | null>(null);

  const fetchWeekData = useCallback(async () => {
    if (!session?.user) return;
    setLoading(true);
    setError(null);

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    try {
      const [
        completedRes,
        createdRes,
        projectsRes,
        inboxRes,
        ideasRes,
        areasRes,
        allTasksRes,
        lastReviewRes,
      ] = await Promise.all([
        // Tasks completed this week
        supabase
          .from('tasks')
          .select('*')
          .eq('status', 'done')
          .gte('completed_at', sevenDaysAgo)
          .order('completed_at', { ascending: false }),
        // Tasks created this week
        supabase
          .from('tasks')
          .select('id', { count: 'exact', head: true })
          .gte('created_at', sevenDaysAgo),
        // Active projects
        supabase
          .from('projects')
          .select('*')
          .in('status', ['active', 'paused'])
          .order('priority'),
        // Unprocessed inbox count
        supabase
          .from('inbox')
          .select('id', { count: 'exact', head: true })
          .is('processed_at', null),
        // Ideas created this week
        supabase
          .from('ideas')
          .select('id', { count: 'exact', head: true })
          .gte('created_at', sevenDaysAgo),
        // Areas
        supabase
          .from('areas')
          .select('*')
          .eq('is_archived', false)
          .order('sort_order'),
        // All active tasks for area balance
        supabase
          .from('tasks')
          .select('area_id, status')
          .in('status', ['todo', 'in_progress', 'done'])
          .gte('updated_at', sevenDaysAgo),
        // Last review
        supabase
          .from('weekly_reviews')
          .select('*')
          .order('week_start', { ascending: false })
          .limit(1),
      ]);

      const areas = areasRes.data || [];
      const allTasks = allTasksRes.data || [];

      // Build area activity map
      const activityMap = new Map<string, { done: number; open: number }>();
      for (const a of areas) {
        activityMap.set(a.id, { done: 0, open: 0 });
      }
      for (const t of allTasks) {
        const entry = activityMap.get(t.area_id);
        if (!entry) continue;
        if (t.status === 'done') entry.done++;
        else entry.open++;
      }

      const areasWithActivity: AreaActivity[] = areas.map((area) => ({
        area,
        tasksDone: activityMap.get(area.id)?.done || 0,
        tasksOpen: activityMap.get(area.id)?.open || 0,
      }));

      setWeekData({
        tasksCompletedThisWeek: completedRes.data || [],
        tasksCreatedThisWeek: createdRes.count || 0,
        activeProjects: projectsRes.data || [],
        inboxCount: inboxRes.count || 0,
        ideasThisWeek: ideasRes.count || 0,
        areasWithActivity,
      });

      if (lastReviewRes.error) {
        console.warn('weekly_reviews query failed:', lastReviewRes.error.message);
      } else {
        setLastReview(lastReviewRes.data?.[0] || null);
      }
    } catch (err) {
      console.error('Failed to fetch review data:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch review data');
    } finally {
      setLoading(false);
    }
  }, [supabase, session?.user]);

  useEffect(() => {
    fetchWeekData();
  }, [fetchWeekData]);

  const nextStep = () => setCurrentStep((s) => Math.min(s + 1, 4));
  const prevStep = () => setCurrentStep((s) => Math.max(s - 1, 0));

  const completeReview = useCallback(async () => {
    if (!session?.user) return;

    const monday = getMonday(new Date());
    const weekStart = `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`;

    await supabase.from('weekly_reviews').insert({
      user_id: session.user.id,
      week_start: weekStart,
      tasks_completed: weekData.tasksCompletedThisWeek.length,
      tasks_created: weekData.tasksCreatedThisWeek,
      projects_reviewed: weekData.activeProjects.length,
      inbox_processed: 0,
      ideas_captured: weekData.ideasThisWeek,
      reflection,
      energy_rating: energyRating,
    });
  }, [supabase, session?.user, weekData, reflection, energyRating]);

  const thisMonday = getMonday(new Date());
  const hasReviewedThisWeek =
    lastReview?.week_start === thisMonday.toISOString().slice(0, 10) ||
    (lastReview?.week_start
      ? getMonday(new Date(lastReview.week_start)).getTime() === thisMonday.getTime()
      : false);

  return {
    currentStep,
    weekData,
    reflection,
    energyRating,
    loading,
    error,
    lastReview,
    hasReviewedThisWeek,
    fetchWeekData,
    nextStep,
    prevStep,
    setReflection,
    setEnergyRating,
    completeReview,
  };
}
