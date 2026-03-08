'use client';

import { useCallback, useState } from 'react';
import { useSupabase } from '@/components/providers/SupabaseProvider';

interface Stats {
  todayCompleted: number;
  todayTotal: number;
  inboxCount: number;
  activeProjects: number;
  totalIdeas: number;
  streak: number;
}

export function useStats() {
  const { supabase, session } = useSupabase();
  const [stats, setStats] = useState<Stats>({
    todayCompleted: 0,
    todayTotal: 0,
    inboxCount: 0,
    activeProjects: 0,
    totalIdeas: 0,
    streak: 0,
  });
  const [loading, setLoading] = useState(true);

  const fetchStats = useCallback(
    async (todayTotal?: number) => {
      if (!session?.user) return;
      setLoading(true);
      try {
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const todayEnd = new Date();
        todayEnd.setHours(23, 59, 59, 999);

        // Run all count queries in parallel
        const [completedRes, inboxRes, projectsRes, ideasRes, streakRes] =
          await Promise.all([
            // 1. Tasks completed today
            supabase
              .from('tasks')
              .select('*', { count: 'exact', head: true })
              .eq('status', 'done')
              .gte('completed_at', todayStart.toISOString())
              .lte('completed_at', todayEnd.toISOString()),

            // 2. Unprocessed inbox count
            supabase
              .from('inbox')
              .select('*', { count: 'exact', head: true })
              .is('processed_at', null),

            // 3. Active projects count
            supabase
              .from('projects')
              .select('*', { count: 'exact', head: true })
              .eq('status', 'active'),

            // 4. Total ideas count
            supabase.from('ideas').select('*', { count: 'exact', head: true }),

            // 5. Streak: completed task dates
            supabase
              .from('tasks')
              .select('completed_at')
              .eq('status', 'done')
              .not('completed_at', 'is', null)
              .order('completed_at', { ascending: false })
              .limit(100),
          ]);

        // Calculate streak from completed dates
        let streak = 0;
        if (streakRes.data && streakRes.data.length > 0) {
          const uniqueDays = new Set<string>();
          for (const t of streakRes.data) {
            if (t.completed_at) {
              uniqueDays.add(new Date(t.completed_at).toLocaleDateString('en-CA'));
            }
          }
          const sortedDays = [...uniqueDays].sort().reverse();

          const today = new Date().toLocaleDateString('en-CA');
          const yesterday = new Date(Date.now() - 86400000).toLocaleDateString('en-CA');

          // Streak must start from today or yesterday
          if (sortedDays[0] === today || sortedDays[0] === yesterday) {
            let checkDate = new Date(sortedDays[0] + 'T00:00:00');
            for (const day of sortedDays) {
              if (day === checkDate.toLocaleDateString('en-CA')) {
                streak++;
                checkDate = new Date(checkDate.getTime() - 86400000);
              } else {
                break;
              }
            }
          }
        }

        setStats({
          todayCompleted: completedRes.count || 0,
          todayTotal: todayTotal ?? 0,
          inboxCount: inboxRes.count || 0,
          activeProjects: projectsRes.count || 0,
          totalIdeas: ideasRes.count || 0,
          streak,
        });
      } catch {
        // Stats are non-critical — fail silently
      } finally {
        setLoading(false);
      }
    },
    [supabase, session?.user]
  );

  return { stats, loading, fetchStats };
}
