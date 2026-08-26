'use client';

import { formatMinor, formatCompactMinor } from '@/lib/finance/format';
import type { MonthTotals } from '@/hooks/useFinanceSummary';

interface MonthTotalsHeaderProps {
  months: MonthTotals[];
}

/**
 * Spend per month up top, plus the everyday floor underneath it.
 *
 * The floor is the point of the whole screen: total spend swings with whatever
 * one-off landed that month, but groceries + transport + eating out is what
 * life actually costs, and that is the number worth watching.
 */
export default function MonthTotalsHeader({ months }: MonthTotalsHeaderProps) {
  const earlier = months[0];
  const later = months.length > 1 ? months[1] : undefined;

  const spendDelta = later ? later.spendMinor - earlier.spendMinor : 0;
  const coreDelta = later ? later.coreMinor - earlier.coreMinor : 0;
  const corePercent =
    later && earlier.coreMinor > 0
      ? Math.round((Math.abs(coreDelta) / earlier.coreMinor) * 1000) / 10
      : 0;

  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4">
      <Panel month={earlier} dim />
      {later ? (
        <Panel month={later} deltaMinor={spendDelta} />
      ) : (
        <div className="rounded-lg border border-dashed border-border/60 p-3">
          <p className="font-mono text-[11px] text-text-muted">
            Only one month of data. A second month is what makes a one-off
            readable as a spike.
          </p>
        </div>
      )}

      {later && (
        <div className="col-span-2 rounded-lg border border-accent/15 bg-accent/[0.03] px-3 py-2.5">
          <p className="font-mono text-[10px] uppercase tracking-[2px] text-text-muted">
            Everyday floor — groceries, transport, eating out
          </p>
          <div className="mt-1.5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="font-mono text-sm tabular-nums text-text-muted">
              {formatMinor(earlier.coreMinor)}
            </span>
            <span className="text-accent/30">→</span>
            <span className="font-mono text-sm tabular-nums text-accent text-glow-sm">
              {formatMinor(later.coreMinor)}
            </span>
            <span
              className="font-mono text-[11px] tabular-nums"
              style={{ color: coreDelta > 0 ? '#EF4444' : '#00FF88' }}
            >
              {formatCompactMinor(coreDelta)}
              {corePercent > 0 && ` · ${coreDelta > 0 ? '+' : '-'}${corePercent}%`}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function Panel({
  month,
  deltaMinor,
  dim = false,
}: {
  month: MonthTotals;
  deltaMinor?: number;
  dim?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border p-3 ${
        dim ? 'border-border/60 bg-surface/40' : 'border-accent/20 bg-surface/70'
      }`}
    >
      <p className="font-mono text-[10px] uppercase tracking-[2px] text-text-muted">
        {month.label}
      </p>
      <p
        className={`mt-1 font-mono text-lg tabular-nums sm:text-xl ${
          dim ? 'text-text-muted' : 'text-accent text-glow-sm'
        }`}
      >
        {formatMinor(month.spendMinor)}
      </p>
      <p className="mt-0.5 font-mono text-[10px] text-text-muted/70">
        spent · {month.txnCount} entries
      </p>
      {deltaMinor !== undefined && deltaMinor !== 0 && (
        <p
          className="mt-1 font-mono text-[11px] tabular-nums"
          style={{ color: deltaMinor > 0 ? '#EF4444' : '#00FF88' }}
        >
          {formatCompactMinor(deltaMinor)} vs prev
        </p>
      )}
    </div>
  );
}
