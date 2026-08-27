'use client';

import { formatMinor } from '@/lib/finance/format';
import type { MonthLedger } from '@/lib/finance/reconcile';
import { AlertCircle } from 'lucide-react';

interface ReconcileBlockProps {
  /** The months on screen — one, or two when comparing. */
  ledgers: MonthLedger[];
}

/**
 * Opening, what moved, closing.
 *
 * Transfers are excluded from spending everywhere else, which leaves a gap
 * between what came in and what went out. Showing the moved money explicitly
 * is what stops that gap reading as a bug in the app.
 *
 * The line that matters is the last one. A month does not start from nothing,
 * and until the opening was carried in from the month before, this block could
 * only show a net change — true, and unable to say whether it was possible.
 */
export default function ReconcileBlock({ ledgers }: ReconcileBlockProps) {
  if (ledgers.length === 0) return null;

  const known = ledgers[0].openingMinor !== null;
  const impossible = ledgers.filter((l) => l.impossible);

  const lines: {
    label: string;
    hint?: string;
    value: (l: MonthLedger) => number;
    color: string;
  }[] = [
    { label: 'Income', value: (l) => l.incomeMinor, color: '#00FF88' },
    { label: 'Spent', value: (l) => -l.spendMinor, color: '#EF4444' },
    {
      label: 'Moved in',
      hint: 'debt taken, money returned',
      value: (l) => l.transferInMinor,
      color: '#6B7280',
    },
    {
      label: 'Moved out',
      hint: 'lent, repaid, changed form',
      value: (l) => -l.transferOutMinor,
      color: '#6B7280',
    },
  ];

  return (
    <div className="rounded-lg border border-border/60 bg-surface/30 p-3">
      <div className="grid grid-cols-[1fr_auto_auto] gap-x-3 gap-y-2 sm:gap-x-5">
        <span />
        {ledgers.map((l) => (
          <span
            key={l.key}
            className="text-right font-mono text-[10px] uppercase tracking-wider text-text-muted"
          >
            {l.label.slice(0, 3)}
          </span>
        ))}

        {known && (
          <>
            <div className="font-mono text-xs text-text-muted">
              Opening
              <span className="ml-1.5 text-[10px] text-text-muted/50">
                carried from the month before
              </span>
            </div>
            {ledgers.map((l) => (
              <span
                key={l.key}
                className="text-right font-mono text-xs tabular-nums text-text-muted"
              >
                {formatMinor(l.openingMinor!)}
              </span>
            ))}
            <span className="col-span-3 my-0.5 section-line" />
          </>
        )}

        {lines.map((line) => (
          <Row key={line.label} line={line} ledgers={ledgers} />
        ))}

        <span className="col-span-3 my-0.5 section-line" />

        <div className="font-mono text-xs text-text-primary">
          {known ? 'Closing' : 'Net change'}
          <span className="ml-1.5 text-[10px] text-text-muted/60">
            {known ? 'what was left' : 'what the balance did'}
          </span>
        </div>
        {ledgers.map((l) => {
          const value = known ? l.closingMinor! : l.netMinor;
          return (
            <span
              key={l.key}
              className="text-right font-mono text-xs tabular-nums"
              style={{ color: value >= 0 ? '#00FF88' : '#EF4444' }}
            >
              {value >= 0 ? '' : '-'}
              {formatMinor(Math.abs(value))}
            </span>
          );
        })}
      </div>

      {impossible.map((l) => (
        <p
          key={l.key}
          className="mt-2.5 flex items-start gap-1.5 font-mono text-[11px] leading-relaxed"
          style={{ color: '#F59E0B' }}
        >
          <AlertCircle size={12} className="mt-0.5 shrink-0" />
          <span>
            {l.label} does not close — it ends at {formatMinor(l.closingMinor!)}, which
            could not have been held. Income went unlogged, or the opening balance is
            lower than what was really there.
          </span>
        </p>
      ))}

      <p className="mt-3 font-mono text-[10px] leading-relaxed text-text-muted/60">
        Moved money is debt, repayment and cash changing form — never spending, listed
        so income and spend can meet.
        {known && ' Closing follows what was captured: unlogged income reads low, cash spent without logging reads high.'}
      </p>
    </div>
  );
}

function Row({
  line,
  ledgers,
}: {
  line: {
    label: string;
    hint?: string;
    value: (l: MonthLedger) => number;
    color: string;
  };
  ledgers: MonthLedger[];
}) {
  return (
    <>
      <div className="font-mono text-xs text-text-muted">
        {line.label}
        {line.hint && (
          <span className="ml-1.5 text-[10px] text-text-muted/50">{line.hint}</span>
        )}
      </div>
      {ledgers.map((l) => {
        const value = line.value(l);
        return (
          <span
            key={l.key}
            className="text-right font-mono text-xs tabular-nums"
            style={{ color: value === 0 ? '#6B7280' : line.color }}
          >
            {value === 0 ? '—' : `${value > 0 ? '+' : '-'}${formatMinor(Math.abs(value))}`}
          </span>
        );
      })}
    </>
  );
}
