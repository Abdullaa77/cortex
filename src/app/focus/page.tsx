'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useSupabase } from '@/components/providers/SupabaseProvider';
import { useFocusSession } from '@/hooks/useFocusSession';
import { useTasks } from '@/hooks/useTasks';
import { useAreas } from '@/hooks/useAreas';
import FocusTimer from '@/components/focus/FocusTimer';
import LoadingState from '@/components/ui/LoadingState';
import Badge from '@/components/ui/Badge';
import { PRIORITY_LABELS, PRIORITY_COLORS } from '@/lib/constants';
import type { Task } from '@/lib/types';
import { Pause, Play, Check, SkipForward } from 'lucide-react';

export default function FocusPage() {
  return (
    <Suspense fallback={
      <div className="flex min-h-screen items-center justify-center bg-bg">
        <LoadingState />
      </div>
    }>
      <FocusContent />
    </Suspense>
  );
}

function FocusContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const taskId = searchParams.get('task');
  const { supabase, session } = useSupabase();
  const focus = useFocusSession();
  const { loading: tasksLoading, getTodayTasks } = useTasks();
  const { areas } = useAreas();
  const [taskData, setTaskData] = useState<Task | null>(null);
  const [loadingTask, setLoadingTask] = useState(!!taskId);
  const [sessionEnded, setSessionEnded] = useState<{ title: string; duration: number } | null>(null);

  const areaMap = useMemo(() => new Map(areas.map((a) => [a.id, a])), [areas]);

  // Load task from query param
  useEffect(() => {
    if (!taskId || !session?.user) return;

    let cancelled = false;
    supabase
      .from('tasks')
      .select('*')
      .eq('id', taskId)
      .single()
      .then(({ data }) => {
        if (cancelled) return;
        if (data) setTaskData(data);
        setLoadingTask(false);
      });
    return () => { cancelled = true; };
  }, [taskId, session?.user, supabase]);

  // Auto-start session when task is loaded
  useEffect(() => {
    if (taskData && !focus.activeSession && !sessionEnded) {
      focus.startSession(taskData);
    }
  }, [taskData, focus, sessionEnded]);

  const handleComplete = useCallback(async () => {
    const title = focus.activeSession?.task_title || '';
    const duration = focus.elapsedSeconds;
    await focus.completeSession();
    setSessionEnded({ title, duration });
    setTimeout(() => router.push('/'), 3000);
  }, [focus, router]);

  const handleSkip = useCallback(async () => {
    if (focus.elapsedSeconds > 300) {
      if (!confirm('You\'ve been focused for over 5 minutes. Skip this session?')) return;
    }
    const title = focus.activeSession?.task_title || '';
    const duration = focus.elapsedSeconds;
    await focus.skipSession();
    setSessionEnded({ title, duration });
    setTimeout(() => router.push('/'), 3000);
  }, [focus, router]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!focus.activeSession) return;
      if (e.key === ' ') {
        e.preventDefault();
        if (focus.isRunning) focus.pauseSession();
        else focus.resumeSession();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        handleComplete();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        handleSkip();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [focus, handleComplete, handleSkip]);

  const startFocusOnTask = (task: Task) => {
    setTaskData(task);
    setSessionEnded(null);
  };

  // Session ended screen
  if (sessionEnded) {
    const mins = Math.floor(sessionEnded.duration / 60);
    const secs = sessionEnded.duration % 60;
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg font-mono">
        <div className="text-center space-y-4 page-enter">
          <p className="text-xs tracking-[4px] text-accent text-glow">── SESSION COMPLETE ──</p>
          <p className="text-lg text-text-primary">
            <span className="text-accent">✓</span> {sessionEnded.title}
          </p>
          <p className="text-sm text-text-muted">
            Duration: {mins} minute{mins !== 1 ? 's' : ''} {secs} second{secs !== 1 ? 's' : ''}
          </p>
          <button
            onClick={() => router.push('/')}
            className="mt-4 px-4 py-2 text-sm text-accent border border-accent/30 rounded hover:bg-accent/10 transition-colors"
          >
            Back to Terminal
          </button>
        </div>
      </div>
    );
  }

  // Loading state
  if (loadingTask || (taskId && !taskData && !tasksLoading)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg">
        <LoadingState />
      </div>
    );
  }

  // No task selected — show task picker
  if (!taskData && !focus.activeSession) {
    const todayTasks = getTodayTasks();
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg font-mono">
        <div className="w-full max-w-lg px-4">
          <div className="text-center mb-8">
            <p className="text-xs tracking-[4px] text-accent text-glow mb-3">── FOCUS MODE ──</p>
            <p className="text-sm text-text-muted">
              <span className="text-text-primary">&gt;</span> Select a task to focus on.
            </p>
          </div>

          {tasksLoading ? (
            <LoadingState />
          ) : todayTasks.length === 0 ? (
            <div className="text-center">
              <p className="text-sm text-text-muted mb-4">No tasks available.</p>
              <button
                onClick={() => router.push('/')}
                className="px-4 py-2 text-sm text-accent border border-accent/30 rounded hover:bg-accent/10 transition-colors"
              >
                Back to Terminal
              </button>
            </div>
          ) : (
            <div className="space-y-1">
              {todayTasks
                .filter((t) => t.status === 'todo' || t.status === 'in_progress')
                .map((task) => {
                  const area = areaMap.get(task.area_id);
                  return (
                    <button
                      key={task.id}
                      type="button"
                      onClick={() => startFocusOnTask(task)}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded hover:bg-surface2/50 transition-colors text-left"
                    >
                      <Play size={14} className="text-accent shrink-0" />
                      <span className="text-sm text-text-primary flex-1 truncate">{task.title}</span>
                      {area && <Badge label={area.name} color={area.color} size="sm" />}
                    </button>
                  );
                })}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Active session
  const area = taskData ? areaMap.get(taskData.area_id) : null;

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg font-mono">
      <div className="text-center space-y-8 page-enter">
        {/* Task info */}
        <div>
          <p className="text-xl text-text-primary mb-2">{taskData?.title}</p>
          <div className="flex items-center justify-center gap-3">
            {area && <Badge label={area.name} color={area.color} size="sm" />}
            {taskData && (
              <span
                className="text-xs font-mono"
                style={{ color: PRIORITY_COLORS[taskData.priority] }}
              >
                {PRIORITY_LABELS[taskData.priority]}
              </span>
            )}
          </div>
        </div>

        {/* Timer */}
        <FocusTimer elapsedSeconds={focus.elapsedSeconds} />

        {/* Controls */}
        <div className="flex items-center justify-center gap-4">
          <button
            onClick={() => focus.isRunning ? focus.pauseSession() : focus.resumeSession()}
            className="flex items-center gap-2 px-4 py-2.5 text-sm border border-border rounded
              text-text-muted hover:text-text-primary hover:border-accent/20 transition-colors"
            title={focus.isRunning ? 'Pause (Space)' : 'Resume (Space)'}
          >
            {focus.isRunning ? <Pause size={16} /> : <Play size={16} />}
            {focus.isRunning ? 'Pause' : 'Resume'}
          </button>
          <button
            onClick={handleComplete}
            className="flex items-center gap-2 px-6 py-2.5 text-sm bg-accent/10 text-accent border border-accent/30 rounded
              hover:bg-accent/20 transition-colors"
            title="Complete (Enter)"
          >
            <Check size={16} />
            Complete
          </button>
          <button
            onClick={handleSkip}
            className="flex items-center gap-2 px-4 py-2.5 text-sm border border-border rounded
              text-text-muted hover:text-text-primary hover:border-accent/20 transition-colors"
            title="Skip (Escape)"
          >
            <SkipForward size={16} />
            Skip
          </button>
        </div>

        {/* Keyboard hints */}
        <div className="flex items-center justify-center gap-4 text-[10px] text-text-muted/50 font-mono">
          <span>Space: pause/resume</span>
          <span>Enter: complete</span>
          <span>Esc: skip</span>
        </div>
      </div>
    </div>
  );
}
