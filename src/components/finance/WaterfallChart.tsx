'use client';

import { formatMinor } from '@/lib/finance/format';
import { stepGeometry, type Waterfall, type WaterfallStep } from '@/lib/finance/waterfall';

interface WaterfallChartProps {
  chart: Waterfall;
  /** Called when a category bar is clicked. Null slugs are not clickable. */
  onDrilldown: (slug: string) => void;
}

/**
 * Opening → income → each category out → closing, as a cascade.
 *
 * Rows rather than columns. A classic vertical waterfall puts eight labels on
 * a phone-width axis and none of them fit; laid on their side, every step gets
 * a full line for its name and its number, and the bars still form the same
 * staircase. The shape survives the rotation — the readability does not
 * survive the alternative.
 *
 * When the balance goes below zero a red axis is drawn at zero and the closing
 * bar sits on the far side of it. That is the reconciliation gap: not a
 * sentence about a shortfall, the length of a bar you can see.
 */
export default function WaterfallChart({ chart, onDrilldown }: WaterfallChartProps) {
  if (chart.steps.length === 0) return null;

  const zeroPercent = stepGeometry(chart.steps[0], chart).zeroPercent;

  return (
    <div className="rounded-lg border border-border/60 bg-surface/30 p-3">
      <div className="relative">
        {/* The zero line, drawn only when the balance actually crosses it. */}
        {chart.crossesZero && (
          <div
            className="pointer-events-none absolute inset-y-0 z-10 w-px"
            style={{
              left: `calc(6.5rem + (100% - 6.5rem - 6rem) * ${zeroPercent / 100})`,
              background: 'rgba(239,68,68,0.45)',
            }}
            aria-hidden
          />
        )}

        <div className="flex flex-col">
          {chart.steps.map((step) => (
            <Step
              key={step.id}
              step={step}
              chart={chart}
              onDrilldown={onDrilldown}
            />
          ))}
        </div>
      </div>

      <p className="mt-2.5 font-mono text-[10px] leading-relaxed text-text-muted/60">
        {chart.relative
          ? 'No opening balance, so this starts at zero — the steps are movement, not balance.'
          : 'Each bar starts where the one above it ended.'}
        {chart.collapsedCount > 0 &&
          ` Smallest ${chart.collapsedCount} categories folded into other.`}
      </p>
    </div>
  );
}

function Step({
  step,
  chart,
  onDrilldown,
}: {
  step: WaterfallStep;
  chart: Waterfall;
  onDrilldown: (slug: string) => void;
}) {
  const { offsetPercent, widthPercent } = stepGeometry(step, chart);
  const clickable = step.drilldownSlug !== null;

  const body = (
    <>
      <span
        className={`w-[6.5rem] shrink-0 truncate font-mono text-[11px] ${
          step.isTotal ? 'text-text-primary' : 'text-text-muted'
        }`}
      >
        {step.label}
      </span>

      <span className="relative h-3 min-w-0 flex-1">
        <span
          className="absolute inset-y-0 rounded-[2px] transition-all duration-500 ease-out"
          style={{
            left: `${offsetPercent}%`,
            width: `${widthPercent}%`,
            backgroundColor: step.color,
            opacity: step.isTotal ? 0.9 : 0.75,
          }}
        />
      </span>

      <span
        className={`w-24 shrink-0 text-right font-mono text-[11px] tabular-nums ${
          step.isTotal ? 'text-text-primary' : 'text-text-muted'
        }`}
        style={step.isTotal ? { color: step.color } : undefined}
        title={formatMinor(Math.abs(step.isTotal ? step.endMinor : step.deltaMinor))}
      >
        {step.amountLabel}
      </span>
    </>
  );

  if (!clickable)
    return (
      <div
        className={`flex items-center gap-2 py-1 ${
          step.isTotal ? 'border-border/40' : ''
        } ${step.kind === 'closing' ? 'mt-1 border-t pt-2' : ''} ${
          step.kind === 'opening' ? 'mb-1 border-b pb-2' : ''
        }`}
      >
        {body}
      </div>
    );

  return (
    <button
      type="button"
      onClick={() => onDrilldown(step.drilldownSlug!)}
      title={`Show the ${step.label.toLowerCase()} transactions`}
      className="-mx-1 flex items-center gap-2 rounded px-1 py-1 text-left transition-colors
        hover:bg-surface2/60"
    >
      {body}
    </button>
  );
}
