/**
 * Category inference for captured transactions.
 *
 * Pure — same contract as the parser. No React, no Supabase, no I/O.
 *
 * The categories and the vocabulary below are derived from two months of
 * Scott's real capture notes, not from a generic template. Every category here
 * earned its place with real line counts behind it.
 *
 * PRECEDENCE IS THE WHOLE DESIGN:
 *
 *   TYPE words say WHAT the transaction is      — taxi, grocery, korzinka, osh
 *   CONTEXT words say WHERE or FOR WHOM it was  — Masjid, mom, home
 *
 * Type beats context, unconditionally. Context is consulted only when no type
 * word matched at all. Without that rule "taxi to Masjid for Juma" classifies
 * as charity because it mentions a mosque, when it is plainly a taxi fare.
 *
 * Inference is never a gate. A transaction saves first and categorises after —
 * an unresolved category is a chip to tap, never a required field.
 */

export type CategoryKind = 'expense' | 'income' | 'transfer';

export interface CategoryDef {
  slug: string;
  name: string;
  icon: string;
  color: string;
  kind: CategoryKind;
}

/**
 * Seeded categories. `transfer` and `income` are excluded from the spend view —
 * debt, repayments and changes of form are not spending.
 */
export const CATEGORIES: readonly CategoryDef[] = [
  { slug: 'groceries',      name: 'Groceries',       icon: '⌗', color: '#00FF88', kind: 'expense' },
  { slug: 'transport',      name: 'Transport',       icon: '→', color: '#06B6D4', kind: 'expense' },
  { slug: 'eating-out',     name: 'Eating out',      icon: '◐', color: '#F59E0B', kind: 'expense' },
  { slug: 'ehsan',          name: 'Ehsan',           icon: '☾', color: '#D4AF37', kind: 'expense' },
  { slug: 'documents',      name: 'Documents',       icon: '▤', color: '#8B5CF6', kind: 'expense' },
  { slug: 'clothing',       name: 'Clothing',        icon: '◇', color: '#EC4899', kind: 'expense' },
  { slug: 'grooming',       name: 'Grooming',        icon: '✂', color: '#EC4899', kind: 'expense' },
  { slug: 'travel',         name: 'Travel',          icon: '↗', color: '#3B82F6', kind: 'expense' },
  { slug: 'phone-internet', name: 'Phone + net',     icon: '◈', color: '#3B82F6', kind: 'expense' },
  { slug: 'utilities',      name: 'Utilities',       icon: '⌂', color: '#6B7280', kind: 'expense' },
  { slug: 'work-tools',     name: 'Work tools',      icon: '{}', color: '#00FF88', kind: 'expense' },
  { slug: 'health',         name: 'Health',          icon: '♥', color: '#EF4444', kind: 'expense' },
  { slug: 'entertainment',  name: 'Entertainment',   icon: '◉', color: '#F59E0B', kind: 'expense' },
  { slug: 'gifts-events',   name: 'Gifts + events',  icon: '❋', color: '#EC4899', kind: 'expense' },
  { slug: 'investment',     name: 'Investment',      icon: '↑', color: '#22C55E', kind: 'expense' },
  { slug: 'income',         name: 'Income',          icon: '+',  color: '#22C55E', kind: 'income'  },
  { slug: 'transfer',       name: 'Transfer / debt', icon: '⇄', color: '#6B7280', kind: 'transfer' },
];

export const CATEGORY_BY_SLUG = new Map(CATEGORIES.map((c) => [c.slug, c]));

export interface Rule {
  slug: string;
  pattern: RegExp;
}

/**
 * TYPE vocabulary — what the money bought. Ordered; first match wins.
 *
 * `transfer` and `ehsan` sit at the top on purpose: a purpose overrides a
 * commodity. "banana and yogurt for ehsan" is charity that happens to be
 * groceries, not groceries that happen to be charity.
 */
export const TYPE_RULES: readonly Rule[] = [
  { slug: 'transfer',       pattern: /\bdebt\b|sent back|exchanged|transferred|sent to|gave cash|got cash|to cash/i },
  { slug: 'income',         pattern: /salary|avans|cashback|refund/i },
  { slug: 'ehsan',          pattern: /ehsan|ehson/i },
  { slug: 'documents',      pattern: /\bdocs?\b|kadastr|passport/i },
  { slug: 'work-tools',     pattern: /upwork|anthropic|\bapi\b|connects/i },
  { slug: 'investment',     pattern: /investment/i },
  { slug: 'phone-internet', pattern: /\bp#|phone plan|phone payment|wifi/i },
  { slug: 'utilities',      pattern: /comunnal|communal|\bjk\b/i },
  { slug: 'health',         pattern: /medicine|pharmacy|gano tea|herbal tea/i },
  { slug: 'grooming',       pattern: /barber|hair cut|argan oil/i },
  { slug: 'travel',         pattern: /bus ticket|\btickets?\b|suitcase|luggage/i },
  { slug: 'eating-out',     pattern: /\bosh\b|plov|pizza|dinner|lunch|somsa|wedrink|feedup|ice-cream/i },
  { slug: 'transport',      pattern: /taxi|\bbus\b|metro|commute|avtostation|yandex|bus station/i },
  { slug: 'groceries',      pattern: /grocery|korzinka|banana|yogurt|tvorog|sirok|bread|water|\begg|qurt|chortoq|semechka|sausage|melon|grape|potato|oreo|choco|sprite|dates/i },
  { slug: 'clothing',       pattern: /trousers|outfit|cross store|crosses|pijama/i },
  { slug: 'entertainment',  pattern: /entertainment|table tennis|football/i },
  { slug: 'gifts-events',   pattern: /wedding|\bgift\b/i },
];

/**
 * CONTEXT vocabulary — where, or for whom. Consulted ONLY when no type word
 * matched, and never allowed to override one.
 *
 * Deliberately excluded: `office` ("to office" is genuinely ambiguous — a fare
 * to the office, or money handed over at it?) and `mom` / `sister` / `home`
 * (a beneficiary or a destination is not a category).
 */
export const CONTEXT_RULES: readonly Rule[] = [
  { slug: 'ehsan', pattern: /masjid|mosque|father's grave/i },
];

export type CategorySource = 'type' | 'context' | 'learned' | 'none';

export interface CategoryGuess {
  slug: string | null;
  via: CategorySource;
}

/** Normalised lookup key for the learned keyword -> category map. */
export function ruleKey(comment: string): string {
  return comment.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Infer a category from a comment.
 *
 * `learned` is the user-correction map (the `category_rules` table), keyed by
 * `ruleKey`. A correction the user made by hand always wins — that is the whole
 * point of storing it.
 */
export function categorize(
  comment: string,
  learned?: ReadonlyMap<string, string>
): CategoryGuess {
  const learnedSlug = learned?.get(ruleKey(comment));
  if (learnedSlug) return { slug: learnedSlug, via: 'learned' };

  for (const rule of TYPE_RULES)
    if (rule.pattern.test(comment)) return { slug: rule.slug, via: 'type' };

  for (const rule of CONTEXT_RULES)
    if (rule.pattern.test(comment)) return { slug: rule.slug, via: 'context' };

  return { slug: null, via: 'none' };
}

/** True when this category should be counted as spending. */
export function isSpend(slug: string | null): boolean {
  if (!slug) return true; // uncategorised money still left the account
  return CATEGORY_BY_SLUG.get(slug)?.kind === 'expense';
}
