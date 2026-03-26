'use client';

import { useState } from 'react';
import ReviewStep from './ReviewStep';
import { Pin } from 'lucide-react';
import type { Task } from '@/lib/types';

interface PlanStepProps {
  reflection: string;
  energyRating: number | null;
  onReflectionChange: (text: string) => void;
  onEnergyChange: (rating: number) => void;
  tasks: Task[];
  onTogglePin: (id: string) => void;
  onComplete: () => void;
  completing: boolean;
}

const ENERGY_LEVELS = [
  { value: 1, icon: '▁', label: 'Exhausted' },
  { value: 2, icon: '▃', label: 'Low' },
  { value: 3, icon: '▅', label: 'Steady' },
  { value: 4, icon: '▇', label: 'Good' },
  { value: 5, icon: '█', label: 'Energized' },
];

export default function PlanStep({
  reflection,
  energyRating,
  onReflectionChange,
  onEnergyChange,
  tasks,
  onTogglePin,
  onComplete,
  completing,
}: PlanStepProps) {
  const [showConfirm, setShowConfirm] = useState(false);

  const openTasks = tasks.filter((t) => t.status === 'todo' || t.status === 'in_progress');

  return (
    <ReviewStep title="PLAN">
      {/* Energy rating */}
      <div className="mb-8">
        <p className="font-mono text-sm text-text-muted mb-3">How did this week feel?</p>
        <div className="flex gap-3">
          {ENERGY_LEVELS.map((level) => (
            <button
              key={level.value}
              onClick={() => onEnergyChange(level.value)}
              className={`flex flex-col items-center gap-1 px-3 py-2 rounded border transition-all ${
                energyRating === level.value
                  ? 'border-accent/50 bg-accent/10 text-accent text-glow-sm'
                  : 'border-border text-text-muted hover:border-accent/20'
              }`}
            >
              <span className="font-mono text-lg">{level.icon}</span>
              <span className="font-mono text-[9px] tracking-wide">{level.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Reflection */}
      <div className="mb-8">
        <p className="font-mono text-sm text-text-muted mb-3">
          What went well? What to improve?
        </p>
        <textarea
          value={reflection}
          onChange={(e) => onReflectionChange(e.target.value)}
          className="w-full bg-surface2 border border-border rounded px-3 py-2 text-text-primary font-mono text-sm
            focus:outline-none focus:border-accent/50 transition-colors min-h-[100px] resize-y"
          placeholder="Optional reflection..."
        />
      </div>

      {/* Pin tasks for next week */}
      {openTasks.length > 0 && (
        <div className="mb-8">
          <p className="font-mono text-sm text-text-muted mb-3">
            Pin your top priorities for next week
          </p>
          <div className="space-y-1 max-h-60 overflow-y-auto">
            {openTasks.map((task) => (
              <button
                key={task.id}
                type="button"
                onClick={() => onTogglePin(task.id)}
                className="w-full flex items-center gap-2 px-3 py-2 font-mono text-sm text-left rounded hover:bg-surface2/50 transition-colors"
              >
                <Pin
                  size={12}
                  className={task.is_pinned ? 'text-accent' : 'text-text-muted/30'}
                />
                <span className={task.is_pinned ? 'text-text-primary' : 'text-text-muted'}>
                  {task.title}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Complete button */}
      {!showConfirm ? (
        <button
          onClick={() => setShowConfirm(true)}
          className="w-full px-4 py-3 font-mono text-sm bg-accent/10 text-accent border border-accent/30
            rounded-lg hover:bg-accent/20 transition-colors"
        >
          Complete Review
        </button>
      ) : (
        <div className="flex gap-3">
          <button
            onClick={() => setShowConfirm(false)}
            className="flex-1 px-4 py-3 font-mono text-sm border border-border rounded-lg text-text-muted hover:text-text-primary transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onComplete}
            disabled={completing}
            className="flex-1 px-4 py-3 font-mono text-sm bg-accent text-bg font-bold rounded-lg
              hover:bg-accent-dim transition-colors disabled:opacity-50"
          >
            {completing ? 'Saving...' : 'Confirm'}
          </button>
        </div>
      )}
    </ReviewStep>
  );
}
