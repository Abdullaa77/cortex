'use client';

import Link from 'next/link';
import { formatAmount, formatBalance, formatMinor } from '@/lib/finance/format';
import type { AccountPosition, HouseholdTotal } from '@/lib/finance/positions';
import { Scale, AlertCircle, ArrowRight } from 'lucide-react';

interface PositionsCardProps {
  positions: AccountPosition[];
  household: HouseholdTotal;
  /** Days after which a count is old enough to say so. */
  staleAfterDays?: number;
  onCount: (accountId: string) => void;
  onSetRate: () => void;
}

const OWNER_LABEL: Record<string, string> = {
  me: 'me',
  mom: 'mom',
  sister: 'sister',
};

/**
 * Where the money is.
 *
 * The top block on /finance now, above where it went, because that is the
 * inversion this stage is: positions are primary and transactions explain the
 * changes between them.
 *
 * Two rules the copy has to keep. An uncounted account says "not counted", not
 * zero — the total below it is then honestly incomplete rather than quietly
 * wrong. And the household figure always states the rate it converted at, with
 * the date that rate was set, because a household total that does not name its
 * rate is not a figure.
 */
export default function PositionsCard({
  positions,
  household,
  staleAfterDays = 14,
  onCount,
  onSetRate,
}: PositionsCardProps) {
  if (positions.length === 0)
    return (
      <div className="rounded-lg border border-accent/20 bg-accent/[0.03] px-3 py-3">
        <p className="font-mono text-[11px] leading-relaxed text-text-muted">
          No accounts yet. Where the money is has to start with what the containers
          are — one per drawer, per person, per currency.
        </p>
        <Link
          href="/finance/cutover"
          className="mt-2 inline-flex items-center gap-1.5 font-mono text-xs text-accent
            transition-colors hover:text-accent-dim"
        >
          Set them up <ArrowRight size={12} />
        </Link>
      </div>
    );

  return (
    <div className="rounded-lg border border-border/60 bg-surface/30">
      <div className="divide-y divide-border/20">
        {positions.map((p) => {
          const stale =
            p.daysSinceCount !== null && p.daysSinceCount > staleAfterDays;
          return (
            <div key={p.account.id} className="flex items-baseline gap-2 px-3 py-2">
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-text-primary">
                {p.account.name}
                <span className="ml-1.5 text-[10px] text-text-muted/60">
                  {OWNER_LABEL[p.account.owner]} · {p.account.kind}
                </span>
              </span>

              <span
                className={`shrink-0 font-mono text-xs tabular-nums ${
                  p.uncounted ? 'text-text-muted/50 italic' : 'text-text-primary'
                }`}
              >
                {formatBalance(p.balance.minor, p.account.currency)}
              </span>

              <button
                type="button"
                onClick={() => onCount(p.account.id)}
                title={
                  p.uncounted
                    ? 'Nobody has counted this yet'
                    : `Counted ${p.daysSinceCount} day${p.daysSinceCount === 1 ? '' : 's'} ago, plus ${p.balance.movementCount} rows since`
                }
                className={`shrink-0 rounded border px-1.5 py-0.5 font-mono text-[10px]
                  transition-colors ${
                    p.uncounted || stale
                      ? 'border-[#F59E0B]/40 bg-[#F59E0B]/10 text-[#F59E0B] hover:bg-[#F59E0B]/20'
                      : 'border-border text-text-muted hover:border-accent/40 hover:text-accent'
                  }`}
              >
                <Scale size={10} className="mr-1 inline" />
                count
              </button>
            </div>
          );
        })}
      </div>

      <div className="border-t border-border/40 px-3 py-2">
        {household.needsRate ? (
          <p className="flex items-start gap-1.5 font-mono text-[11px] leading-relaxed text-[#F59E0B]">
            <AlertCircle size={12} className="mt-0.5 shrink-0" />
            <span>
              There are dollars here and no rate to state them at, so there is no
              household total. A total without its rate would be a guess wearing a
              number.{' '}
              <button
                type="button"
                onClick={onSetRate}
                className="underline decoration-dotted underline-offset-2"
              >
                Set the rate
              </button>
              .
            </span>
          </p>
        ) : (
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="font-mono text-[10px] uppercase tracking-[2px] text-text-muted">
              Household
            </span>
            <span className="font-mono text-sm tabular-nums text-accent">
              {formatAmount(household.totalUzsMinor ?? 0, 'UZS')}
            </span>
            {household.rate && household.convertedUzsMinor !== 0 && (
              <button
                type="button"
                onClick={onSetRate}
                className="font-mono text-[10px] text-text-muted/70 underline decoration-dotted
                  underline-offset-2 transition-colors hover:text-text-primary"
              >
                incl. {formatMinor(household.convertedUzsMinor)} converted at{' '}
                {formatMinor(household.rate.uzsPerUsdMinor)}/$ set {household.rate.setAt}
              </button>
            )}
          </div>
        )}

        {household.uncounted.length > 0 && (
          <p className="mt-1 font-mono text-[10px] leading-relaxed text-text-muted/70">
            {household.uncounted.map((p) => p.account.name).join(', ')}{' '}
            {household.uncounted.length === 1 ? 'is' : 'are'} not in that figure —
            nobody has counted {household.uncounted.length === 1 ? 'it' : 'them'} yet.
          </p>
        )}
      </div>
    </div>
  );
}
