'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import AppShell from '@/components/layout/AppShell';
import { useRoutines } from '@/hooks/useRoutines';
import { useHabits } from '@/hooks/useHabits';
import { useDailyLog } from '@/hooks/useDailyLog';
import DisciplineScore from '@/components/routines/DisciplineScore';
import RoutineSection from '@/components/routines/RoutineSection';
import HabitItem from '@/components/routines/HabitItem';
import RoutineForm from '@/components/routines/RoutineForm';
import HabitForm from '@/components/routines/HabitForm';
import LoadingState from '@/components/ui/LoadingState';
import { Settings, ChevronLeft, ChevronRight } from 'lucide-react';

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function shiftDate(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function RoutinesPage() {
  const { routines, loading: routinesLoading, createRoutine, updateRoutine, addStep, removeStep, reorderSteps, updateStep } = useRoutines();
  const { habits, loading: habitsLoading, createHabit } = useHabits();

  const [selectedDate, setSelectedDate] = useState(todayStr());
  const isToday = selectedDate === todayStr();
  const readOnly = !isToday;

  const { entries, disciplineScore, streaks, loading: logLoading, toggleStep, toggleHabit, setHabitValue, fetchStreaks } =
    useDailyLog(routines, habits, selectedDate);

  const [showRoutineForm, setShowRoutineForm] = useState(false);
  const [showHabitForm, setShowHabitForm] = useState(false);
  const [editingRoutine, setEditingRoutine] = useState<typeof routines[0] | null>(null);
  const [showAddMenu, setShowAddMenu] = useState(false);

  // Fetch streaks once routines and habits are loaded
  useEffect(() => {
    const allSteps = routines.flatMap((r) => (r.steps || []).map((s) => ({ id: s.id, type: 'step' as const })));
    const allHabits = habits.map((h) => ({ id: h.id, type: 'habit' as const }));
    const items = [...allSteps, ...allHabits];
    if (items.length > 0) {
      fetchStreaks(items);
    }
  }, [routines, habits, fetchStreaks]);

  // Sort routines: prayers first, then by time_of_day order, then sort_order
  const sortedRoutines = useMemo(() => {
    const timeOrder = { morning: 0, afternoon: 1, evening: 2, anytime: 3 };
    return [...routines].sort((a, b) => {
      if (a.is_prayer && !b.is_prayer) return -1;
      if (!a.is_prayer && b.is_prayer) return 1;
      const ta = timeOrder[a.time_of_day] ?? 3;
      const tb = timeOrder[b.time_of_day] ?? 3;
      if (ta !== tb) return ta - tb;
      return a.sort_order - b.sort_order;
    });
  }, [routines]);

  // Split routines into before-habits and after-habits
  const morningRoutines = sortedRoutines.filter(
    (r) => r.is_prayer || r.time_of_day === 'morning' || r.time_of_day === 'afternoon'
  );
  const eveningRoutines = sortedRoutines.filter(
    (r) => !r.is_prayer && (r.time_of_day === 'evening' || r.time_of_day === 'anytime')
  );

  const loading = routinesLoading || habitsLoading || logLoading;

  if (loading && routines.length === 0) {
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
      <div className="mx-auto max-w-3xl p-4 pb-24 lg:px-10 lg:py-6 page-enter">
        {/* Page header */}
        <SectionHeader title="ROUTINES" />

        {/* Date nav */}
        <div className="flex items-center justify-center gap-3 mb-4">
          <button
            type="button"
            onClick={() => setSelectedDate(shiftDate(selectedDate, -1))}
            className="text-text-muted hover:text-text-primary transition-colors p-1"
          >
            <ChevronLeft size={16} />
          </button>
          <span className="font-mono text-xs text-text-muted">
            {isToday ? 'Today' : ''} {formatDate(selectedDate)}
          </span>
          <button
            type="button"
            onClick={() => setSelectedDate(shiftDate(selectedDate, 1))}
            disabled={isToday}
            className="text-text-muted hover:text-text-primary transition-colors p-1 disabled:opacity-20"
          >
            <ChevronRight size={16} />
          </button>
        </div>

        {/* Discipline Score */}
        <DisciplineScore score={disciplineScore} overallStreak={0} />

        {/* Morning / Prayer routines */}
        {morningRoutines.map((routine) => (
          <div key={routine.id} className="mb-4">
            <RoutineSection
              routine={routine}
              entries={entries.filter((e) =>
                (routine.steps || []).some((s) => s.id === e.routine_step_id)
              )}
              streaks={streaks}
              onToggleStep={toggleStep}
              onEdit={() => setEditingRoutine(routine)}
              readOnly={readOnly}
            />
          </div>
        ))}

        {/* Habits section */}
        {habits.length > 0 && (
          <>
            <SectionHeader title="HABITS" />
            <div className="glass rounded-lg mb-4 py-1">
              {habits.map((habit) => {
                const entry = entries.find((e) => e.habit_id === habit.id) || null;
                return (
                  <HabitItem
                    key={habit.id}
                    habit={habit}
                    entry={entry}
                    streak={streaks.get(habit.id) || 0}
                    onToggle={() => toggleHabit(habit.id)}
                    onSetValue={(v) => setHabitValue(habit.id, v)}
                    readOnly={readOnly}
                  />
                );
              })}
            </div>
          </>
        )}

        {/* Evening routines */}
        {eveningRoutines.map((routine) => (
          <div key={routine.id} className="mb-4">
            <RoutineSection
              routine={routine}
              entries={entries.filter((e) =>
                (routine.steps || []).some((s) => s.id === e.routine_step_id)
              )}
              streaks={streaks}
              onToggleStep={toggleStep}
              onEdit={() => setEditingRoutine(routine)}
              readOnly={readOnly}
            />
          </div>
        ))}

        {/* Bottom actions */}
        <div className="flex items-center justify-end gap-3 mt-6">
          <Link
            href="/routines/edit"
            className="flex items-center gap-1.5 font-mono text-xs text-text-muted hover:text-text-primary transition-colors"
          >
            <Settings size={14} />
            Edit
          </Link>
        </div>
      </div>

      {/* FAB */}
      <div className="fixed bottom-20 right-4 lg:bottom-6 lg:right-6 z-40">
        <div className="relative">
          {showAddMenu && (
            <div
              className="absolute bottom-14 right-0 glass rounded-lg py-1 min-w-[160px] animate-[modal-in_150ms_ease-out]"
            >
              <button
                type="button"
                onClick={() => { setShowAddMenu(false); setShowRoutineForm(true); }}
                className="w-full px-4 py-2.5 font-mono text-sm text-text-primary hover:bg-surface2/50 text-left transition-colors"
              >
                + New Routine
              </button>
              <button
                type="button"
                onClick={() => { setShowAddMenu(false); setShowHabitForm(true); }}
                className="w-full px-4 py-2.5 font-mono text-sm text-text-primary hover:bg-surface2/50 text-left transition-colors"
              >
                + New Habit
              </button>
            </div>
          )}
          <button
            type="button"
            onClick={() => setShowAddMenu(!showAddMenu)}
            className="flex h-12 w-12 items-center justify-center rounded-full bg-accent text-bg font-bold text-xl shadow-lg"
            style={{ animation: 'pulse-glow 2s ease-in-out infinite' }}
          >
            +
          </button>
        </div>
      </div>

      {/* Click outside to close add menu */}
      {showAddMenu && (
        <div className="fixed inset-0 z-30" onClick={() => setShowAddMenu(false)} />
      )}

      {/* Routine Form */}
      {showRoutineForm && (
        <RoutineForm
          onClose={() => setShowRoutineForm(false)}
          onSave={async (data) => {
            await createRoutine(data);
          }}
        />
      )}

      {/* Edit Routine Form */}
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

      {/* Habit Form */}
      {showHabitForm && (
        <HabitForm
          onClose={() => setShowHabitForm(false)}
          onSave={async (data) => {
            await createHabit(data);
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
