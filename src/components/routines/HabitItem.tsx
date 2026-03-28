'use client';

import { useState } from 'react';
import type { Habit, DailyLogEntry } from '@/lib/types';
import StreakBadge from './StreakBadge';

interface HabitItemProps {
  habit: Habit;
  entry: DailyLogEntry | null;
  streak: number;
  onToggle: () => void;
  onSetValue: (value: number) => void;
  readOnly?: boolean;
}

export default function HabitItem({ habit, entry, streak, onToggle, onSetValue, readOnly }: HabitItemProps) {
  const [flashId, setFlashId] = useState(0);

  const isCompleted = entry?.completed ?? false;
  const currentValue = entry?.value ?? 0;

  const handleToggle = () => {
    if (readOnly) return;
    setFlashId((p) => p + 1);
    onToggle();
  };

  const handleIncrement = () => {
    if (readOnly) return;
    onSetValue(currentValue + 1);
  };

  const handleDecrement = () => {
    if (readOnly) return;
    if (currentValue <= 0) return;
    onSetValue(currentValue - 1);
  };

  if (habit.track_type === 'number') {
    return (
      <div className="flex items-center gap-3 px-3 py-2.5 rounded transition-colors hover:bg-surface2/30">
        <span className="text-sm shrink-0" style={{ color: habit.color }}>{habit.icon}</span>
        <span className="font-mono text-sm text-text-primary flex-1 truncate">{habit.name}</span>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={handleDecrement}
            disabled={readOnly || currentValue <= 0}
            className="w-6 h-6 flex items-center justify-center rounded bg-surface2 border border-border text-text-muted hover:text-text-primary hover:border-accent/30 font-mono text-xs transition-colors disabled:opacity-30"
          >
            -
          </button>
          <span
            className="font-mono text-sm w-8 text-center font-semibold"
            style={{ color: isCompleted ? '#00FF88' : 'var(--color-text-primary)' }}
          >
            {currentValue}
          </span>
          <button
            type="button"
            onClick={handleIncrement}
            disabled={readOnly}
            className="w-6 h-6 flex items-center justify-center rounded bg-surface2 border border-border text-text-muted hover:text-text-primary hover:border-accent/30 font-mono text-xs transition-colors disabled:opacity-30"
          >
            +
          </button>
        </div>

        <span className="font-mono text-[11px] text-text-muted shrink-0">
          / {habit.target_value} {habit.unit}
        </span>

        <StreakBadge count={streak} />
      </div>
    );
  }

  // Checkbox habit
  return (
    <div
      className="flex items-center gap-3 px-3 py-2.5 rounded transition-colors hover:bg-surface2/30"
      style={flashId ? { animation: 'capture-flash 0.3s ease-out' } : undefined}
      key={flashId}
    >
      <span className="text-sm shrink-0" style={{ color: habit.color }}>{habit.icon}</span>
      <span
        className={`font-mono text-sm flex-1 truncate ${isCompleted ? 'text-text-muted' : 'text-text-primary'}`}
      >
        {habit.name}
      </span>

      <button
        type="button"
        onClick={handleToggle}
        disabled={readOnly}
        className="font-mono text-sm transition-colors disabled:opacity-50"
        style={{ color: isCompleted ? '#00FF88' : 'var(--color-text-muted)' }}
      >
        {isCompleted ? '\u25A0' : '\u25A1'}
      </button>

      <StreakBadge count={streak} />
    </div>
  );
}
