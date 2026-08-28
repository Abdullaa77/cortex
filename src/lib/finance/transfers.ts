/**
 * The transfers that are still half-mapped.
 *
 * Stage 1's backfill pointed every imported row at the one 'Main' account and
 * deliberately left the OTHER side of each transfer NULL rather than guessing
 * it. That was right: a guess written into a ledger is indistinguishable from
 * a fact a week later.
 *
 * Now real accounts exist and those destinations are knowable — the 4,850,000
 * went to a dollar position, the +151,000 arrived from his sister. Knowable by
 * SCOTT. He knows the answers; the machine does not, and no migration here
 * infers them. This file builds the queue and checks the answers; a person
 * supplies them.
 */

import { classifyRow, type ClassifiableRow } from './summarize.ts';
import { movementShape, type AccountRecord, type AccountSides } from './accounts.ts';

export interface PairableRow extends ClassifiableRow, AccountSides {
  id: string;
  amount_minor: number;
  currency: 'UZS' | 'USD';
  comment: string;
  raw_input: string;
  /** The counterpart row, when this transfer was two movements. See below. */
  transfer_pair_id: string | null;
}

/** Which end of this transfer is missing. */
export type MissingSide = 'destination' | 'source';

export interface OpenTransfer {
  row: PairableRow;
  /**
   * 'destination' — money left a known account and we do not know where it
   * landed. 'source' — money arrived somewhere and we do not know where from.
   */
  missing: MissingSide;
  /** The account we do know about. */
  knownAccountId: string;
}

/**
 * Transfers with one end still unknown, newest first.
 *
 * Only transfers. An expense with `to_account_id` NULL is not missing
 * anything — the money left the household, and there is no account on the
 * other side of a bag of groceries. Reading the shape rather than the
 * direction is what keeps those out of the queue.
 *
 * A row that has been paired is complete even though one pointer is still
 * NULL: its counterpart names where the value went. See `planResolution`.
 */
export function needsOtherSide(rows: PairableRow[]): OpenTransfer[] {
  const open: OpenTransfer[] = [];

  for (const row of rows) {
    const rowClass = classifyRow(row);
    if (rowClass !== 'transfer-in' && rowClass !== 'transfer-out') continue;
    if (row.transfer_pair_id) continue;

    const shape = movementShape(row);
    if (shape === 'left-household')
      open.push({ row, missing: 'destination', knownAccountId: row.from_account_id! });
    else if (shape === 'entered-household')
      open.push({ row, missing: 'source', knownAccountId: row.to_account_id! });
    // 'between-accounts' is already answered; 'unassigned' has no known end to
    // resolve from, so it belongs to the account-assignment problem rather than
    // to this queue.
  }

  return open.sort((a, b) => b.row.occurred_at.localeCompare(a.row.occurred_at));
}

export type Resolution =
  | {
      /**
       * Same currency: one movement, both ends now named. The som left this
       * drawer and arrived in that one, and a single row says so.
       */
      kind: 'set-side';
      patch: Partial<AccountSides>;
    }
  | {
      /**
       * Different currencies: TWO movements, and this is not a workaround.
       * 4,850,000 so'm did not turn into $400 in a drawer — it went out to
       * someone who changed it, and $400 came back. One row cannot hold both
       * amounts without silently electing one of them as the truth, and a som
       * amount pointed at a dollar account would subtract four hundred
       * thousand DOLLARS from that position.
       *
       * So the resolution writes the counterpart in the destination's own
       * currency, at the amount Scott states, and pairs the two rows. The rate
       * he actually got is then implied by the pair rather than assumed.
       */
      kind: 'pair';
      counterpart: CounterpartDraft;
    }
  | { kind: 'refused'; reason: string };

export interface CounterpartDraft extends AccountSides {
  amount_minor: number;
  currency: 'UZS' | 'USD';
  direction: 'expense' | 'income';
  occurred_at: string;
  comment: string;
  raw_input: string;
  /** Always the transfer category — this is money moving, not money spent. */
  category_slug: 'transfer';
}

/**
 * What picking this account as the other side would do.
 *
 * Returns a plan rather than performing one, so the queue can show the person
 * which of the two shapes they are about to create before anything is written.
 * `counterpartMinor` is only consulted for the cross-currency case, and is
 * required there because nobody but Scott knows what rate he got.
 */
export function planResolution(
  open: OpenTransfer,
  account: AccountRecord,
  counterpartMinor: number | null = null
): Resolution {
  if (account.id === open.knownAccountId)
    return {
      kind: 'refused',
      reason: 'That is the account it already came from. Money cannot move to itself.',
    };

  if (!account.is_active)
    return { kind: 'refused', reason: `${account.name} has been retired.` };

  if (account.currency === open.row.currency)
    return {
      kind: 'set-side',
      patch:
        open.missing === 'destination'
          ? { to_account_id: account.id }
          : { from_account_id: account.id },
    };

  if (counterpartMinor === null)
    return {
      kind: 'refused',
      reason: `${account.name} holds ${account.currency}, so this is two movements. How much ${account.currency} arrived?`,
    };

  if (!Number.isInteger(counterpartMinor) || counterpartMinor <= 0)
    return { kind: 'refused', reason: 'Enter the amount that arrived.' };

  const arriving = open.missing === 'destination';
  return {
    kind: 'pair',
    counterpart: {
      amount_minor: counterpartMinor,
      currency: account.currency,
      // Mirrored, not copied. The counterpart of money leaving is money
      // arriving; writing the same direction twice would report the household
      // as having lost it in both places.
      direction: arriving ? 'income' : 'expense',
      from_account_id: arriving ? null : account.id,
      to_account_id: arriving ? account.id : null,
      occurred_at: open.row.occurred_at,
      comment: open.row.comment,
      raw_input: open.row.raw_input,
      category_slug: 'transfer',
    },
  };
}

/**
 * The rate a completed pair implies, in minor units of so'm per dollar.
 *
 * Not used to convert anything — the household total uses the rate Scott set
 * by hand, and one deal's rate is not the household's rate. It is shown beside
 * the pair so a bad exchange is visible as a bad exchange rather than
 * disappearing into a balance.
 */
export function impliedRateMinor(
  uzsMinor: number,
  usdMinor: number
): number | null {
  if (usdMinor <= 0) return null;
  return Math.round((uzsMinor * 100) / usdMinor);
}

/** How many transfers are still waiting on an answer. Zero is the goal state. */
export function openTransferCount(rows: PairableRow[]): number {
  return needsOtherSide(rows).length;
}

export interface PairDeletion {
  /** The row on the other end. Null when this row is not half of a pair. */
  counterpart: PairableRow | null;
  /** The rate the pair observed, in tiyin per dollar. Null when both legs are one currency. */
  observedRateMinor: number | null;
  /** What deleting this row costs, phrased for the person about to do it. Empty when nothing. */
  warning: string;
}

/**
 * What deleting one leg of a paired transfer costs.
 *
 * NOT A CASCADE, and the reason is worth stating because cascade is the
 * tempting answer. The two rows record two real movements: som left, dollars
 * arrived. Deleting the record that money ARRIVED because you deleted the
 * record that money LEFT would remove a row the person never pointed at, and
 * restate whatever month it was in. Every other pointer in this schema —
 * `reimburses_transaction_id`, `from_account_id`, `category_id` — is ON DELETE
 * SET NULL for the same reason: history survives and loses its pointer.
 *
 * Nor is the rate preserved, and that is the subtler half. The rate was never
 * a stored fact — it is 4,850,000 and $400 SEEN TOGETHER, which is exactly why
 * pairing beats a rate field: nobody types it, so nobody can mistype it. But
 * an observation made of two amounts cannot outlive one of them. Retracting a
 * leg retracts the observation, and carrying the number forward would preserve
 * a rate derived from a row the person had just declared did not happen.
 *
 * So what is owed is not preservation, it is honesty, twice: say what the
 * deletion costs BEFORE it happens, and leave the survivor visibly incomplete
 * AFTER it — back in the queue, asking again where the money went. The
 * database's SET NULL does the second by itself. This function does the first.
 */
export function planPairDeletion(
  row: PairableRow,
  rows: PairableRow[]
): PairDeletion {
  const none: PairDeletion = { counterpart: null, observedRateMinor: null, warning: '' };
  if (!row.transfer_pair_id) return none;

  const counterpart = rows.find((r) => r.id === row.transfer_pair_id) ?? null;

  // Paired, but the other leg is not in this set. Either it is already gone —
  // in which case the pointer is stale and the row is about to stop being a
  // half-pair anyway — or the page is showing a slice. Say the honest thing
  // rather than inventing a counterpart to describe.
  if (!counterpart)
    return {
      counterpart: null,
      observedRateMinor: null,
      warning:
        'This was half of a cross-currency transfer whose other row is not loaded here. Deleting it leaves that row asking again where the money went.',
    };

  const somLeg = row.currency === 'UZS' ? row : counterpart;
  const dollarLeg = row.currency === 'UZS' ? counterpart : row;
  const observedRateMinor =
    somLeg.currency === 'UZS' && dollarLeg.currency === 'USD'
      ? impliedRateMinor(somLeg.amount_minor, dollarLeg.amount_minor)
      : null;

  const rateClause = observedRateMinor
    ? ` The rate these two observed — ${Math.round(observedRateMinor / 100).toLocaleString('en-US')} so'm to the dollar — was never stored anywhere; it is these two amounts seen together, so it goes with them.`
    : '';

  return {
    counterpart,
    observedRateMinor,
    warning:
      `This is half of a cross-currency transfer. The other row stays — it records money that really did move — but it goes back to the "needs the other side" queue, unanswered.${rateClause}`,
  };
}
