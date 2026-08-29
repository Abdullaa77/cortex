/**
 * Beneficiary — who consumed it, as against who paid for it.
 *
 * Every row already knows whose money it was: that is the owner of the account
 * it left. What no row has ever known is WHO THE MONEY WAS FOR. Those are two
 * different facts, and collapsing them is what makes a shared ledger read as an
 * accusation.
 *
 * Mom's cash buying groceries the whole household eats is:
 *
 *   owner       = mom        (whose pocket it left)
 *   beneficiary = household  (who consumed it)
 *
 * Reported as "mom spent 400k" that is misleading. Reported as "400k of
 * household groceries, funded from mom's cash" it is true and useful. Nothing
 * in this file, and nothing that reads it, may collapse funding into
 * consumption — that is the entire point of the stage. `owner` lives on
 * accounts and answers the funding question; this answers the other one, and
 * the two are never substituted for each other.
 *
 * A NEW AXIS OVER THE SAME MONEY. No figure that existed before this file
 * moves. Every function here re-runs exactly the arithmetic `categoryBreakdown`
 * and `monthTotals` run — same month bucket, same spend classification, same
 * netting of repayments — and only groups the result differently. That is why
 * the groups add up to the totals; if they ever stopped, something would be
 * being dropped.
 */

import { ACCOUNT_OWNERS, type AccountOwner } from './accounts.ts';
import { UNACCOUNTED_SLUG } from './checkpoints.ts';
import { monthKey } from './format.ts';
import { effectiveMinor, reimbursementsByTarget } from './links.ts';
import {
  CORE_SLUGS,
  categorySlugOf,
  classifyRow,
  countsTowardLedger,
  type ClassifiableRow,
  type JoinedCategory,
  type TransactionRow,
} from './summarize.ts';

/** Consumed by the household as a whole, rather than by one person. */
export const HOUSEHOLD = 'household';

/**
 * Who a row was for.
 *
 * The person names come from `ACCOUNT_OWNERS` and are not retyped here. One
 * list, two uses: owner is a person, beneficiary is a person or the household.
 */
export type Beneficiary = AccountOwner | typeof HOUSEHOLD;

/** Every value the column accepts, household first — it is the common answer. */
export const BENEFICIARIES = [HOUSEHOLD, ...ACCOUNT_OWNERS] as const;

/** The key the "nobody recorded who this was for" group is filed under. */
export const UNRECORDED = 'unrecorded';

/** A beneficiary group's key: a real answer, or the absence of one. */
export type BeneficiaryKey = Beneficiary | typeof UNRECORDED;

/** True when `value` is something the column may hold. Rejects `null`. */
export function isBeneficiary(value: unknown): value is Beneficiary {
  return (BENEFICIARIES as readonly unknown[]).includes(value);
}

/** The row shape this module reads: a transaction row that may carry one. */
export interface BeneficiaryRow extends TransactionRow {
  /**
   * Optional for the same reason `currency` is optional on ClassifiableRow —
   * the 153 imported rows predate the column entirely, and a fixture that had
   * to state it everywhere would be asserting a fact about rows that have
   * none. Absent and NULL mean the same thing here: not recorded.
   */
  beneficiary?: Beneficiary | null;
}

/**
 * Does this kind of row have a beneficiary at all?
 *
 * Only spending is consumed by someone.
 *
 *   income      — nobody consumes money arriving; it has not been spent yet.
 *   transfer    — money moving between two of the household's own containers
 *                 is not consumed by either of them.
 *   unaccounted — a gap nobody can explain has, by definition, no known
 *                 consumer. Guessing one would be the same fiction the
 *                 category itself exists to refuse.
 *
 * These are NULL as a matter of definition, not as a matter of nobody having
 * filled them in yet. Migration 010 enforces that at the database so no write
 * path can leave a stale value behind, and this function enforces it in the
 * read path so a stale value that predates the trigger still cannot render.
 * Two guards, because a value that is wrong in storage and right on screen is
 * recoverable, and one that is wrong on screen is not.
 */
export function takesBeneficiary(row: ClassifiableRow): boolean {
  return classifyRow(row) === 'spend' && categorySlugOf(row) !== UNACCOUNTED_SLUG;
}

/**
 * Who this row was for. THE single answer to that question.
 *
 * Null means "not recorded" — and the UI must render it as exactly that. Never
 * as household, never as zero, never quietly left out of a denominator. A
 * placeholder in a slot nobody filled asserts a falsehood in place of an
 * absence, which is the same rule Stage 1 applied to the unknown side of a
 * transfer.
 */
export function beneficiaryOf(row: BeneficiaryRow): Beneficiary | null {
  if (!takesBeneficiary(row)) return null;
  return isBeneficiary(row.beneficiary) ? row.beneficiary : null;
}

/** The group a row's spending belongs to, including the absence of an answer. */
export function beneficiaryKeyOf(row: BeneficiaryRow): BeneficiaryKey {
  return beneficiaryOf(row) ?? UNRECORDED;
}

/** How a group is named on screen. Lower case, because the copy is a sentence. */
export const BENEFICIARY_LABEL: Record<BeneficiaryKey, string> = {
  household: 'household',
  me: 'me',
  mom: 'mom',
  sister: 'sister',
  unrecorded: 'not recorded',
};

/** One group of spending, by who consumed it. */
export interface BeneficiarySlice {
  key: BeneficiaryKey;
  label: string;
  minor: number;
  /** Share of the month's spend, 0–1. Zero when the month spent nothing. */
  share: number;
  /** True for the group that has no answer, so the UI can say so differently. */
  unrecorded: boolean;
  rowCount: number;
}

/** The order groups are always listed in: household, the people, then absence. */
const GROUP_ORDER: BeneficiaryKey[] = [...BENEFICIARIES, UNRECORDED];

/**
 * Spend rows for one month, in the shape everything downstream counts.
 *
 * Identical filtering to `categoryBreakdown`: same month bucket, same currency
 * guard, same spend classification. Written once and shared, because the claim
 * that the beneficiary groups add up to the month's spend is only true if both
 * sides are looking at the same set of rows.
 */
function spendInMonth<T extends BeneficiaryRow>(rows: T[], key: string): T[] {
  return rows.filter(
    (row) =>
      monthKey(row.occurred_at) === key &&
      countsTowardLedger(row) &&
      classifyRow(row) === 'spend'
  );
}

function emptySlice(key: BeneficiaryKey): BeneficiarySlice {
  return {
    key,
    label: BENEFICIARY_LABEL[key],
    minor: 0,
    share: 0,
    unrecorded: key === UNRECORDED,
    rowCount: 0,
  };
}

/**
 * One month's spending, grouped by who consumed it, in a fixed order.
 *
 * Every group is returned, including the empty ones and including the
 * unrecorded group, because a group that disappears when it is empty makes
 * "nothing was personal this month" indistinguishable from "the view forgot
 * about personal spending". The caller decides what to draw.
 *
 * THE ADJUSTMENT LANDS IN `unrecorded`, deliberately. It is spend, so leaving
 * it out would break the sum; and its consumer is genuinely unknown, which is
 * what that group says. "Nobody recorded who this was for" and "nobody could
 * have" are the same sentence from the reader's side.
 */
export function beneficiaryBreakdown(
  rows: BeneficiaryRow[],
  key: string
): BeneficiarySlice[] {
  const reimbursed = reimbursementsByTarget(rows);
  const groups = new Map<BeneficiaryKey, BeneficiarySlice>(
    GROUP_ORDER.map((k) => [k, emptySlice(k)])
  );

  let total = 0;

  for (const row of spendInMonth(rows, key)) {
    const minor = effectiveMinor(row, reimbursed);
    // A fully repaid expense contributes nothing to any figure on the page, so
    // it contributes nothing here either — and it is not counted as a row of
    // its group, or the group would claim rows worth zero.
    if (minor === 0) continue;

    const group = groups.get(beneficiaryKeyOf(row))!;
    group.minor += minor;
    group.rowCount++;
    total += minor;
  }

  return GROUP_ORDER.map((k) => {
    const group = groups.get(k)!;
    return { ...group, share: total > 0 ? group.minor / total : 0 };
  });
}

/**
 * The everyday floor, split by who it was for.
 *
 * The floor is the figure worth steering by: July 1,419,349.17 and August
 * 1,438,873, 1.4% apart while total spend swung 74%. What it does not say is
 * how much of that is genuinely shared and how much is one person's — and that
 * is what tells him what can actually be cut, and by whom.
 *
 * `householdMinor + personalMinor + unrecordedMinor === coreMinor`, exactly.
 * That is the property, and it is what makes the split safe to reason from: if
 * the parts did not add to the whole, the missing piece would be the one the
 * conclusion turned on.
 */
export interface FloorSplit {
  key: string;
  /** The same everyday floor `monthTotals` reports, re-derived here. */
  coreMinor: number;
  householdMinor: number;
  /** Everything attributed to one named person. */
  personalMinor: number;
  /** Floor spending with no recorded consumer. Never folded into anyone. */
  unrecordedMinor: number;
  /** Per person, in `ACCOUNT_OWNERS` order. Zeroes kept, for the same reason. */
  byPerson: { key: AccountOwner; label: string; minor: number; share: number }[];
}

export function floorSplit(rows: BeneficiaryRow[], key: string): FloorSplit {
  const reimbursed = reimbursementsByTarget(rows);
  const core = spendInMonth(rows, key).filter((row) =>
    (CORE_SLUGS as readonly string[]).includes(categorySlugOf(row))
  );

  const byPerson = new Map<AccountOwner, number>(ACCOUNT_OWNERS.map((p) => [p, 0]));
  let coreMinor = 0;
  let householdMinor = 0;
  let unrecordedMinor = 0;

  for (const row of core) {
    const minor = effectiveMinor(row, reimbursed);
    if (minor === 0) continue;
    coreMinor += minor;

    const who = beneficiaryOf(row);
    if (who === null) unrecordedMinor += minor;
    else if (who === HOUSEHOLD) householdMinor += minor;
    else byPerson.set(who, byPerson.get(who)! + minor);
  }

  const personalMinor = [...byPerson.values()].reduce((n, v) => n + v, 0);

  return {
    key,
    coreMinor,
    householdMinor,
    personalMinor,
    unrecordedMinor,
    byPerson: ACCOUNT_OWNERS.map((p) => ({
      key: p,
      label: BENEFICIARY_LABEL[p],
      minor: byPerson.get(p)!,
      share: coreMinor > 0 ? byPerson.get(p)! / coreMinor : 0,
    })),
  };
}

/**
 * The beneficiary a recategorisation is about to drop, or null if none is.
 *
 * Filing a grocery row under Income is a legitimate edit, and migration 010's
 * trigger clears the beneficiary when it lands — silently, and correctly, since
 * for those rows NULL is the only right answer. Silent is not the same as
 * unsurprising, though. The first time a value the user chose disappears
 * because they changed something else, they need to be told it happened and
 * why, or the app has quietly overruled them.
 *
 * So the rule lives here, tested, and the row renders what it returns. Refusing
 * the edit would be worse; saying nothing would be worse in a quieter way.
 */
export function clearsBeneficiary(
  row: BeneficiaryRow,
  next: JoinedCategory | null
): Beneficiary | null {
  const current = beneficiaryOf(row);
  if (current === null) return null;
  return takesBeneficiary({ ...row, finance_categories: next }) ? null : current;
}

/**
 * What a row's beneficiary should be when the backfill runs — and this is the
 * part of the stage that needs care.
 *
 * `'household'` is a default a person ACCEPTS. At capture time they are sitting
 * in front of the confirmation strip and can change it in one tap, so letting
 * the common answer stand is a choice they made. A migration has nobody in
 * front of it, so anything it writes is a claim made on someone's behalf.
 *
 * Three things therefore stay NULL, and NULL here means UNRECORDED — an
 * absence, which the UI renders as "not recorded" and never as household:
 *
 *   * Anything before the cutover. Nobody knows who ate the July groceries.
 *     Writing 'household' across those rows would assert something no human
 *     ever checked, and it would then be indistinguishable from the rows where
 *     he really did choose household. That indistinguishability is the whole
 *     cost: it does not just add a wrong row, it destroys the meaning of the
 *     right ones.
 *
 *   * Anything reconstructed rather than captured — `date_precision = 'month'`
 *     is exactly the 153 rows read back out of two months of notes. They carry
 *     a month because no day was ever written down, and for the same reason no
 *     consumer was. This guard is what protects them when no cutover is set at
 *     all, where `isPreCutover` is false for everything by design.
 *
 *   * Anything that has no beneficiary by definition — income, transfers, the
 *     unaccounted adjustment. See `takesBeneficiary`.
 *
 * What is left is a live capture, after the cutover, of money someone spent:
 * a row from the world where the household is the ordinary answer. Those get
 * 'household', and are correctable in one tap like any other.
 *
 * Migration 010 states this same rule in SQL, because SQL cannot call this
 * function. This is the tested copy, and the migration is written to match —
 * the same arrangement `sidesForClass` and migration 009 already have.
 */
export function backfillBeneficiary(
  row: BeneficiaryRow & { date_precision: 'day' | 'month' },
  cutoverDate: string | null,
  isPreCutoverRow: boolean
): Beneficiary | null {
  if (!takesBeneficiary(row)) return null;
  if (row.date_precision === 'month') return null;
  // No cutover set means no line has been drawn, and nothing can be shown to
  // sit on the truth side of it. The safe reading is that none of it was
  // chosen.
  if (!cutoverDate) return null;
  if (isPreCutoverRow) return null;
  return HOUSEHOLD;
}
