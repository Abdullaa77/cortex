'use client';

import { useEffect, useState } from 'react';
import AppShell from '@/components/layout/AppShell';
import { useTasks } from '@/hooks/useTasks';
import { useInbox } from '@/components/providers/InboxProvider';
import { useStats } from '@/hooks/useStats';
import { useAreas } from '@/hooks/useAreas';
import { useRoutines } from '@/hooks/useRoutines';
import { useHabits } from '@/hooks/useHabits';
import { useDailyLog } from '@/hooks/useDailyLog';
import TaskRow from '@/components/tasks/TaskRow';
import TaskDetail from '@/components/tasks/TaskDetail';
import TaskForm from '@/components/tasks/TaskForm';
import LoadingState from '@/components/ui/LoadingState';
import EmptyState from '@/components/ui/EmptyState';
import type { Task } from '@/lib/types';
import Link from 'next/link';

export default function TerminalPage() {
  const { loading: tasksLoading, completeTask, togglePin, updateTask, deleteTask, createTask, getTodayTasks } = useTasks();
  const inbox = useInbox();
  const { stats, fetchStats } = useStats();
  const { areas } = useAreas();
  const { routines } = useRoutines();
  const { habits } = useHabits();
  const { disciplineScore } = useDailyLog(routines, habits);

  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [showTaskForm, setShowTaskForm] = useState(false);

  const todayTasks = getTodayTasks();

  useEffect(() => {
    fetchStats(todayTasks.length);
  }, [fetchStats, todayTasks.length]);

  if (tasksLoading) {
    return (
      <AppShell>
        <div className="p-6">
          <LoadingState />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-3xl p-4 pb-8 lg:px-10 lg:py-6 page-enter">
        {/* TODAY section */}
        <SectionHeader title="TODAY" count={todayTasks.length > 0 ? `${stats.todayCompleted}/${todayTasks.length} done` : undefined} />

        {todayTasks.length === 0 ? (
          <EmptyState
            title="All clear."
            description="Nothing to do... or is there? Capture something."
          />
        ) : (
          <div className="mb-6 flex flex-col gap-0.5">
            {todayTasks.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                areas={areas}
                onComplete={completeTask}
                onTogglePin={togglePin}
                onStatusChange={(id, status) => updateTask(id, { status })}
                onClick={setSelectedTask}
              />
            ))}
          </div>
        )}

        {/* INBOX preview */}
        {inbox.items.length > 0 && (
          <>
            <SectionHeader title="INBOX" count={`${inbox.unprocessedCount} unprocessed`} />
            <div className="mb-6">
              {inbox.items.slice(0, 5).map((item) => (
                <div
                  key={item.id}
                  className="border-b border-border/50 px-3 py-2 font-mono text-sm text-text-muted"
                >
                  &quot;{item.raw_text}&quot;
                </div>
              ))}
              <Link
                href="/inbox"
                className="mt-2 inline-block font-mono text-xs text-accent hover:text-accent-dim transition-colors duration-150"
              >
                Process All →
              </Link>
            </div>
          </>
        )}

        {/* DISCIPLINE widget */}
        {disciplineScore.total > 0 && (
          <>
            <SectionHeader title="DISCIPLINE" />
            <div className="mb-6 flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs text-text-muted">
              <span>
                Today: <span className="text-accent">{disciplineScore.percentage}%</span>
              </span>
              <span className="text-accent/20">|</span>
              <span>
                Done: <span className="text-accent">{disciplineScore.completed}/{disciplineScore.total}</span>
              </span>
              {routines.filter((r) => r.is_prayer).length > 0 && (() => {
                const prayerRoutine = routines.find((r) => r.is_prayer);
                if (!prayerRoutine) return null;
                const prayerSteps = prayerRoutine.steps || [];
                return (
                  <>
                    <span className="text-accent/20">|</span>
                    <span>
                      Prayers: <span className="text-accent">{prayerSteps.length}/5</span>
                    </span>
                  </>
                );
              })()}
              <Link
                href="/routines"
                className="ml-auto text-accent hover:text-accent-dim transition-colors"
              >
                View Routines →
              </Link>
            </div>
          </>
        )}
        {disciplineScore.total === 0 && routines.length === 0 && (
          <>
            <SectionHeader title="DISCIPLINE" />
            <div className="mb-6">
              <Link
                href="/routines"
                className="font-mono text-xs text-accent hover:text-accent-dim transition-colors"
              >
                Set up your routines →
              </Link>
            </div>
          </>
        )}

        {/* STATS bar */}
        <SectionHeader title="STATS" />
        <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs text-text-muted">
          <span>
            Tasks: <span className="text-accent">{stats.todayCompleted}/{todayTasks.length}</span> today
          </span>
          <span className="text-accent/20">|</span>
          <span>
            Inbox: <span className="text-accent">{stats.inboxCount}</span>
          </span>
          <span className="text-accent/20">|</span>
          <span>
            Projects: <span className="text-accent">{stats.activeProjects}</span> active
          </span>
          <span className="text-accent/20">|</span>
          <span>
            Ideas: <span className="text-accent">{stats.totalIdeas}</span>
          </span>
          <span className="text-accent/20">|</span>
          <span>
            Streak: <span className="text-accent">{stats.streak}d</span>
          </span>
        </div>
      </div>

      {/* Task detail modal */}
      {selectedTask && (
        <TaskDetail
          task={selectedTask}
          isOpen={!!selectedTask}
          onClose={() => setSelectedTask(null)}
          onComplete={completeTask}
          onTogglePin={togglePin}
          onUpdate={updateTask}
          onDelete={async (id) => {
            await deleteTask(id);
            setSelectedTask(null);
          }}
          areas={areas}
        />
      )}

      {/* Task form modal */}
      {showTaskForm && (
        <TaskForm
          onClose={() => setShowTaskForm(false)}
          onSave={async (data) => {
            await createTask(data);
            setShowTaskForm(false);
          }}
        />
      )}
    </AppShell>
  );
}

function SectionHeader({ title, count }: { title: string; count?: string }) {
  return (
    <div className="mb-3 mt-8 flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-[3px]" style={{ color: '#4A6858' }}>
      <span>--</span>
      <span>{title}</span>
      {count && <span className="tracking-normal font-normal text-text-muted">({count})</span>}
      <span className="flex-1 section-line" />
    </div>
  );
}
