'use client';

import { useState } from 'react';
import type { Routine, DailyLogEntry } from '@/lib/types';
import StreakBadge from './StreakBadge';
import { Pencil } from 'lucide-react';

interface RoutineSectionProps {
  routine: Routine;
  entries: DailyLogEntry[];
  streaks: Map<string, number>;
  onToggleStep: (stepId: string) => void;
  onEdit: () => void;
  readOnly?: boolean;
}

export default function RoutineSection({
  routine,
  entries,
  streaks,
  onToggleStep,
  onEdit,
  readOnly,
}: RoutineSectionProps) {
  const [flashIds, setFlashIds] = useState<Record<string, number>>({});

  const steps = routine.steps || [];
  const completedCount = steps.filter((s) =>
    entries.some((e) => e.routine_step_id === s.id && e.completed)
  ).length;
  const allComplete = steps.length > 0 && completedCount === steps.length;

  const progressColor =
    completedCount === 0
      ? 'var(--color-text-muted)'
      : allComplete
        ? '#00FF88'
        : '#F59E0B';

  const handleToggle = (stepId: string) => {
    if (readOnly) return;
    setFlashIds((prev) => ({ ...prev, [stepId]: (prev[stepId] || 0) + 1 }));
    onToggleStep(stepId);
  };

  return (
    <div
      className="glass rounded-lg overflow-hidden transition-all duration-300"
      style={allComplete ? { borderColor: 'rgba(0, 255, 136, 0.25)', boxShadow: '0 0 20px rgba(0, 255, 136, 0.08)' } : undefined}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border/50">
        <span className="text-sm" style={{ color: routine.color }}>{routine.icon}</span>
        <span className="font-mono text-xs font-semibold uppercase tracking-wider text-text-primary flex-1">
          {routine.name}
        </span>
        <span className="font-mono text-xs" style={{ color: progressColor }}>
          {completedCount}/{steps.length}
        </span>
        {!readOnly && (
          <button
            type="button"
            onClick={onEdit}
            className="text-text-muted hover:text-text-primary transition-colors p-1 opacity-0 group-hover:opacity-100 hover:!opacity-100"
            style={{ opacity: undefined }}
          >
            <Pencil size={12} />
          </button>
        )}
      </div>

      {/* Steps */}
      <div className="py-1">
        {steps.map((step) => {
          const entry = entries.find((e) => e.routine_step_id === step.id);
          const isCompleted = entry?.completed ?? false;
          const streak = streaks.get(step.id) || 0;
          const flashKey = flashIds[step.id] || 0;

          return (
            <div
              key={step.id}
              className="flex items-center gap-3 px-4 py-2 transition-colors hover:bg-surface2/30"
              style={flashKey ? { animation: 'capture-flash 0.3s ease-out' } : undefined}
              // Re-trigger animation by using key
            >
              <button
                type="button"
                onClick={() => handleToggle(step.id)}
                disabled={readOnly}
                className="font-mono text-sm transition-colors disabled:opacity-50"
                style={{ color: isCompleted ? '#00FF88' : 'var(--color-text-muted)' }}
              >
                {isCompleted ? '\u25A0' : '\u25A1'}
              </button>
              <span
                className={`font-mono text-sm flex-1 ${isCompleted ? 'text-text-muted' : 'text-text-primary'}`}
              >
                {step.name}
              </span>
              <StreakBadge count={streak} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
