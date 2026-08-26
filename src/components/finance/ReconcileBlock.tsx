'use client';

import { formatMinor } from '@/lib/finance/format';
import type { MonthTotals } from '@/hooks/useFinanceSummary';

interface ReconcileBlockProps {
  months: MonthTotals[];
}

/**
 * Income, spend and money that only moved.
 *
 * Transfers are excluded from spending everywhere else on this page, which
 * leaves a gap between what came in and what went out. Showing the moved money
 * explicitly is what stops that gap reading as a bug in the app.
 */
export default function ReconcileBlock({ months }: ReconcileBlockProps) {
  const lines: { label: string; hint?: string; value: (m: MonthTotals) => number; color: string }[] =
    [
      { label: 'Income', value: (m) => m.incomeMinor, color: '#00FF88' },
      { label: 'Spent', value: (m) => -m.spendMinor, color: '#EF4444' },
      {
        label: 'Moved in',
        hint: 'debt taken, money returned',
        value: (m) => m.transferInMinor,
        color: '#6B7280',
      },
      {
        label: 'Moved out',
        hint: 'lent, repaid, changed form',
        value: (m) => -m.transferOutMinor,
        color: '#6B7280',
      },
    ];

  return (
    <div className="rounded-lg border border-border/60 bg-surface/30 p-3">
      <div className="grid grid-cols-[1fr_auto_auto] gap-x-3 gap-y-2 sm:gap-x-5">
        <span />
        {months.map((m) => (
          <span
            key={m.key}
            className="text-right font-mono text-[10px] uppercase tracking-wider text-text-muted"
          >
            {m.label.slice(0, 3)}
          </span>
        ))}

        {lines.map((line) => (
          <Row key={line.label} line={line} months={months} />
        ))}

        <span className="col-span-3 my-0.5 section-line" />

        <div className="font-mono text-xs text-text-primary">
          Net change
          <span className="ml-1.5 text-[10px] text-text-muted/60">what the balance did</span>
        </div>
        {months.map((m) => {
          const net = m.incomeMinor - m.spendMinor + m.transferInMinor - m.transferOutMinor;
          return (
            <span
              key={m.key}
              className="text-right font-mono text-xs tabular-nums"
              style={{ color: net >= 0 ? '#00FF88' : '#EF4444' }}
            >
              {net >= 0 ? '+' : '-'}
              {formatMinor(Math.abs(net))}
            </span>
          );
        })}
      </div>

      <p className="mt-3 font-mono text-[10px] leading-relaxed text-text-muted/60">
        Moved money is debt, repayment and cash changing form. It never counts as
        spending — but it is listed so income and spend can be made to meet.
      </p>
    </div>
  );
}

function Row({
  line,
  months,
}: {
  line: { label: string; hint?: string; value: (m: MonthTotals) => number; color: string };
  months: MonthTotals[];
}) {
  return (
    <>
      <div className="font-mono text-xs text-text-muted">
        {line.label}
        {line.hint && (
          <span className="ml-1.5 text-[10px] text-text-muted/50">{line.hint}</span>
        )}
      </div>
      {months.map((m) => {
        const value = line.value(m);
        return (
          <span
            key={m.key}
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
