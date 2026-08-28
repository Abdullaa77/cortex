/**
 * Accounts — where the money actually is.
 *
 * The household treasury's premise: money doesn't leave, it MOVES. Positions
 * are primary and transactions explain the changes between them, which is the
 * inverse of an expense tracker, where transactions are primary and the
 * position is whatever falls out.
 *
 * Stage 1 defined the model and nothing read it. Stage 2 is where it starts
 * carrying weight: real accounts per person and per currency, counted by hand,
 * with `checkpoints.ts` deriving what each one holds and `positions.ts` adding
 * them up. What stays out of this file is any notion of a balance — an account
 * is a container with a name, an owner and a currency, and what is in it comes
 * from a count.
 *
 * Still no account picker in capture. `-10k two bananas` plus enter books into
 * the default account from finance_settings and stays a ten-second action; the
 * account is editable afterwards. The moment capture costs thirty seconds it
 * stops being used daily, and every number downstream rots.
 */

export type AccountOwner = 'me' | 'mom' | 'sister';
export type AccountCurrency = 'UZS' | 'USD';
export type AccountKind = 'cash' | 'card' | 'savings';

export interface AccountRecord {
  id: string;
  name: string;
  owner: AccountOwner;
  /**
   * ONE CURRENCY PER ACCOUNT, never mixed. Mom's som cash and mom's dollar
   * cash are two accounts even though they live in the same drawer — that is
   * how they get counted, and the counting is the whole point of Stage 2. It
   * also keeps FX honest: positions stay native, and the household total is a
   * conversion at a stated rate rather than a figure that has quietly averaged
   * two currencies together.
   */
  currency: AccountCurrency;
  kind: AccountKind;
  /**
   * There is no opening balance here, and its absence is the Stage 2 model
   * change. Stage 1 carried `opening_minor` / `opening_at` on this record;
   * both are gone, because an opening balance is not a property of an account
   * — it is simply THE FIRST TIME SOMEONE COUNTED IT. One concept, not two:
   * see `balance_checkpoints` and src/lib/finance/checkpoints.ts, where the
   * earliest checkpoint for an account *is* its opening balance.
   */
  is_active: boolean;
  sort_order: number;
}

/** The single undifferentiated pot the imported notes were written against. */
export const MAIN_ACCOUNT_NAME = 'Main';

/**
 * Which accounts a transaction touched.
 *
 * Both sides nullable, twice over deliberately: the 153 imported rows predate
 * all of this and must not be forced into a shape they never had, and Stage 1
 * leaves capture untouched, so `-10k banana` still writes a row with neither
 * side set.
 *
 *   expense  -> from set, to NULL   (it left the household)
 *   income   -> from NULL, to set   (it entered the household)
 *   transfer -> both set            (it moved between accounts)
 *
 * A backfilled transfer has only one side set, because its other account does
 * not exist yet. That is a missing fact, not a wrong one, and Stage 2 fills it
 * in rather than Stage 1 guessing.
 */
export interface AccountSides {
  from_account_id: string | null;
  to_account_id: string | null;
}

export type MovementShape =
  | 'left-household'
  | 'entered-household'
  | 'between-accounts'
  | 'unassigned';

/**
 * What the two pointers say happened, structurally.
 *
 * Structurally — not whether it was spending. That question is `classifyRow`
 * in summarize.ts and stays there; a row can leave the household as a purchase
 * or as a repaid debt, and the account columns cannot tell those apart.
 * Two functions answering two different questions, so neither drifts into
 * answering the other's badly.
 */
export function movementShape(sides: AccountSides): MovementShape {
  const from = sides.from_account_id !== null;
  const to = sides.to_account_id !== null;
  if (from && to) return 'between-accounts';
  if (from) return 'left-household';
  if (to) return 'entered-household';
  return 'unassigned';
}

/** Active accounts in display order. Retired ones stay readable in history. */
export function activeAccounts(accounts: AccountRecord[]): AccountRecord[] {
  return accounts
    .filter((a) => a.is_active)
    .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
}

/** Look one up by id, including retired ones — history still points at those. */
export function accountById(
  accounts: AccountRecord[],
  id: string | null
): AccountRecord | null {
  if (!id) return null;
  return accounts.find((a) => a.id === id) ?? null;
}

export interface AccountDraft {
  name: string;
  owner: AccountOwner;
  currency: AccountCurrency;
  kind: AccountKind;
}

export interface DraftCheck {
  ok: boolean;
  /** Why not, phrased for the person typing. Empty when ok. */
  errors: string[];
}

export const MAX_ACCOUNT_NAME_LENGTH = 40;

/**
 * May this account be created?
 *
 * The name check is not cosmetic. Names are how Scott refers to accounts out
 * loud — "mom's cash" — so two accounts sharing one are indistinguishable at
 * the point of use, and the database carries UNIQUE (user_id, name) to match.
 * Catching it here is what turns a constraint violation halfway through the
 * cutover into a sentence next to the field.
 *
 * Currency is deliberately not checked against anything. One currency per
 * account, always, and mom's som cash and mom's dollar cash are two accounts
 * even though they live in one drawer — because that is how they get counted,
 * and the counting is the point.
 */
export function validateAccountDraft(
  draft: AccountDraft,
  existing: AccountRecord[]
): DraftCheck {
  const errors: string[] = [];
  const name = draft.name.trim();

  if (!name) errors.push('Give it a name — you will be counting it by that name.');
  else if (name.length > MAX_ACCOUNT_NAME_LENGTH)
    errors.push(`Keep the name under ${MAX_ACCOUNT_NAME_LENGTH} characters.`);

  // Case-insensitive, because "Mom cash" and "mom cash" are the same drawer to
  // a person and two rows to a UNIQUE constraint.
  if (name && existing.some((a) => a.name.trim().toLowerCase() === name.toLowerCase()))
    errors.push(`There is already an account called ${name}.`);

  return { ok: errors.length === 0, errors };
}

/** The next sort_order, so a new account lands at the end rather than on top. */
export function nextSortOrder(accounts: AccountRecord[]): number {
  return accounts.reduce((n, a) => Math.max(n, a.sort_order + 1), 0);
}

/**
 * Which side of an account a row touches, given what the row COUNTS AS.
 *
 * Migration 008's backfill read `direction` and nothing else, and on the real
 * corpus that is wrong for exactly one row — "4,625,000 salary (July)". The
 * parser wrote direction 'expense', because the line carried no leading plus;
 * the categoriser filed it under Income, because it says salary. `classifyRow`
 * has always resolved that in the ledger's favour, which is why every figure
 * on /finance is right. The account pointers did not, so Main was shown
 * 4,625,000 leaving instead of arriving — a 9,250,000 error in the position,
 * on a single row, with every month total still perfect.
 *
 * That defect was invisible until positions existed to disagree with the
 * ledger, which is the argument for this stage in one sentence.
 *
 * So the rule is: ask `classifyRow`, never `direction`. Migration 009 repairs
 * the backfill to match, and this function is that rule in the read path so
 * the two cannot drift apart again.
 */
export function sidesForClass(
  rowClass: 'transfer-in' | 'transfer-out' | 'income' | 'spend',
  accountId: string
): AccountSides {
  const arrived = rowClass === 'income' || rowClass === 'transfer-in';
  return {
    from_account_id: arrived ? null : accountId,
    to_account_id: arrived ? accountId : null,
  };
}
