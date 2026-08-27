'use client';

import { formatMinor, formatCompactMinor } from '@/lib/finance/format';
import type { MonthTotals } from '@/hooks/useFinanceSummary';

interface MonthTotalsHeaderProps {
  /** One month, or two when comparing — oldest first. */
  months: MonthTotals[];
}

/**
 * Spend for the month up top, with the everyday floor underneath it.
 *
 * The floor is the point of the whole screen: total spend swings with whatever
 * one-off landed that month, but groceries + transport + eating out is what
 * life actually costs, and that is the number worth watching.
 *
 * One month is the ordinary case now, so it gets the full-width treatment
 * rather than a note about needing a second month. Two months is the compare
 * toggle, and only then is a delta an honest thing to print.
 */
export default function MonthTotalsHeader({ months }: MonthTotalsHeaderProps) {
  if (months.length === 0) return null;

  const earlier = months[0];
  const later = months.length > 1 ? months[1] : undefined;

  if (!later) return <SingleMonth month={earlier} />;

  const spendDelta = later.spendMinor - earlier.spendMinor;
  const coreDelta = later.coreMinor - earlier.coreMinor;
  const corePercent =
    earlier.coreMinor > 0
      ? Math.round((Math.abs(coreDelta) / earlier.coreMinor) * 1000) / 10
      : 0;

  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4">
      <Panel month={earlier} dim />
      <Panel month={later} deltaMinor={spendDelta} />

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
    </div>
  );
}

function SingleMonth({ month }: { month: MonthTotals }) {
  const floorShare =
    month.spendMinor > 0 ? Math.round((month.coreMinor / month.spendMinor) * 100) : 0;

  return (
    <div className="rounded-lg border border-accent/20 bg-surface/70 p-3">
      <p className="font-mono text-[10px] uppercase tracking-[2px] text-text-muted">
        {month.label}
      </p>
      <p className="mt-1 font-mono text-2xl tabular-nums text-accent text-glow-sm">
        {formatMinor(month.spendMinor)}
      </p>
      <p className="mt-0.5 font-mono text-[10px] text-text-muted/70">
        spent · {month.txnCount} entries
      </p>

      <div className="mt-2.5 flex flex-wrap items-baseline gap-x-2 gap-y-1 border-t border-border/40 pt-2.5">
        <span className="font-mono text-[10px] uppercase tracking-[2px] text-text-muted">
          Everyday floor
        </span>
        <span className="font-mono text-sm tabular-nums text-text-primary">
          {formatMinor(month.coreMinor)}
        </span>
        <span className="font-mono text-[10px] text-text-muted/60">
          {floorShare}% of the month · groceries, transport, eating out
        </span>
      </div>
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
