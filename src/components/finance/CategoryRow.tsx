'use client';

import { formatMinor, formatCompactMinor } from '@/lib/finance/format';
import type { CategoryComparison } from '@/hooks/useFinanceSummary';

interface CategoryRowProps {
  category: CategoryComparison;
  /** Largest single-month value across the whole table, so bars share a scale. */
  scaleMinor: number;
  earlierLabel: string;
  laterLabel: string;
}

export default function CategoryRow({
  category,
  scaleMinor,
  earlierLabel,
  laterLabel,
}: CategoryRowProps) {
  const { name, icon, color, earlierMinor, laterMinor, deltaMinor, inBoth } = category;
  const width = (minor: number) => (scaleMinor > 0 ? (minor / scaleMinor) * 100 : 0);

  // Spending more is not automatically bad, so the delta is coloured by
  // direction only — red up, green down — with no verdict attached.
  const deltaColor = deltaMinor > 0 ? '#EF4444' : deltaMinor < 0 ? '#00FF88' : '#6B7280';

  return (
    <div className="border-b border-border/30 py-2.5 last:border-b-0">
      <div className="flex items-baseline gap-2">
        <span className="w-4 shrink-0 text-center font-mono text-xs" style={{ color }}>
          {icon}
        </span>
        <span className="flex-1 truncate font-mono text-sm text-text-primary">{name}</span>
        {inBoth && (
          <span
            className="shrink-0 font-mono text-[11px] tabular-nums"
            style={{ color: deltaColor }}
          >
            {deltaMinor === 0 ? '±0' : formatCompactMinor(deltaMinor)}
          </span>
        )}
      </div>

      <div className="mt-1.5 flex flex-col gap-1 pl-6">
        <MonthBar
          label={earlierLabel}
          minor={earlierMinor}
          widthPercent={width(earlierMinor)}
          color={color}
          dim
        />
        <MonthBar
          label={laterLabel}
          minor={laterMinor}
          widthPercent={width(laterMinor)}
          color={color}
        />
      </div>
    </div>
  );
}

function MonthBar({
  label,
  minor,
  widthPercent,
  color,
  dim = false,
}: {
  label: string;
  minor: number;
  widthPercent: number;
  color: string;
  dim?: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-8 shrink-0 font-mono text-[10px] uppercase tracking-wider text-text-muted/70">
        {label.slice(0, 3)}
      </span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface2">
        <div
          className="h-full rounded-full transition-all duration-500 ease-out"
          style={{
            width: `${widthPercent}%`,
            backgroundColor: color,
            opacity: dim ? 0.35 : 1,
          }}
        />
      </div>
      <span
        className={`w-24 shrink-0 text-right font-mono text-[11px] tabular-nums ${
          dim ? 'text-text-muted' : 'text-text-primary'
        }`}
      >
        {minor === 0 ? '—' : formatMinor(minor)}
      </span>
    </div>
  );
}
