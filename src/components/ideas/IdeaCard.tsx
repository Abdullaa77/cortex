'use client';

import Badge from '@/components/ui/Badge';
import type { Idea, Area } from '@/lib/types';

interface IdeaCardProps {
  idea: Idea;
  onRate: (id: string, rating: 0 | 1 | 2 | 3) => void;
  onClick: (idea: Idea) => void;
  areas?: Area[];
}

function StarRating({
  rating,
  onRate,
}: {
  rating: 0 | 1 | 2 | 3;
  onRate: (rating: 0 | 1 | 2 | 3) => void;
}) {
  return (
    <div className="flex items-center gap-0.5 shrink-0">
      {([1, 2, 3] as const).map((star) => (
        <button
          key={star}
          onClick={(e) => {
            e.stopPropagation();
            onRate(star === rating ? 0 : star);
          }}
          className="text-sm transition-colors duration-150 hover:scale-110 p-0.5"
          title={`Rate ${star === rating ? 0 : star}`}
        >
          {star <= rating ? (
            <span className="text-yellow-400">{'\u2605'}</span>
          ) : (
            <span className="text-text-muted">{'\u2606'}</span>
          )}
        </button>
      ))}
    </div>
  );
}

export default function IdeaCard({ idea, onRate, onClick, areas }: IdeaCardProps) {
  const area = areas?.find((a) => a.id === idea.area_id);
  const bodyPreview = idea.body
    ? idea.body.length > 80
      ? idea.body.slice(0, 80) + '...'
      : idea.body
    : null;

  return (
    <div
      onClick={() => onClick(idea)}
      className="p-3 border-b border-border hover:bg-surface2/50 transition-colors duration-150 cursor-pointer group"
    >
      <div className="flex items-center gap-2">
        <StarRating
          rating={idea.rating}
          onRate={(r) => onRate(idea.id, r)}
        />

        <span className="font-mono text-text-primary text-sm truncate flex-1">
          {idea.title}
        </span>

        {area && (
          <Badge label={area.name} color={area.color} size="sm" />
        )}
      </div>

      {bodyPreview && (
        <p className="text-text-muted text-sm font-sans mt-1 ml-[calc(3*1.25rem+0.375rem)] truncate">
          {bodyPreview}
        </p>
      )}
    </div>
  );
}
