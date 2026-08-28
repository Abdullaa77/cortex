/**
 * The real corpus, rebuilt exactly as the database holds it after the import.
 *
 * Seven test files were each building this same 20-line mapping from
 * `buildImport` output to database-shaped rows. It is now built once, here,
 * because the Stage 1 acceptance test's whole claim is that *the* corpus —
 * not a per-file copy of it — produces identical numbers before and after the
 * accounts schema lands. A drifted copy would let that claim pass while being
 * false.
 */

import { readFileSync } from 'node:fs';
import { buildImport } from '../import.ts';
import { CATEGORY_BY_SLUG } from '../categorize.ts';
import { classifyRow, type TransactionRow } from '../summarize.ts';
import type { TransactionRecord } from '../transactions.ts';
import { sidesForClass, type AccountRecord } from '../accounts.ts';
import type { BalanceCheckpoint, MovementRow } from '../checkpoints.ts';
import type { FxRate } from '../positions.ts';
import type { PairableRow } from '../transfers.ts';

export const NOTES = readFileSync(
  new URL('./notes.sample.txt', import.meta.url),
  'utf8'
);

export const IMPORTED = buildImport(NOTES, 2026);

/** Stands in for the single 'Main' account migration 008 seeds and backfills. */
export const MAIN_ID = 'acct-main';

/** The 153 imported rows, in the shape `summarize` reads. */
export const CORPUS_ROWS: TransactionRow[] = IMPORTED.rows.map((r, i) => {
  const cat = r.categorySlug ? CATEGORY_BY_SLUG.get(r.categorySlug) : undefined;
  return {
    id: `row-${i}`,
    reimburses_transaction_id: null,
    amount_minor: r.amountMinor,
    direction: r.direction,
    occurred_at: r.occurredAt,
    date_precision: r.datePrecision,
    needs_review: r.needsReview,
    finance_categories: cat
      ? { slug: cat.slug, name: cat.name, icon: cat.icon, color: cat.color, kind: cat.kind }
      : null,
  };
});

/** The opening balance the reconciliation tests pin against. */
export const OPENING = { amountMinor: 8_000_000 * 100, asOf: '2026-07-01' };

/** The same 153 rows in the fuller shape the transactions list reads. */
export const CORPUS_RECORDS: TransactionRecord[] = IMPORTED.rows.map((r, i) => {
  const cat = r.categorySlug ? CATEGORY_BY_SLUG.get(r.categorySlug) : undefined;
  return {
    id: `row-${i}`,
    amount_minor: r.amountMinor,
    currency: r.currency,
    direction: r.direction,
    comment: r.comment,
    raw_input: r.rawInput,
    category_id: cat ? `cat-${cat.slug}` : null,
    category_source: r.categorySource,
    needs_review: r.needsReview,
    parse_flags: r.parseFlags,
    occurred_at: r.occurredAt,
    date_precision: r.datePrecision,
    reimburses_transaction_id: null,
    transfer_pair_id: null,
    // Every imported row touches the one seeded 'Main' account, on the side
    // the money actually moved — decided by what the row COUNTS AS, not by its
    // `direction`. The two disagree on "4,625,000 salary (July)", and reading
    // direction there put the salary on the wrong side of the drawer. See
    // sidesForClass, and the repair in migration 009.
    //
    // The unknown side of a transfer stays NULL rather than being guessed.
    ...sidesForClass(
      classifyRow({
        direction: r.direction,
        occurred_at: r.occurredAt,
        finance_categories: cat ? { ...cat } : null,
      }),
      MAIN_ID
    ),
    finance_categories: cat
      ? { slug: cat.slug, name: cat.name, icon: cat.icon, color: cat.color, kind: cat.kind }
      : null,
  };
});

// ============================================
// Stage 2 — real accounts, and the counts that prove them
// ============================================
// The same 153 rows, now read as movements against containers. Nothing about
// the corpus changes; what changes is that there is somewhere for the money to
// be.

export const MOM_UZS_ID = 'acct-mom-uzs';
export const MOM_USD_ID = 'acct-mom-usd';
export const SISTER_ID = 'acct-sister';
export const RETIRED_ID = 'acct-retired';

/**
 * The household as the cutover leaves it.
 *
 * Mom's som cash and mom's dollar cash are two accounts even though they live
 * in one drawer, because that is how they get counted — and the counting is
 * the point. The retired one is here so tests can prove that history still
 * resolves through it while it no longer claims to hold anything.
 */
export const ACCOUNTS: AccountRecord[] = [
  { id: MAIN_ID, name: 'Main', owner: 'me', currency: 'UZS', kind: 'cash', is_active: true, sort_order: 0 },
  { id: MOM_UZS_ID, name: "Mom — cash", owner: 'mom', currency: 'UZS', kind: 'cash', is_active: true, sort_order: 1 },
  { id: MOM_USD_ID, name: "Mom — dollars", owner: 'mom', currency: 'USD', kind: 'cash', is_active: true, sort_order: 2 },
  { id: SISTER_ID, name: 'Sister — cash', owner: 'sister', currency: 'UZS', kind: 'cash', is_active: true, sort_order: 3 },
  { id: RETIRED_ID, name: 'Old wallet', owner: 'me', currency: 'UZS', kind: 'cash', is_active: false, sort_order: 4 },
];

/**
 * The counts, exactly as Scott would have taken them.
 *
 * Checkpoint #0 on Main is the same 8,000,000 that `OPENING` states, on the
 * same day — deliberately, because it IS that figure. Stage 1 held it in a
 * table of its own; Stage 2 holds it as the first time someone counted the
 * drawer, and migration 009 moves it across. The two constants agreeing is
 * what proves the migration did not invent a number.
 *
 * The later two are chosen to exercise both directions of the gap, since a
 * suite that only ever sees money go missing will pass while the copy tells
 * Scott the opposite of the truth.
 */
/**
 * The day before the ledger starts.
 *
 * `OPENING.asOf` is 1 July and the imported rows carry month precision, so all
 * 65 July rows are stamped 1 July too. A checkpoint supersedes its entire day
 * — the count is the last word for the day it was taken — so a count dated 1
 * July would absorb the whole of July and the month would derive as if nothing
 * had happened in it.
 *
 * Dating it 30 June says the true thing instead: this is what was held before
 * any of these rows happened, which is exactly what an opening balance is.
 * With it there, the checkpoint model reproduces `reconcile`'s closing balance
 * to the tiyin — and that equality is the strongest available evidence that
 * Stage 2 moved no historical figure.
 */
export const OPENING_COUNTED_AT = '2026-06-30';

export const MAIN_OPENING_CHECKPOINT: BalanceCheckpoint = {
  id: 'cp-main-0',
  account_id: MAIN_ID,
  counted_at: OPENING_COUNTED_AT,
  counted_minor: OPENING.amountMinor,
  note: 'Cutover count.',
  adjustment_transaction_id: null,
};

export const CHECKPOINTS: BalanceCheckpoint[] = [
  MAIN_OPENING_CHECKPOINT,
  {
    id: 'cp-mom-uzs-0',
    account_id: MOM_UZS_ID,
    counted_at: OPENING_COUNTED_AT,
    counted_minor: 1_200_000 * 100,
    note: null,
    adjustment_transaction_id: null,
  },
  {
    id: 'cp-mom-usd-0',
    account_id: MOM_USD_ID,
    // Counted in dollars, in cents. $400, the other side of the 4,850,000.
    counted_at: OPENING_COUNTED_AT,
    counted_minor: 400 * 100,
    note: null,
    adjustment_transaction_id: null,
  },
  {
    id: 'cp-sister-0',
    account_id: SISTER_ID,
    counted_at: OPENING_COUNTED_AT,
    counted_minor: 0,
    note: 'Empty at the cutover.',
    adjustment_transaction_id: null,
  },
];

/** 12,650 so'm to the dollar, in tiyin. Entered by hand, never fetched. */
export const FX_RATE: FxRate = { uzsPerUsdMinor: 12_650 * 100, setAt: '2026-08-01' };

/** The corpus in the shape the position math reads. */
export const MOVEMENTS: MovementRow[] = CORPUS_RECORDS.map((r) => ({
  id: r.id,
  amount_minor: r.amount_minor,
  occurred_at: r.occurred_at,
  from_account_id: r.from_account_id,
  to_account_id: r.to_account_id,
}));

/** The corpus in the shape the half-mapped-transfer queue reads. */
export const PAIRABLE_ROWS: PairableRow[] = CORPUS_RECORDS.map((r) => ({
  id: r.id,
  amount_minor: r.amount_minor,
  currency: r.currency,
  direction: r.direction,
  occurred_at: r.occurred_at,
  comment: r.comment,
  raw_input: r.raw_input,
  from_account_id: r.from_account_id,
  to_account_id: r.to_account_id,
  transfer_pair_id: null,
  finance_categories: r.finance_categories,
}));
