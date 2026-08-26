'use client';

import AppShell from '@/components/layout/AppShell';
import { useFinanceSummary } from '@/hooks/useFinanceSummary';
import MonthTotalsHeader from '@/components/finance/MonthTotalsHeader';
import CategoryRow from '@/components/finance/CategoryRow';
import ReconcileBlock from '@/components/finance/ReconcileBlock';
import LoadingState from '@/components/ui/LoadingState';
import EmptyState from '@/components/ui/EmptyState';
import { formatMinor } from '@/lib/finance/format';
import { AlertCircle } from 'lucide-react';

export default function FinancePage() {
  const { summary, loading, error } = useFinanceSummary();

  if (loading) {
    return (
      <AppShell>
        <div className="p-6">
          <LoadingState />
        </div>
      </AppShell>
    );
  }

  const { months, inBoth, oneMonthOnly, needsReviewCount, monthPrecisionCount, totalRows } =
    summary;

  if (error || months.length === 0) {
    return (
      <AppShell>
        <div className="mx-auto max-w-3xl p-4 pb-8 lg:px-10 lg:py-6 page-enter">
          <SectionHeader title="WHERE DID MY MONEY GO" />
          <EmptyState
            title={error ? 'Could not load transactions.' : 'Nothing captured yet.'}
            description={
              error ??
              'Once transactions land, this shows where the money went, one month beside the last.'
            }
          />
        </div>
      </AppShell>
    );
  }

  const earlierLabel = months[0].label;
  const laterLabel = months.length > 1 ? months[1].label : months[0].label;

  // One scale across both blocks so a bar means the same thing everywhere.
  const scaleMinor = Math.max(
    1,
    ...[...inBoth, ...oneMonthOnly].flatMap((c) => [c.earlierMinor, c.laterMinor])
  );

  return (
    <AppShell>
      <div className="mx-auto max-w-3xl p-4 pb-8 lg:px-10 lg:py-6 page-enter">
        <SectionHeader title="WHERE DID MY MONEY GO" />
        <MonthTotalsHeader months={months} />

        {inBoth.length > 0 && (
          <>
            <SectionHeader
              title="IN BOTH MONTHS"
              count={`${inBoth.length} categories`}
            />
            <p className="-mt-1 mb-2 font-mono text-[10px] leading-relaxed text-text-muted/60">
              Spending that showed up in {earlierLabel.toLowerCase()} and{' '}
              {laterLabel.toLowerCase()}. Two months is enough to see a direction,
              not enough to call something a habit.
            </p>
            <div className="rounded-lg border border-border/50 bg-surface/20 px-3">
              {inBoth.map((c) => (
                <CategoryRow
                  key={c.slug}
                  category={c}
                  scaleMinor={scaleMinor}
                  earlierLabel={earlierLabel}
                  laterLabel={laterLabel}
                />
              ))}
            </div>
          </>
        )}

        {oneMonthOnly.length > 0 && (
          <>
            <SectionHeader
              title="ONE MONTH ONLY"
              count={`${oneMonthOnly.length} categories`}
            />
            <p className="-mt-1 mb-2 font-mono text-[10px] leading-relaxed text-text-muted/60">
              Appeared in one month and not the other. Some of this is genuinely
              one-off; some is a gap in what got captured.
            </p>
            <div className="rounded-lg border border-border/50 bg-surface/20 px-3">
              {oneMonthOnly.map((c) => (
                <CategoryRow
                  key={c.slug}
                  category={c}
                  scaleMinor={scaleMinor}
                  earlierLabel={earlierLabel}
                  laterLabel={laterLabel}
                />
              ))}
            </div>
          </>
        )}

        <SectionHeader title="RECONCILE" />
        <ReconcileBlock months={months} />

        <SectionHeader title="DATA" />
        <div className="flex flex-col gap-2 font-mono text-[11px] text-text-muted">
          <span>
            {totalRows} transactions ·{' '}
            <span className="text-accent">{formatMinor(
              months.reduce((n, m) => n + m.spendMinor, 0)
            )}</span>{' '}
            spent across {months.length} month{months.length === 1 ? '' : 's'}
          </span>

          {needsReviewCount > 0 && (
            <span className="flex items-start gap-1.5">
              <AlertCircle size={12} className="mt-0.5 shrink-0 text-[#F59E0B]" />
              <span>
                <span className="text-[#F59E0B]">{needsReviewCount}</span> flagged for
                review — included in every total above. The flag means the capture was
                ambiguous, not that the number is wrong.
              </span>
            </span>
          )}

          {monthPrecisionCount > 0 && (
            <span className="flex items-start gap-1.5">
              <AlertCircle size={12} className="mt-0.5 shrink-0 text-text-muted/60" />
              <span>
                {monthPrecisionCount} rows carry a month, not a day — they came from
                notes with no per-line date. Monthly totals are exact; there is no
                daily breakdown to draw.
              </span>
            </span>
          )}
        </div>
      </div>
    </AppShell>
  );
}

function SectionHeader({ title, count }: { title: string; count?: string }) {
  return (
    <div
      className="mb-3 mt-8 flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-[3px]"
      style={{ color: '#4A6858' }}
    >
      <span>--</span>
      <span>{title}</span>
      {count && (
        <span className="font-normal tracking-normal text-text-muted">({count})</span>
      )}
      <span className="flex-1 section-line" />
    </div>
  );
}
