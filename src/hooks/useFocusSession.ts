'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSupabase } from '@/components/providers/SupabaseProvider';
import type { Task, FocusSession } from '@/lib/types';

export function useFocusSession() {
  const { supabase, session } = useSupabase();
  const [activeSession, setActiveSession] = useState<FocusSession | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);
  const pausedElapsedRef = useRef<number>(0);

  // Clean up interval on unmount
  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  const startTimer = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    startTimeRef.current = Date.now();
    pausedElapsedRef.current = 0;
    setIsRunning(true);
    setIsPaused(false);

    intervalRef.current = setInterval(() => {
      const now = Date.now();
      const elapsed = Math.floor((now - startTimeRef.current) / 1000) + pausedElapsedRef.current;
      setElapsedSeconds(elapsed);
    }, 1000);
  }, []);

  const startSession = useCallback(
    async (task: Task) => {
      if (!session?.user) return;

      const startedAt = new Date().toISOString();
      const { data, error } = await supabase
        .from('focus_sessions')
        .insert({
          user_id: session.user.id,
          task_id: task.id,
          task_title: task.title,
          started_at: startedAt,
        })
        .select()
        .single();

      if (error) {
        console.error('Failed to start focus session:', error);
        return;
      }

      setActiveSession(data);
      setElapsedSeconds(0);
      startTimer();
    },
    [supabase, session, startTimer]
  );

  const pauseSession = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = null;
    pausedElapsedRef.current = elapsedSeconds;
    setIsRunning(false);
    setIsPaused(true);
  }, [elapsedSeconds]);

  const resumeSession = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    startTimeRef.current = Date.now();
    setIsRunning(true);
    setIsPaused(false);

    intervalRef.current = setInterval(() => {
      const now = Date.now();
      const elapsed = Math.floor((now - startTimeRef.current) / 1000) + pausedElapsedRef.current;
      setElapsedSeconds(elapsed);
    }, 1000);
  }, []);

  const endSession = useCallback(
    async (outcome: 'completed' | 'skipped') => {
      if (!activeSession) return;

      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = null;

      const endedAt = new Date().toISOString();
      const durationSeconds = elapsedSeconds;
      const durationMinutes = Math.ceil(durationSeconds / 60);

      // Update focus session
      await supabase
        .from('focus_sessions')
        .update({
          ended_at: endedAt,
          duration_seconds: durationSeconds,
          outcome,
        })
        .eq('id', activeSession.id);

      // If completed, mark task done and add actual minutes
      if (outcome === 'completed' && activeSession.task_id) {
        await supabase
          .from('tasks')
          .update({
            status: 'done',
            completed_at: endedAt,
            actual_minutes: durationMinutes,
          })
          .eq('id', activeSession.task_id);
      }

      setActiveSession(null);
      setElapsedSeconds(0);
      setIsRunning(false);
      setIsPaused(false);
    },
    [supabase, activeSession, elapsedSeconds]
  );

  const completeSession = useCallback(() => endSession('completed'), [endSession]);
  const skipSession = useCallback(() => endSession('skipped'), [endSession]);

  return {
    activeSession,
    elapsedSeconds,
    isRunning,
    isPaused,
    startSession,
    pauseSession,
    resumeSession,
    completeSession,
    skipSession,
  };
}
