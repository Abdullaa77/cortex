/**
 * Message text -> what to do. Pure: the route does the I/O the decision names.
 *
 * A line that parses clean is saved at once (default account Cash). A flagged
 * line is asked about first. A `*` line is a move and always asks which
 * accounts. A bare number while a balance question is open is the answer.
 */
import {
  explainFlag,
  parseLine,
  toMinorUnits,
  type Direction,
  type FlagCode,
  type ParseResult,
} from '../finance/parse.ts';
import { categorize, CATEGORY_BY_SLUG } from '../finance/categorize.ts';
import { DEFAULT_ACCOUNT, type AccountKey } from './accounts.ts';
import {
  HELP_TEXT,
  renderAmountAsk,
  renderConfirm,
  renderMoveFrom,
  type Reply,
} from './render.ts';
import type { PendingChoice } from './callbacks.ts';

export interface OwedRef {
  id: string;
  person: string;
  openMinor: number;
}

export interface BotContext {
  /** ruleKey(comment) -> slug, from finance_category_rules. */
  learned: ReadonlyMap<string, string>;
  owed: readonly OwedRef[];
  /** Set by the evening / Sunday question; the next bare number answers it. */
  pendingBalance: AccountKey | null;
}

export interface TxnDraft {
  direction: Direction;
  amountMinor: number;
  comment: string;
  categorySlug: string | null;
  account: AccountKey;
}

export type PendingKind = 'confirm' | 'amount' | 'move';

export type Decision =
  | { type: 'say'; reply: Reply }
  | { type: 'save'; drafts: TxnDraft[] }
  | {
      type: 'ask';
      kind: PendingKind;
      raw: string;
      /** Move only: what is known so far. */
      move?: { amountMinor: number; comment: string };
      render: (pendingId: string) => Reply;
    }
  | { type: 'balance'; account: AccountKey; countedMinor: number };

const say = (text: string): Decision => ({ type: 'say', reply: { text, buttons: [] } });

const BARE_NUMBER = /^\s*(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)\s*([kKmM])?\s*$/;

/** A message that is only a number — the answer to "Cash now?". */
export function parseBareAmount(text: string): number | null {
  const m = BARE_NUMBER.exec(text);
  if (!m) return null;
  const r = toMinorUnits(m[1], m[2]);
  return r && !r.commaDecimal ? r.minor : null;
}

/** `250 coffee` -> `250k coffee`; keeps a leading sign or `*`. */
export function scaleRaw(raw: string): string {
  return raw.replace(
    /^(\s*[+*-]?\s*)(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:[.,]\d+)?)/,
    '$1$2k'
  );
}

/** First open-owed person named in an income line, or null. */
export function matchOwed(comment: string, owed: readonly OwedRef[]): OwedRef | null {
  const low = comment.toLowerCase();
  return owed.find((o) => o.openMinor > 0 && low.includes(o.person.toLowerCase())) ?? null;
}

interface Options {
  /** Flags the user has already answered. */
  accept?: readonly FlagCode[];
  /** The user said what it is; overrides sign and silences blocking flags. */
  force?: Direction;
}

function blockingReasons(r: ParseResult, accept: readonly FlagCode[]): string[] {
  // `ok` already encodes the blocking set; recompute minus what was accepted.
  if (r.ok) return [];
  const blocking = r.flags.filter(
    (f) => f.code !== 'MULTI_NUMBER' && f.code !== 'USD_REFERENCE' && !accept.includes(f.code)
  );
  return blocking.map((f) => explainFlag(f.code));
}

function draftOf(r: ParseResult, ctx: BotContext, force?: Direction): TxnDraft[] {
  return r.transactions.map((t) => {
    const direction = force ?? t.direction;
    const guess = categorize(t.comment, ctx.learned).slug;
    // Never save under a category of the wrong kind (a "salary" word on an
    // expense, say): the kind must agree with the direction or it is asked.
    const kind = guess ? CATEGORY_BY_SLUG.get(guess)?.kind : undefined;
    const slug =
      guess && kind && (kind === 'transfer' || kind === direction) ? guess : null;
    return {
      direction,
      amountMinor: t.amountMinor,
      comment: t.comment,
      categorySlug: direction === 'income' && !slug ? 'income' : slug,
      account: DEFAULT_ACCOUNT,
    };
  });
}

export function decideLine(raw: string, ctx: BotContext, opts: Options = {}): Decision {
  const accept = opts.accept ?? [];

  if (ctx.pendingBalance && !opts.force) {
    const counted = parseBareAmount(raw);
    if (counted !== null)
      return { type: 'balance', account: ctx.pendingBalance, countedMinor: counted };
  }

  const r = parseLine(raw, { allowMove: true });

  if (r.transactions.length === 0)
    return say('I could not find an amount. Try: -25k taxi');

  if (r.transactions.some((t) => t.currency !== 'UZS'))
    return say('Everything is in so’m — write the amount without $.');

  if (r.isMove) {
    const t = r.transactions[0];
    const small = r.flags.some((f) => f.code === 'BARE_SMALL_AMOUNT') && !accept.includes('BARE_SMALL_AMOUNT');
    if (small)
      return {
        type: 'ask',
        kind: 'amount',
        raw,
        render: (id) => renderAmountAsk(id, t.amountMinor),
      };
    // Any other blocking flag (an unclear decimal comma, say): the amount itself
    // is in doubt, and a move has no expense/income choice to settle it. Ask again.
    const reasons = blockingReasons(r, [...accept, 'BARE_SMALL_AMOUNT']);
    if (reasons.length > 0)
      return say(`${reasons.join(' ')} Write the move again, e.g. *250k card to cash`);
    return {
      type: 'ask',
      kind: 'move',
      raw,
      move: { amountMinor: t.amountMinor, comment: t.comment },
      render: (id) => renderMoveFrom(id, t.amountMinor),
    };
  }

  if (!opts.force) {
    const small = r.flags.find((f) => f.code === 'BARE_SMALL_AMOUNT');
    if (small && !accept.includes('BARE_SMALL_AMOUNT') && r.transactions.length === 1)
      return {
        type: 'ask',
        kind: 'amount',
        raw,
        render: (id) => renderAmountAsk(id, r.transactions[0].amountMinor),
      };

    const reasons = blockingReasons(r, accept);
    if (reasons.length > 0)
      return {
        type: 'ask',
        kind: 'confirm',
        raw,
        render: (id) => renderConfirm(id, raw, reasons),
      };
  }

  return { type: 'save', drafts: draftOf(r, ctx, opts.force) };
}

/** A whole message: every non-empty line decided on its own. */
export function decideMessage(text: string, ctx: BotContext): Decision[] {
  const t = text.trim();
  if (t === '/start' || t === '/help')
    return [{ type: 'say', reply: { text: HELP_TEXT, buttons: [] } }];
  return t
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => decideLine(l, ctx));
}

/** The user answered a pending question about `raw`. */
export function resolveLine(raw: string, choice: PendingChoice, ctx: BotContext): Decision {
  switch (choice) {
    case 'cancel':
      return say('Cancelled.');
    case 'scale':
      return decideLine(scaleRaw(raw), ctx);
    case 'asis':
      return decideLine(raw, ctx, { accept: ['BARE_SMALL_AMOUNT'] });
    case 'expense':
      return decideLine(raw, ctx, { force: 'expense' });
    case 'income':
      return decideLine(raw, ctx, { force: 'income' });
    case 'yes':
      return say('Noted.');
  }
}
