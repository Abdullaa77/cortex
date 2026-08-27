/**
 * Should a captured line become a transaction, or an inbox item?
 *
 * Pure. Reuses the parser rather than reimplementing its grammar — parse.ts is
 * pinned by the real corpus and must stay the single reader of that syntax.
 *
 * This detector is deliberately imperfect. "-2000 words to write" clears the
 * threshold and is not money, and no blocklist of unit words will ever cover
 * that properly. The confirmation strip is what makes an imperfect rule safe:
 * a false positive costs one tap now instead of a wrong record found three
 * weeks later. Do not try to tighten this into a perfect detector.
 */

import { parseLine, type ParsedTransaction } from './parse.ts';

/** Below this, a bare number is far more likely to be a count than money. */
export const BARE_AMOUNT_FLOOR_MINOR = 1000 * 100;

export type RouteTarget = 'finance' | 'inbox';

export interface RouteDecision {
  target: RouteTarget;
  /** Why it routed the way it did — surfaced in tests and useful when debugging. */
  reason:
    | 'no-amount'
    | 'scaled'
    | 'explicit-currency'
    | 'above-floor'
    | 'below-floor';
  transactions: ParsedTransaction[];
}

export function routeCapture(text: string): RouteDecision {
  const parsed = parseLine(text);

  if (parsed.transactions.length === 0)
    return { target: 'inbox', reason: 'no-amount', transactions: [] };

  // Any one of these makes it money. A k/m suffix and a named currency are
  // both deliberate acts of writing an amount; a large bare number is the
  // only heuristic here, and it is the one the confirmation exists to cover.
  const scaled = parsed.transactions.some((t) => t.scaled);
  const explicit = parsed.transactions.some((t) => t.explicitCurrency);
  const aboveFloor = parsed.transactions.some(
    (t) => t.amountMinor >= BARE_AMOUNT_FLOOR_MINOR
  );

  if (scaled)
    return { target: 'finance', reason: 'scaled', transactions: parsed.transactions };
  if (explicit)
    return {
      target: 'finance',
      reason: 'explicit-currency',
      transactions: parsed.transactions,
    };
  if (aboveFloor)
    return {
      target: 'finance',
      reason: 'above-floor',
      transactions: parsed.transactions,
    };

  return { target: 'inbox', reason: 'below-floor', transactions: [] };
}

export interface Booking {
  /** Ids of the rows written, in order. */
  transactionIds: string[];
  /** Exactly what was typed, kept so the escape can file it unchanged. */
  rawInput: string;
  transactions: ParsedTransaction[];
}

export interface NotMoneyPlan {
  /** Every row to remove. After this runs, the capture leaves no transaction. */
  deleteIds: string[];
  /** The one inbox item to create, with the original text untouched. */
  inboxText: string;
}

/**
 * The "not money" escape: undo the booking and file the original text where it
 * should have gone. One inbox item, never more, and the text is never rewritten.
 */
export function planNotMoney(booking: Booking): NotMoneyPlan {
  return {
    deleteIds: [...booking.transactionIds],
    inboxText: booking.rawInput,
  };
}
