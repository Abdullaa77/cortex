'use client';

import { useState } from 'react';
import AppShell from '@/components/layout/AppShell';
import { useIdeas } from '@/hooks/useIdeas';
import { useAreas } from '@/hooks/useAreas';
import IdeaCard from '@/components/ideas/IdeaCard';
import IdeaForm from '@/components/ideas/IdeaForm';
import LoadingState from '@/components/ui/LoadingState';
import EmptyState from '@/components/ui/EmptyState';
import type { Idea } from '@/lib/types';
import { RATING_LABELS } from '@/lib/constants';
import { Plus } from 'lucide-react';

export default function IdeasPage() {
  const { ideas, loading, rateIdea, createIdea, updateIdea } = useIdeas();
  const { areas } = useAreas();

  const [showForm, setShowForm] = useState(false);
  const [selectedIdea, setSelectedIdea] = useState<Idea | null>(null);

  const grouped = {
    3: ideas.filter((i) => i.rating === 3),
    2: ideas.filter((i) => i.rating === 2),
    1: ideas.filter((i) => i.rating === 1),
    0: ideas.filter((i) => i.rating === 0),
  };

  if (loading) {
    return <AppShell><div className="p-6"><LoadingState /></div></AppShell>;
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-3xl p-4 lg:px-10 lg:py-6 page-enter">
        {ideas.length === 0 ? (
          <EmptyState
            title="No ideas captured."
            description="Let your mind wander."
            action={{ label: '+ New Idea', onClick: () => setShowForm(true) }}
          />
        ) : (
          <>
            <div className="mb-3 mt-8 flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-[3px]" style={{ color: '#4A6858' }}>
              <span>--</span>
              <span>IDEAS VAULT</span>
              <span className="tracking-normal font-normal text-text-muted">({ideas.length})</span>
              <span className="flex-1 section-line" />
            </div>

            {([3, 2, 1, 0] as const).map((rating) => {
              const group = grouped[rating];
              if (group.length === 0) return null;
              return (
                <div key={rating}>
                  <div className="mb-2 mt-6 flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-[3px]" style={{ color: '#4A6858' }}>
                    <span>--</span>
                    <span>{RATING_LABELS[rating].toUpperCase()}</span>
                    <span className="tracking-normal font-normal text-text-muted">({group.length})</span>
                    <span className="flex-1 section-line" />
                  </div>
                  {group.map((idea) => (
                    <IdeaCard
                      key={idea.id}
                      idea={idea}
                      areas={areas}
                      onRate={rateIdea}
                      onClick={setSelectedIdea}
                    />
                  ))}
                </div>
              );
            })}
          </>
        )}

        {/* FAB */}
        <button
          onClick={() => setShowForm(true)}
          className="fixed bottom-20 right-6 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-accent text-bg shadow-lg transition-transform duration-150 hover:scale-110 lg:bottom-20"
          style={{ animation: 'pulse-glow 2s ease-in-out infinite' }}
        >
          <Plus size={24} />
        </button>
      </div>

      {showForm && (
        <IdeaForm
          onClose={() => setShowForm(false)}
          onSave={async (data) => {
            await createIdea({ ...data, area_id: data.area_id ?? undefined });
            setShowForm(false);
          }}
        />
      )}

      {selectedIdea && (
        <IdeaForm
          idea={selectedIdea}
          onClose={() => setSelectedIdea(null)}
          onSave={async (data) => {
            await updateIdea(selectedIdea.id, data);
            setSelectedIdea(null);
          }}
        />
      )}
    </AppShell>
  );
}
