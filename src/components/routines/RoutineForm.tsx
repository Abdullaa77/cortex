'use client';

import { useState } from 'react';
import type { Routine, RoutineStep } from '@/lib/types';
import Modal from '@/components/ui/Modal';
import StepManager from './StepManager';

const PRESET_COLORS = ['#00FF88', '#F59E0B', '#8B5CF6', '#EF4444', '#06B6D4', '#D4AF37', '#EC4899', '#10B981'];
const TIME_OPTIONS = ['morning', 'afternoon', 'evening', 'anytime'] as const;

interface RoutineFormProps {
  routine?: Routine;
  onClose: () => void;
  onSave: (data: { name: string; icon?: string; color?: string; time_of_day?: Routine['time_of_day'] }) => Promise<void>;
  // Step management (only when editing)
  onAddStep?: (routineId: string, name: string) => Promise<RoutineStep | null>;
  onRemoveStep?: (stepId: string) => Promise<void>;
  onReorderSteps?: (routineId: string, orderedStepIds: string[]) => Promise<void>;
  onUpdateStep?: (stepId: string, data: { name?: string }) => Promise<void>;
}

export default function RoutineForm({
  routine,
  onClose,
  onSave,
  onAddStep,
  onRemoveStep,
  onReorderSteps,
  onUpdateStep,
}: RoutineFormProps) {
  const [name, setName] = useState(routine?.name || '');
  const [icon, setIcon] = useState(routine?.icon || '\u25C9');
  const [color, setColor] = useState(routine?.color || '#00FF88');
  const [timeOfDay, setTimeOfDay] = useState<Routine['time_of_day']>(routine?.time_of_day || 'anytime');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await onSave({ name: name.trim(), icon, color, time_of_day: timeOfDay });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const footer = (
    <div className="flex justify-end gap-3">
      <button
        onClick={onClose}
        className="px-4 py-2 font-mono text-sm text-text-muted hover:text-text-primary transition-colors"
      >
        Cancel
      </button>
      <button
        onClick={handleSubmit}
        disabled={!name.trim() || saving}
        className="px-4 py-2 font-mono text-sm rounded bg-accent text-bg font-semibold hover:bg-accent-dim transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {saving ? 'Saving...' : routine ? 'Update' : 'Create'}
      </button>
    </div>
  );

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={routine ? '\u2500\u2500 EDIT ROUTINE' : '\u2500\u2500 NEW ROUTINE'}
      footer={footer}
    >
      <div className="flex flex-col gap-4">
        {/* Name */}
        <div>
          <label className="block font-mono text-xs text-text-muted uppercase mb-1">Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            placeholder="Routine name..."
            className="w-full px-3 py-2 font-mono text-sm bg-surface2 border border-border rounded text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:border-accent transition-colors"
          />
        </div>

        {/* Icon */}
        <div>
          <label className="block font-mono text-xs text-text-muted uppercase mb-1">Icon</label>
          <input
            type="text"
            value={icon}
            onChange={(e) => setIcon(e.target.value)}
            className="w-16 px-3 py-2 font-mono text-sm bg-surface2 border border-border rounded text-text-primary text-center focus:outline-none focus:border-accent transition-colors"
          />
        </div>

        {/* Color */}
        <div>
          <label className="block font-mono text-xs text-text-muted uppercase mb-1">Color</label>
          <div className="flex gap-2">
            {PRESET_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                className="w-7 h-7 rounded-full border-2 transition-all"
                style={{
                  backgroundColor: c,
                  borderColor: color === c ? '#fff' : 'transparent',
                  boxShadow: color === c ? `0 0 8px ${c}` : undefined,
                }}
              />
            ))}
          </div>
        </div>

        {/* Time of Day */}
        <div>
          <label className="block font-mono text-xs text-text-muted uppercase mb-1">Time of Day</label>
          <div className="flex gap-2">
            {TIME_OPTIONS.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTimeOfDay(t)}
                className={`px-3 py-1.5 font-mono text-xs rounded border transition-all ${
                  timeOfDay === t
                    ? 'border-accent bg-accent/10 text-accent'
                    : 'border-border text-text-muted hover:border-accent/30'
                }`}
              >
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* Step Manager (edit mode only) */}
        {routine && onAddStep && onRemoveStep && onReorderSteps && onUpdateStep && (
          <div className="pt-2 border-t border-border">
            <StepManager
              routineId={routine.id}
              steps={routine.steps || []}
              onAddStep={onAddStep}
              onRemoveStep={onRemoveStep}
              onReorderSteps={onReorderSteps}
              onUpdateStep={onUpdateStep}
            />
          </div>
        )}
      </div>
    </Modal>
  );
}
