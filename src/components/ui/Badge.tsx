'use client';

interface BadgeProps {
  label: string;
  color: string;
  size?: 'sm' | 'md';
}

export default function Badge({ label, color, size = 'sm' }: BadgeProps) {
  const sizeClasses = size === 'sm'
    ? 'px-2 py-0.5 text-xs'
    : 'px-3 py-1 text-sm';

  return (
    <span
      className={`inline-flex items-center font-mono font-medium rounded-full ${sizeClasses}`}
      style={{
        backgroundColor: `${color}33`,
        color: color,
      }}
    >
      {label}
    </span>
  );
}
