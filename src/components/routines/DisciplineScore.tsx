'use client';

import { useEffect, useState } from 'react';
import type { DisciplineScore as DisciplineScoreType } from '@/lib/types';

interface DisciplineScoreProps {
  score: DisciplineScoreType;
  overallStreak: number;
}

export default function DisciplineScore({ score, overallStreak }: DisciplineScoreProps) {
  const [animatedOffset, setAnimatedOffset] = useState(251.2);

  const radius = 40;
  const circumference = 2 * Math.PI * radius;
  const targetOffset = circumference - (score.percentage / 100) * circumference;

  const arcColor =
    score.percentage === 100
      ? '#00FF88'
      : score.percentage >= 67
        ? '#00FF88'
        : score.percentage >= 34
          ? '#F59E0B'
          : '#EF4444';

  const isComplete = score.percentage === 100;

  useEffect(() => {
    // Animate on mount / score change
    const timer = setTimeout(() => setAnimatedOffset(targetOffset), 50);
    return () => clearTimeout(timer);
  }, [targetOffset]);

  return (
    <div className="flex flex-col items-center gap-2 py-4">
      <div className="relative w-[100px] h-[100px]">
        <svg
          width="100"
          height="100"
          viewBox="0 0 100 100"
          className="transform -rotate-90"
        >
          {/* Track */}
          <circle
            cx="50"
            cy="50"
            r={radius}
            fill="none"
            stroke="rgba(42, 42, 58, 0.6)"
            strokeWidth="6"
          />
          {/* Arc fill */}
          <circle
            cx="50"
            cy="50"
            r={radius}
            fill="none"
            stroke={arcColor}
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={animatedOffset}
            style={{
              transition: 'stroke-dashoffset 0.8s ease-out',
              filter: isComplete ? `drop-shadow(0 0 8px ${arcColor})` : undefined,
            }}
          />
        </svg>
        {/* Percentage centered */}
        <div className="absolute inset-0 flex items-center justify-center">
          <span
            className="font-mono text-2xl font-bold"
            style={{
              color: arcColor,
              textShadow: isComplete ? `0 0 12px ${arcColor}` : undefined,
            }}
          >
            {score.percentage}%
          </span>
        </div>
      </div>

      <span className="font-mono text-xs text-text-muted">
        {score.completed} of {score.total} completed today
      </span>

      {overallStreak > 0 && (
        <span className="font-mono text-[11px] text-accent/70">
          Streak: {overallStreak}d
        </span>
      )}
    </div>
  );
}
