'use client';

import { formatMinor } from '@/lib/finance/format';
import type { CategorySlice } from '@/lib/finance/summarize';

interface MonthCategoryListProps {
  slices: CategorySlice[];
  onSelect: (slug: string) => void;
}

/**
 * One month's spending, largest first, each bar a share of the month.
 *
 * The two-month view scales its bars against the largest single-month figure
 * so the two columns are comparable. Here there is only one month, so the bar
 * means share of it — which is the question a single month actually raises.
 *
 * Every row opens the transactions behind it. A figure you cannot get behind
 * is a figure you end up not trusting.
 */
export default function MonthCategoryList({ slices, onSelect }: MonthCategoryListProps) {
  if (slices.length === 0) return null;
  const largest = slices[0].minor || 1;

  return (
    <div className="rounded-lg border border-border/50 bg-surface/20 px-3">
      {slices.map((slice) => (
        <button
          key={slice.slug}
          type="button"
          onClick={() => onSelect(slice.slug)}
          className="-mx-2 flex w-[calc(100%+1rem)] flex-col gap-1.5 border-b border-border/30
            px-2 py-2.5 text-left transition-colors last:border-b-0 hover:bg-surface2/50"
        >
          <div className="flex items-baseline gap-2">
            <span
              className="w-4 shrink-0 text-center font-mono text-xs"
              style={{ color: slice.color }}
            >
              {slice.icon}
            </span>
            <span className="min-w-0 flex-1 truncate font-mono text-sm text-text-primary">
              {slice.name}
            </span>
            <span className="shrink-0 font-mono text-[11px] tabular-nums text-text-muted/70">
              {Math.round(slice.share * 100)}%
            </span>
            <span className="w-24 shrink-0 text-right font-mono text-[11px] tabular-nums text-text-primary">
              {formatMinor(slice.minor)}
            </span>
          </div>

          <div className="ml-6 h-1.5 overflow-hidden rounded-full bg-surface2">
            <div
              className="h-full rounded-full transition-all duration-500 ease-out"
              style={{
                width: `${(slice.minor / largest) * 100}%`,
                backgroundColor: slice.color,
              }}
            />
          </div>
        </button>
      ))}
    </div>
  );
}
