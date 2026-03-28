'use client';

import { useState } from 'react';
import type { RoutineStep } from '@/lib/types';
import { ArrowUp, ArrowDown, X } from 'lucide-react';

interface StepManagerProps {
  routineId: string;
  steps: RoutineStep[];
  onAddStep: (routineId: string, name: string) => Promise<RoutineStep | null>;
  onRemoveStep: (stepId: string) => Promise<void>;
  onReorderSteps: (routineId: string, orderedStepIds: string[]) => Promise<void>;
  onUpdateStep: (stepId: string, data: { name?: string }) => Promise<void>;
}

export default function StepManager({
  routineId,
  steps,
  onAddStep,
  onRemoveStep,
  onReorderSteps,
  onUpdateStep,
}: StepManagerProps) {
  const [newStepName, setNewStepName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  const handleAdd = async () => {
    if (!newStepName.trim()) return;
    await onAddStep(routineId, newStepName.trim());
    setNewStepName('');
  };

  const handleMoveUp = (index: number) => {
    if (index === 0) return;
    const ids = steps.map((s) => s.id);
    [ids[index - 1], ids[index]] = [ids[index], ids[index - 1]];
    onReorderSteps(routineId, ids);
  };

  const handleMoveDown = (index: number) => {
    if (index === steps.length - 1) return;
    const ids = steps.map((s) => s.id);
    [ids[index], ids[index + 1]] = [ids[index + 1], ids[index]];
    onReorderSteps(routineId, ids);
  };

  const startEdit = (step: RoutineStep) => {
    setEditingId(step.id);
    setEditingName(step.name);
  };

  const commitEdit = () => {
    if (editingId && editingName.trim()) {
      onUpdateStep(editingId, { name: editingName.trim() });
    }
    setEditingId(null);
  };

  return (
    <div>
      <label className="block font-mono text-xs text-text-muted uppercase mb-2">Steps</label>

      <div className="flex flex-col gap-0.5 mb-3">
        {steps.map((step, i) => (
          <div
            key={step.id}
            className="flex items-center gap-2 px-2 py-1.5 rounded bg-surface2/50 border border-border/50"
          >
            {/* Reorder buttons */}
            <div className="flex flex-col gap-0.5 shrink-0">
              <button
                type="button"
                onClick={() => handleMoveUp(i)}
                disabled={i === 0}
                className="text-text-muted hover:text-text-primary disabled:opacity-20 transition-colors"
              >
                <ArrowUp size={10} />
              </button>
              <button
                type="button"
                onClick={() => handleMoveDown(i)}
                disabled={i === steps.length - 1}
                className="text-text-muted hover:text-text-primary disabled:opacity-20 transition-colors"
              >
                <ArrowDown size={10} />
              </button>
            </div>

            {/* Name (click to edit) */}
            {editingId === step.id ? (
              <input
                type="text"
                value={editingName}
                onChange={(e) => setEditingName(e.target.value)}
                onBlur={commitEdit}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitEdit();
                  if (e.key === 'Escape') setEditingId(null);
                }}
                autoFocus
                className="flex-1 px-1 py-0.5 font-mono text-sm bg-transparent border-b border-accent text-text-primary outline-none"
              />
            ) : (
              <span
                className="flex-1 font-mono text-sm text-text-primary cursor-pointer hover:text-accent transition-colors truncate"
                onClick={() => startEdit(step)}
              >
                {step.name}
              </span>
            )}

            {/* Remove */}
            <button
              type="button"
              onClick={() => onRemoveStep(step.id)}
              className="text-text-muted hover:text-red-400 transition-colors p-0.5 shrink-0"
            >
              <X size={12} />
            </button>
          </div>
        ))}
      </div>

      {/* Add step input */}
      <div className="flex gap-2">
        <input
          type="text"
          value={newStepName}
          onChange={(e) => setNewStepName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleAdd();
          }}
          placeholder="New step..."
          className="flex-1 px-3 py-1.5 font-mono text-sm bg-surface2 border border-border rounded text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:border-accent transition-colors"
        />
        <button
          type="button"
          onClick={handleAdd}
          disabled={!newStepName.trim()}
          className="px-3 py-1.5 font-mono text-xs text-accent border border-accent/30 rounded hover:bg-accent/10 transition-colors disabled:opacity-30"
        >
          + Add
        </button>
      </div>
    </div>
  );
}
