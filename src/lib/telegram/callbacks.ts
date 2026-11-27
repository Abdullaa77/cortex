/**
 * callback_data codec. Telegram allows 64 bytes, so every op is a one-letter
 * code plus ids. A UUID is 36 chars, so at most one UUID plus short tokens fit
 * on a button; anything needing two ids goes through a pending row (`p`).
 *
 *   u:<txn>             undo
 *   c:<txn>             show the category menu
 *   k:<txn>:<slug>      set category (and remember it)
 *   a:<txn>:<acct>      set account (expense -> from, income -> to)
 *   p:<pending>:<ch>    answer a pending question: e/i/x/s/n/y
 *   f:<pending>:<acct>  move: "from" chosen
 *   t:<pending>:<acct>  move: "to" chosen
 *   z                   snooze today's reminder one hour
 */
import { isAccountKey, type AccountKey } from './accounts.ts';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const SLUG = '[a-z0-9][a-z0-9-]{0,19}';

export const MAX_MENU_SLUG = 20;

export type PendingChoice =
  | 'expense' // save as an expense
  | 'income' // save as income
  | 'cancel'
  | 'scale' // the amount was shorthand: multiply by 1,000
  | 'asis' // the amount is what it says
  | 'yes'; // owed: yes, it is a repayment

export type CallbackOp =
  | { op: 'undo'; txn: string }
  | { op: 'menu'; txn: string }
  | { op: 'category'; txn: string; slug: string }
  | { op: 'account'; txn: string; account: AccountKey }
  | { op: 'pending'; pending: string; choice: PendingChoice }
  | { op: 'moveFrom'; pending: string; account: AccountKey }
  | { op: 'moveTo'; pending: string; account: AccountKey }
  | { op: 'snooze' };

const CHOICE_CODE: Record<PendingChoice, string> = {
  expense: 'e',
  income: 'i',
  cancel: 'x',
  scale: 's',
  asis: 'n',
  yes: 'y',
};
const CODE_CHOICE = Object.fromEntries(
  Object.entries(CHOICE_CODE).map(([k, v]) => [v, k as PendingChoice])
) as Record<string, PendingChoice>;

export function encode(op: CallbackOp): string {
  switch (op.op) {
    case 'undo': return `u:${op.txn}`;
    case 'menu': return `c:${op.txn}`;
    case 'category': return `k:${op.txn}:${op.slug}`;
    case 'account': return `a:${op.txn}:${op.account}`;
    case 'pending': return `p:${op.pending}:${CHOICE_CODE[op.choice]}`;
    case 'moveFrom': return `f:${op.pending}:${op.account}`;
    case 'moveTo': return `t:${op.pending}:${op.account}`;
    case 'snooze': return 'z';
  }
}

const RE = {
  id: new RegExp(`^([ucp]):(${UUID})$`),
  cat: new RegExp(`^k:(${UUID}):(${SLUG})$`),
  acct: new RegExp(`^([aft]):(${UUID}):([a-z0-9]+)$`),
  pend: new RegExp(`^p:(${UUID}):([a-z])$`),
};

/** Strict: anything that is not exactly one of ours is null. */
export function decode(data: string): CallbackOp | null {
  if (data === 'z') return { op: 'snooze' };
  if (data.length > 64) return null;

  let m = RE.pend.exec(data);
  if (m) {
    const choice = CODE_CHOICE[m[2]];
    return choice ? { op: 'pending', pending: m[1], choice } : null;
  }
  m = RE.cat.exec(data);
  if (m) return { op: 'category', txn: m[1], slug: m[2] };

  m = RE.acct.exec(data);
  if (m) {
    if (!isAccountKey(m[3])) return null;
    const account = m[3];
    if (m[1] === 'a') return { op: 'account', txn: m[2], account };
    if (m[1] === 'f') return { op: 'moveFrom', pending: m[2], account };
    return { op: 'moveTo', pending: m[2], account };
  }

  m = RE.id.exec(data);
  if (m) return m[1] === 'u' ? { op: 'undo', txn: m[2] } : m[1] === 'c' ? { op: 'menu', txn: m[2] } : null;

  return null;
}
