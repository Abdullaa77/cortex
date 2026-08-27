/**
 * The audit view of a month: opening, everything that moved, closing.
 *
 * A pie of 17 categories is unreadable and answers nothing — it cannot show
 * where the balance started, where it ended, or that the two do not join up.
 * A waterfall does all three, and the reconciliation gap stops being a
 * sentence and becomes the length of a bar.
 *
 * Pure. Layout maths included, so the component only maps numbers to widths
 * and the arithmetic can be checked without rendering anything.
 */

import { formatCompactMinor } from './format.ts';
import type { CategorySlice } from './summarize.ts';
import type { MonthLedger } from './reconcile.ts';

/**
 * How many categories get their own bar before the rest collapse into "other".
 * Six named steps plus a remainder is about as much as a phone-width column
 * can label; beyond that the bars get shorter than their own text.
 */
export const TOP_CATEGORY_COUNT = 6;

export const STEP_COLORS = {
  opening: '#6B7280',
  income: '#00FF88',
  transferIn: '#6B7280',
  transferOut: '#6B7280',
  other: '#4B5563',
  closing: '#00FF88',
  closingNegative: '#EF4444',
} as const;

export type StepKind =
  | 'opening'
  | 'income'
  | 'transfer-in'
  | 'category'
  | 'other'
  | 'transfer-out'
  | 'closing';

export interface WaterfallStep {
  kind: StepKind;
  /** Category slug for 'category' steps, otherwise the kind. Stable React key. */
  id: string;
  label: string;
  color: string;
  /** Signed change this step makes. Zero for the opening and closing markers. */
  deltaMinor: number;
  /** Running balance before this step. */
  startMinor: number;
  /** Running balance after it. */
  endMinor: number;
  /**
   * True for the opening and closing markers — bars that sit on the axis
   * rather than floating, because they are levels rather than movements.
   */
  isTotal: boolean;
  /** Pre-formatted, so the component does not choose a format of its own. */
  amountLabel: string;
  /** Only 'category' steps can be clicked through to their transactions. */
  drilldownSlug: string | null;
}

export interface Waterfall {
  steps: WaterfallStep[];
  /** Lowest running balance reached, for the axis. */
  minMinor: number;
  /** Highest running balance reached, for the axis. */
  maxMinor: number;
  /** True when the chart has to draw a zero line — the balance goes negative. */
  crossesZero: boolean;
  /** How many categories were folded into "other". Zero when none were. */
  collapsedCount: number;
  /**
   * True when the month has no opening balance, so the chart starts from zero
   * and shows movement rather than balance. The view has to say so.
   */
  relative: boolean;
}

export const EMPTY_WATERFALL: Waterfall = {
  steps: [],
  minMinor: 0,
  maxMinor: 0,
  crossesZero: false,
  collapsedCount: 0,
  relative: true,
};

/**
 * Build one month's waterfall.
 *
 * Order is deliberate: money in before money out, and transfers on the outside
 * of the spending block. That keeps the spend categories adjacent so their
 * bars can be read against each other, which is the comparison worth making.
 *
 * When the ledger has no opening balance the walk starts at zero and every
 * step is a movement rather than a balance. The numbers are still exact; only
 * the level is unknown, and `relative` says so rather than the chart implying
 * a starting point it does not have.
 */
export function buildWaterfall(
  ledger: MonthLedger,
  categories: CategorySlice[],
  topCount: number = TOP_CATEGORY_COUNT
): Waterfall {
  const relative = ledger.openingMinor === null;
  let running = ledger.openingMinor ?? 0;

  const steps: WaterfallStep[] = [];
  let minMinor = running;
  let maxMinor = running;

  const push = (
    step: Omit<WaterfallStep, 'startMinor' | 'endMinor' | 'amountLabel'>
  ) => {
    const startMinor = running;
    running += step.deltaMinor;
    minMinor = Math.min(minMinor, running, startMinor);
    maxMinor = Math.max(maxMinor, running, startMinor);
    steps.push({
      ...step,
      startMinor,
      endMinor: running,
      amountLabel: step.isTotal
        ? formatCompactMinor(running).replace(/^\+/, '')
        : formatCompactMinor(step.deltaMinor),
    });
  };

  push({
    kind: 'opening',
    id: 'opening',
    label: relative ? 'Start' : 'Opening',
    color: STEP_COLORS.opening,
    deltaMinor: 0,
    isTotal: true,
    drilldownSlug: null,
  });

  if (ledger.incomeMinor > 0)
    push({
      kind: 'income',
      id: 'income',
      label: 'Income',
      color: STEP_COLORS.income,
      deltaMinor: ledger.incomeMinor,
      isTotal: false,
      drilldownSlug: null,
    });

  if (ledger.transferInMinor > 0)
    push({
      kind: 'transfer-in',
      id: 'transfer-in',
      label: 'Moved in',
      color: STEP_COLORS.transferIn,
      deltaMinor: ledger.transferInMinor,
      isTotal: false,
      drilldownSlug: null,
    });

  // Already sorted largest first by categoryBreakdown, but the split must not
  // depend on the caller having done that.
  const ranked = [...categories].sort((a, b) => b.minor - a.minor);
  const top = ranked.slice(0, topCount);
  const rest = ranked.slice(topCount);

  for (const slice of top)
    push({
      kind: 'category',
      id: slice.slug,
      label: slice.name,
      color: slice.color,
      deltaMinor: -slice.minor,
      isTotal: false,
      drilldownSlug: slice.slug,
    });

  const restMinor = rest.reduce((n, s) => n + s.minor, 0);
  if (restMinor > 0)
    push({
      kind: 'other',
      id: 'other',
      label: `Other (${rest.length})`,
      color: STEP_COLORS.other,
      deltaMinor: -restMinor,
      isTotal: false,
      drilldownSlug: null,
    });

  if (ledger.transferOutMinor > 0)
    push({
      kind: 'transfer-out',
      id: 'transfer-out',
      label: 'Moved out',
      color: STEP_COLORS.transferOut,
      deltaMinor: -ledger.transferOutMinor,
      isTotal: false,
      drilldownSlug: null,
    });

  push({
    kind: 'closing',
    id: 'closing',
    label: relative ? 'Net' : 'Closing',
    color: running < 0 ? STEP_COLORS.closingNegative : STEP_COLORS.closing,
    deltaMinor: 0,
    isTotal: true,
    drilldownSlug: null,
  });

  return {
    steps,
    minMinor: Math.min(0, minMinor),
    maxMinor: Math.max(0, maxMinor),
    crossesZero: minMinor < 0,
    collapsedCount: rest.length,
    relative,
  };
}

export interface StepGeometry {
  /** Percent from the left edge where the bar starts. */
  offsetPercent: number;
  /** Percent of the track the bar occupies. Never below a hairline. */
  widthPercent: number;
  /** Percent from the left edge where zero sits, for the axis rule. */
  zeroPercent: number;
}

/** Minimum bar width, so a small category still leaves a visible mark. */
const HAIRLINE_PERCENT = 0.6;

/**
 * Where a step's bar sits on the track.
 *
 * Total steps (opening, closing) run from zero to their level. Movement steps
 * float between the running balance before and after, which is what makes the
 * cascade read as one continuous fall.
 */
export function stepGeometry(step: WaterfallStep, chart: Waterfall): StepGeometry {
  const span = chart.maxMinor - chart.minMinor;
  const scale = (minor: number) => (span > 0 ? ((minor - chart.minMinor) / span) * 100 : 0);
  const zeroPercent = scale(0);

  const [from, to] = step.isTotal
    ? [0, step.endMinor]
    : [step.startMinor, step.endMinor];

  const lo = scale(Math.min(from, to));
  const hi = scale(Math.max(from, to));

  return {
    offsetPercent: lo,
    widthPercent: Math.max(HAIRLINE_PERCENT, hi - lo),
    zeroPercent,
  };
}
