'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import AppShell from '@/components/layout/AppShell';
import { useReview } from '@/hooks/useReview';
import { useTasks } from '@/hooks/useTasks';
import { useProjects } from '@/hooks/useProjects';
import { useAreas } from '@/hooks/useAreas';
import LoadingState from '@/components/ui/LoadingState';
import CelebrateStep from '@/components/review/CelebrateStep';
import ProjectsStep from '@/components/review/ProjectsStep';
import InboxStep from '@/components/review/InboxStep';
import ProgressStep from '@/components/review/ProgressStep';
import PlanStep from '@/components/review/PlanStep';

const STEP_NAMES = ['Celebrate', 'Projects', 'Inbox', 'Balance', 'Plan'];

export default function ReviewPage() {
  const router = useRouter();
  const review = useReview();
  const { togglePin, tasks } = useTasks();
  const { updateProject } = useProjects();
  const { areas } = useAreas();
  const [completing, setCompleting] = useState(false);

  const handleComplete = async () => {
    setCompleting(true);
    await review.completeReview();
    setTimeout(() => router.push('/'), 1500);
  };

  if (review.loading) {
    return (
      <AppShell>
        <div className="p-6">
          <LoadingState />
        </div>
      </AppShell>
    );
  }

  const steps = [
    <CelebrateStep
      key="celebrate"
      completedTasks={review.weekData.tasksCompletedThisWeek}
      lastReview={review.lastReview}
    />,
    <ProjectsStep
      key="projects"
      projects={review.weekData.activeProjects}
      areas={areas}
      onUpdateStatus={(id, status) => updateProject(id, { status })}
    />,
    <InboxStep key="inbox" />,
    <ProgressStep
      key="progress"
      areasWithActivity={review.weekData.areasWithActivity}
    />,
    <PlanStep
      key="plan"
      reflection={review.reflection}
      energyRating={review.energyRating}
      onReflectionChange={review.setReflection}
      onEnergyChange={review.setEnergyRating}
      tasks={tasks}
      onTogglePin={togglePin}
      onComplete={handleComplete}
      completing={completing}
    />,
  ];

  return (
    <AppShell>
      <div className="mx-auto max-w-2xl p-4 pb-8 lg:px-10 lg:py-6 page-enter">
        {/* Header */}
        <div className="mb-8 flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-[3px]" style={{ color: '#4A6858' }}>
          <span>──</span>
          <span>WEEKLY REVIEW</span>
          <span className="flex-1 section-line" />
        </div>

        {/* Progress dots */}
        <div className="mb-10">
          <div className="flex items-center justify-center gap-0">
            {STEP_NAMES.map((name, i) => (
              <div key={name} className="flex items-center">
                <button
                  onClick={() => {
                    if (i <= review.currentStep) {
                      // Allow going back to completed steps
                      while (review.currentStep > i) review.prevStep();
                    }
                  }}
                  className={`w-3 h-3 rounded-full border-2 transition-all ${
                    i < review.currentStep
                      ? 'bg-accent border-accent'
                      : i === review.currentStep
                        ? 'bg-accent border-accent shadow-[0_0_8px_rgba(0,255,136,0.5)]'
                        : 'bg-transparent border-border'
                  }`}
                />
                {i < STEP_NAMES.length - 1 && (
                  <div
                    className={`w-12 h-0.5 transition-colors ${
                      i < review.currentStep ? 'bg-accent' : 'bg-border'
                    }`}
                  />
                )}
              </div>
            ))}
          </div>
          <p className="text-center font-mono text-[10px] text-text-muted mt-3 tracking-wide">
            Step {review.currentStep + 1} of 5 — {STEP_NAMES[review.currentStep]}
          </p>
        </div>

        {/* Step content */}
        {steps[review.currentStep]}

        {/* Navigation buttons */}
        {review.currentStep < 4 && (
          <div className="flex justify-between mt-8">
            <button
              onClick={review.prevStep}
              disabled={review.currentStep === 0}
              className="px-4 py-2 font-mono text-sm text-text-muted border border-border rounded
                hover:text-text-primary hover:border-accent/20 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              ← Back
            </button>
            <button
              onClick={review.nextStep}
              className="px-4 py-2 font-mono text-sm text-accent border border-accent/30 rounded
                hover:bg-accent/10 transition-colors"
            >
              Next →
            </button>
          </div>
        )}

        {/* Completing overlay */}
        {completing && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg/90">
            <div className="text-center page-enter">
              <p className="font-mono text-xl text-accent text-glow mb-2">Review complete.</p>
              <p className="font-mono text-sm text-text-muted">Week logged.</p>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
