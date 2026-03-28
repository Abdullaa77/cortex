'use client';

import { useState } from 'react';
import Link from 'next/link';
import AppShell from '@/components/layout/AppShell';
import { useRoutines } from '@/hooks/useRoutines';
import { useHabits } from '@/hooks/useHabits';
import RoutineForm from '@/components/routines/RoutineForm';
import HabitForm from '@/components/routines/HabitForm';
import LoadingState from '@/components/ui/LoadingState';
import { ArrowLeft, Pencil, Trash2, ArrowUp, ArrowDown } from 'lucide-react';
import type { Routine, Habit } from '@/lib/types';

export default function EditRoutinesPage() {
  const {
    routines,
    loading: routinesLoading,
    createRoutine,
    updateRoutine,
    archiveRoutine,
    reorderRoutines,
    addStep,
    removeStep,
    reorderSteps,
    updateStep,
  } = useRoutines();
  const {
    habits,
    loading: habitsLoading,
    createHabit,
    updateHabit,
    archiveHabit,
    reorderHabits,
  } = useHabits();

  const [editingRoutine, setEditingRoutine] = useState<Routine | null>(null);
  const [editingHabit, setEditingHabit] = useState<Habit | null>(null);
  const [showRoutineForm, setShowRoutineForm] = useState(false);
  const [showHabitForm, setShowHabitForm] = useState(false);

  const loading = routinesLoading || habitsLoading;

  if (loading) {
    return (
      <AppShell>
        <div className="p-6">
          <LoadingState />
        </div>
      </AppShell>
    );
  }

  const handleRoutineMoveUp = (index: number) => {
    if (index === 0) return;
    const ids = routines.map((r) => r.id);
    [ids[index - 1], ids[index]] = [ids[index], ids[index - 1]];
    reorderRoutines(ids);
  };

  const handleRoutineMoveDown = (index: number) => {
    if (index === routines.length - 1) return;
    const ids = routines.map((r) => r.id);
    [ids[index], ids[index + 1]] = [ids[index + 1], ids[index]];
    reorderRoutines(ids);
  };

  const handleHabitMoveUp = (index: number) => {
    if (index === 0) return;
    const ids = habits.map((h) => h.id);
    [ids[index - 1], ids[index]] = [ids[index], ids[index - 1]];
    reorderHabits(ids);
  };

  const handleHabitMoveDown = (index: number) => {
    if (index === habits.length - 1) return;
    const ids = habits.map((h) => h.id);
    [ids[index], ids[index + 1]] = [ids[index + 1], ids[index]];
    reorderHabits(ids);
  };

  return (
    <AppShell>
      <div className="mx-auto max-w-3xl p-4 pb-8 lg:px-10 lg:py-6 page-enter">
        {/* Back link */}
        <Link
          href="/routines"
          className="flex items-center gap-1.5 font-mono text-xs text-text-muted hover:text-accent transition-colors mb-6"
        >
          <ArrowLeft size={14} />
          Back to Routines
        </Link>

        <SectionHeader title="MANAGE ROUTINES & HABITS" />

        {/* Routines */}
        <SectionHeader title="ROUTINES" />
        <div className="glass rounded-lg mb-4 overflow-hidden">
          {routines.map((routine, i) => (
            <div
              key={routine.id}
              className="flex items-center gap-3 px-4 py-3 border-b border-border/30 last:border-b-0 hover:bg-surface2/30 transition-colors"
            >
              {/* Reorder */}
              <div className="flex flex-col gap-0.5 shrink-0">
                <button
                  type="button"
                  onClick={() => handleRoutineMoveUp(i)}
                  disabled={i === 0}
                  className="text-text-muted hover:text-text-primary disabled:opacity-20 transition-colors"
                >
                  <ArrowUp size={10} />
                </button>
                <button
                  type="button"
                  onClick={() => handleRoutineMoveDown(i)}
                  disabled={i === routines.length - 1}
                  className="text-text-muted hover:text-text-primary disabled:opacity-20 transition-colors"
                >
                  <ArrowDown size={10} />
                </button>
              </div>

              <span className="text-sm" style={{ color: routine.color }}>{routine.icon}</span>
              <span className="font-mono text-sm text-text-primary flex-1 truncate">{routine.name}</span>
              <span className="font-mono text-[11px] text-text-muted shrink-0">
                {(routine.steps || []).length} steps
              </span>
              <button
                type="button"
                onClick={() => setEditingRoutine(routine)}
                className="text-text-muted hover:text-text-primary transition-colors p-1"
              >
                <Pencil size={12} />
              </button>
              <button
                type="button"
                onClick={() => {
                  if (confirm(`Archive "${routine.name}"?`)) archiveRoutine(routine.id);
                }}
                className="text-text-muted hover:text-red-400 transition-colors p-1"
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setShowRoutineForm(true)}
          className="font-mono text-xs text-accent hover:text-accent-dim transition-colors mb-8"
        >
          + Add Routine
        </button>

        {/* Habits */}
        <SectionHeader title="HABITS" />
        <div className="glass rounded-lg mb-4 overflow-hidden">
          {habits.map((habit, i) => (
            <div
              key={habit.id}
              className="flex items-center gap-3 px-4 py-3 border-b border-border/30 last:border-b-0 hover:bg-surface2/30 transition-colors"
            >
              {/* Reorder */}
              <div className="flex flex-col gap-0.5 shrink-0">
                <button
                  type="button"
                  onClick={() => handleHabitMoveUp(i)}
                  disabled={i === 0}
                  className="text-text-muted hover:text-text-primary disabled:opacity-20 transition-colors"
                >
                  <ArrowUp size={10} />
                </button>
                <button
                  type="button"
                  onClick={() => handleHabitMoveDown(i)}
                  disabled={i === habits.length - 1}
                  className="text-text-muted hover:text-text-primary disabled:opacity-20 transition-colors"
                >
                  <ArrowDown size={10} />
                </button>
              </div>

              <span className="text-sm" style={{ color: habit.color }}>{habit.icon}</span>
              <span className="font-mono text-sm text-text-primary flex-1 truncate">{habit.name}</span>
              <span className="font-mono text-[11px] text-text-muted shrink-0">
                {habit.track_type}
                {habit.track_type === 'number' && habit.target_value && ` ${habit.target_value} ${habit.unit || ''}`}
              </span>
              <button
                type="button"
                onClick={() => setEditingHabit(habit)}
                className="text-text-muted hover:text-text-primary transition-colors p-1"
              >
                <Pencil size={12} />
              </button>
              <button
                type="button"
                onClick={() => {
                  if (confirm(`Archive "${habit.name}"?`)) archiveHabit(habit.id);
                }}
                className="text-text-muted hover:text-red-400 transition-colors p-1"
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setShowHabitForm(true)}
          className="font-mono text-xs text-accent hover:text-accent-dim transition-colors"
        >
          + Add Habit
        </button>
      </div>

      {/* Forms */}
      {showRoutineForm && (
        <RoutineForm
          onClose={() => setShowRoutineForm(false)}
          onSave={async (data) => {
            await createRoutine(data);
          }}
        />
      )}

      {editingRoutine && (
        <RoutineForm
          routine={editingRoutine}
          onClose={() => setEditingRoutine(null)}
          onSave={async (data) => {
            await updateRoutine(editingRoutine.id, data);
          }}
          onAddStep={addStep}
          onRemoveStep={removeStep}
          onReorderSteps={reorderSteps}
          onUpdateStep={updateStep}
        />
      )}

      {showHabitForm && (
        <HabitForm
          onClose={() => setShowHabitForm(false)}
          onSave={async (data) => {
            await createHabit(data);
          }}
        />
      )}

      {editingHabit && (
        <HabitForm
          habit={editingHabit}
          onClose={() => setEditingHabit(null)}
          onSave={async (data) => {
            await updateHabit(editingHabit.id, data);
          }}
        />
      )}
    </AppShell>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <div className="mb-3 mt-6 flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-[3px]" style={{ color: '#4A6858' }}>
      <span>--</span>
      <span>{title}</span>
      <span className="flex-1 section-line" />
    </div>
  );
}
