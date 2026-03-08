'use client';

interface ProgressBarProps {
  value: number;
  color?: string;
}

export default function ProgressBar({ value, color = '#00FF88' }: ProgressBarProps) {
  const clampedValue = Math.min(100, Math.max(0, value));

  return (
    <div className="w-full h-1 bg-surface2 rounded-full overflow-hidden">
      <div
        className="h-full rounded-full transition-all duration-500 ease-out"
        style={{
          width: `${clampedValue}%`,
          backgroundColor: color,
        }}
      />
    </div>
  );
}
