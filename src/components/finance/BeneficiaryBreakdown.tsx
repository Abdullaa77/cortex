'use client';

import { formatMinor } from '@/lib/finance/format';
import type {
  BeneficiaryKey,
  BeneficiarySlice,
  FloorSplit,
} from '@/lib/finance/beneficiary';

interface BeneficiaryBreakdownProps {
  monthLabel: string;
  floor: FloorSplit;
  groups: BeneficiarySlice[];
}

/**
 * Who the money was for — as against whose money it was.
 *
 * THE COPY IS LOAD-BEARING HERE, more than anywhere else on the page. A
 * per-person view of a shared household's spending answers "what does
 * supporting each of us cost" and it must not be allowed to read as "who is
 * overspending". The same numbers say both things depending only on what is
 * written above them, and one of the two readings turns a household system
 * back into Scott's ledger with his family's names in it.
 *
 * The other rule: a row nobody recorded a consumer for is its own labelled
 * group. Never household, never zero, never quietly dropped out of the
 * denominator so the rest look bigger. It is drawn in the same muted italic an
 * uncounted account gets in PositionsCard, because it is the same kind of
 * fact — an absence being shown as an absence.
 */
const COLOR: Record<BeneficiaryKey, string> = {
  household: '#00FF88',
  me: '#06B6D4',
  mom: '#D4AF37',
  sister: '#EC4899',
  unrecorded: '#6B7280',
};

export default function BeneficiaryBreakdown({
  monthLabel,
  floor,
  groups,
}: BeneficiaryBreakdownProps) {
  const shown = groups.filter((g) => g.minor > 0);
  if (shown.length === 0) return null;

  const largest = Math.max(1, ...shown.map((g) => g.minor));

  return (
    <div className="flex flex-col gap-3">
      <p className="font-mono text-[10px] leading-relaxed text-text-muted/60">
        Who consumed it, which is a different question from whose money it was —
        mom&apos;s cash buying groceries the household eats is funded by her and
        consumed by everyone. This says what supporting each of us costs. It does
        not say who is overspending, and it is not evidence for that.
      </p>

      {/* The floor first. It is the figure worth steering by, and the split is
          the thing that says what can actually be cut, and by whom. */}
      <div className="rounded-lg border border-border/60 bg-surface/30 px-3 py-3">
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-mono text-[11px] text-text-muted">
            {monthLabel} everyday floor
          </span>
          <span className="font-mono text-sm tabular-nums text-text-primary">
            {formatMinor(floor.coreMinor)}
          </span>
        </div>
        <p className="mt-0.5 font-mono text-[10px] leading-relaxed text-text-muted/50">
          Groceries, transport and eating out — the part that recurs whatever else
          happens.
        </p>

        <div className="mt-3 flex flex-col gap-2">
          <FloorBar
            label="shared by the household"
            minor={floor.householdMinor}
            coreMinor={floor.coreMinor}
            color={COLOR.household}
          />
          <FloorBar
            label="for one person"
            minor={floor.personalMinor}
            coreMinor={floor.coreMinor}
            color={COLOR.me}
          />
          {floor.personalMinor > 0 && (
            <div className="ml-3 flex flex-col gap-1 border-l border-border/40 pl-3">
              {floor.byPerson
                .filter((p) => p.minor > 0)
                .map((p) => (
                  <div key={p.key} className="flex items-baseline gap-2">
                    <span
                      className="min-w-0 flex-1 truncate font-mono text-[11px]"
                      style={{ color: COLOR[p.key] }}
                    >
                      {p.label}
                    </span>
                    <span className="shrink-0 font-mono text-[10px] tabular-nums text-text-muted/60">
                      {Math.round(p.share * 100)}%
                    </span>
                    <span className="w-24 shrink-0 text-right font-mono text-[11px] tabular-nums text-text-primary">
                      {formatMinor(p.minor)}
                    </span>
                  </div>
                ))}
            </div>
          )}
          <FloorBar
            label="not recorded"
            minor={floor.unrecordedMinor}
            coreMinor={floor.coreMinor}
            color={COLOR.unrecorded}
            muted
          />
        </div>

        {/* Without this line a mostly-grey view reads as a broken feature
            rather than a truthful one, and the honest answer — that most of the
            ledger predates the question being asked — is the reassuring one.
            The grey shrinks on its own as post-cutover rows accumulate. */}
        {floor.unrecordedMinor > 0 && (
          <p className="mt-2.5 border-t border-border/30 pt-2 font-mono text-[10px] leading-relaxed text-text-muted/60">
            {formatMinor(floor.unrecordedMinor)} of the floor predates beneficiary
            tracking — rows read back out of notes, where no day was written down
            and for the same reason no person was. Nothing is missing and nothing
            is broken: it is counted in the floor and left out of everyone, rather
            than assumed to be the household&apos;s. This shrinks as new captures
            accumulate.
          </p>
        )}
      </div>

      {/* Then the whole month, same axis. The floor is the useful part; this is
          the check that the parts are the whole. */}
      <div className="rounded-lg border border-border/50 bg-surface/20 px-3">
        {shown.map((group) => (
          <div
            key={group.key}
            className="flex flex-col gap-1.5 border-b border-border/30 py-2.5 last:border-b-0"
          >
            <div className="flex items-baseline gap-2">
              <span
                className={`min-w-0 flex-1 truncate font-mono text-sm ${
                  group.unrecorded ? 'italic text-text-muted/70' : 'text-text-primary'
                }`}
                style={group.unrecorded ? undefined : { color: COLOR[group.key] }}
              >
                {group.label}
              </span>
              <span className="shrink-0 font-mono text-[10px] tabular-nums text-text-muted/60">
                {group.rowCount} {group.rowCount === 1 ? 'row' : 'rows'}
              </span>
              <span className="shrink-0 font-mono text-[11px] tabular-nums text-text-muted/70">
                {Math.round(group.share * 100)}%
              </span>
              <span className="w-24 shrink-0 text-right font-mono text-[11px] tabular-nums text-text-primary">
                {formatMinor(group.minor)}
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-surface2">
              <div
                className="h-full rounded-full transition-all duration-500 ease-out"
                style={{
                  width: `${(group.minor / largest) * 100}%`,
                  backgroundColor: COLOR[group.key],
                  opacity: group.unrecorded ? 0.45 : 1,
                }}
              />
            </div>
            {group.unrecorded && (
              <p className="font-mono text-[10px] leading-relaxed text-text-muted/50">
                These rows predate beneficiary tracking. They are counted in the
                month&apos;s spending and attributed to nobody.
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * One part of the floor.
 *
 * Rendered even at zero, and that is deliberate: a bar that vanishes makes
 * "nothing was personal this month" indistinguishable from "this view forgot
 * about personal spending", and the second is the failure worth guarding
 * against.
 */
function FloorBar({
  label,
  minor,
  coreMinor,
  color,
  muted = false,
}: {
  label: string;
  minor: number;
  coreMinor: number;
  color: string;
  muted?: boolean;
}) {
  const share = coreMinor > 0 ? minor / coreMinor : 0;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline gap-2">
        <span
          className={`min-w-0 flex-1 truncate font-mono text-xs ${
            muted ? 'italic text-text-muted/70' : 'text-text-primary'
          }`}
        >
          {label}
        </span>
        <span className="shrink-0 font-mono text-[10px] tabular-nums text-text-muted/60">
          {Math.round(share * 100)}%
        </span>
        <span className="w-24 shrink-0 text-right font-mono text-[11px] tabular-nums text-text-primary">
          {formatMinor(minor)}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-surface2">
        <div
          className="h-full rounded-full transition-all duration-500 ease-out"
          style={{
            width: `${share * 100}%`,
            backgroundColor: color,
            opacity: muted ? 0.45 : 1,
          }}
        />
      </div>
    </div>
  );
}
