'use client';

import ReviewStep from './ReviewStep';
import type { Task, WeeklyReview } from '@/lib/types';

interface CelebrateStepProps {
  completedTasks: Task[];
  lastReview: WeeklyReview | null;
}

export default function CelebrateStep({ completedTasks, lastReview }: CelebrateStepProps) {
  const count = completedTasks.length;
  const lastCount = lastReview?.tasks_completed ?? null;
  const diff = lastCount !== null ? count - lastCount : null;

  return (
    <ReviewStep title="CELEBRATE">
      <div className="text-center mb-8">
        <p className="font-mono text-text-muted text-sm mb-2">You completed</p>
        <p className="font-mono text-5xl font-bold text-accent text-glow mb-2">
          {count}
        </p>
        <p className="font-mono text-text-muted text-sm">
          {count === 1 ? 'task' : 'tasks'} this week
        </p>
        {diff !== null && diff !== 0 && (
          <p className="font-mono text-xs text-text-muted mt-2">
            That&apos;s {Math.abs(diff)} {Math.abs(diff) === 1 ? 'task' : 'tasks'}{' '}
            {diff > 0 ? 'more' : 'fewer'} than last week
          </p>
        )}
      </div>

      {count === 0 ? (
        <p className="font-mono text-sm text-text-muted text-center">
          No tasks completed. That&apos;s okay — this review is a fresh start.
        </p>
      ) : (
        <div className="space-y-1 max-h-80 overflow-y-auto">
          {completedTasks.slice(0, 10).map((task) => (
            <div
              key={task.id}
              className="flex items-center gap-2 px-3 py-2 font-mono text-sm text-text-muted"
            >
              <span className="text-accent">■</span>
              <span className="truncate">{task.title}</span>
            </div>
          ))}
          {completedTasks.length > 10 && (
            <p className="text-center text-xs text-text-muted font-mono mt-2">
              +{completedTasks.length - 10} more
            </p>
          )}
        </div>
      )}
    </ReviewStep>
  );
}
