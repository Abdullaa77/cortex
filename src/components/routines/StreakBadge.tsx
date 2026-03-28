'use client';

interface StreakBadgeProps {
  count: number;
}

export default function StreakBadge({ count }: StreakBadgeProps) {
  if (count < 2) return null;

  const color =
    count >= 30 ? '#00FF88' : count >= 7 ? '#F59E0B' : 'var(--color-text-muted)';

  return (
    <span
      className="font-mono text-[10px] shrink-0"
      style={{ color }}
    >
      {count}d{count >= 7 ? ' \uD83D\uDD25' : ''}
    </span>
  );
}
