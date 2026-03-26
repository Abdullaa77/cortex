'use client';

import ReviewStep from './ReviewStep';
import type { AreaActivity } from '@/hooks/useReview';

interface ProgressStepProps {
  areasWithActivity: AreaActivity[];
}

export default function ProgressStep({ areasWithActivity }: ProgressStepProps) {
  return (
    <ReviewStep title="BALANCE">
      <p className="font-mono text-sm text-text-muted mb-6">
        Area activity this week
      </p>

      <div className="space-y-2">
        {areasWithActivity.map(({ area, tasksDone, tasksOpen }) => {
          const neglected = tasksDone === 0 && tasksOpen === 0;
          return (
            <div
              key={area.id}
              className={`flex items-center gap-3 px-3 py-2.5 rounded font-mono text-sm ${
                neglected ? 'opacity-50' : ''
              }`}
            >
              <span className="w-5 text-center shrink-0" style={{ color: area.color }}>
                {area.icon}
              </span>
              <span
                className="w-28 truncate uppercase text-xs tracking-wide shrink-0"
                style={{ color: area.color }}
              >
                {area.name}
              </span>
              <div className="flex-1 flex items-center gap-4 font-mono text-xs">
                <span className="text-accent">{tasksDone} done</span>
                <span className="text-border">│</span>
                <span className="text-text-muted">{tasksOpen} open</span>
              </div>
              {neglected && (
                <span className="text-[10px] text-yellow-500/70 font-mono shrink-0">
                  neglected
                </span>
              )}
            </div>
          );
        })}
      </div>
    </ReviewStep>
  );
}
