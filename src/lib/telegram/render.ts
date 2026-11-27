/**
 * Reply text and keyboards. Pure. Every button carries a callback_data built by
 * `encode`, so what is printed and what is decoded cannot drift apart.
 */
import { formatMinor } from '../finance/parse.ts';
import { CATEGORY_BY_SLUG } from '../finance/categorize.ts';
import {
  ACCOUNT_KEYS,
  ACCOUNT_LABELS,
  CARD_KEYS,
  type AccountKey,
} from './accounts.ts';
import { encode, MAX_MENU_SLUG } from './callbacks.ts';

export interface Button {
  text: string;
  data: string;
}
export interface Reply {
  text: string;
  buttons: Button[][];
}
export interface MenuCategory {
  slug: string;
  name: string;
}

/** A saved line, as the bot shows it back. */
export interface TxnView {
  id: string;
  direction: 'expense' | 'income' | 'move';
  amountMinor: number;
  categorySlug: string | null;
  /** expense: where it left; income: where it landed; move: the source. */
  account: AccountKey | null;
  /** move only: the destination. */
  toAccount?: AccountKey | null;
}

const MINUS = '−';
const label = (a: AccountKey | null) => (a ? ACCOUNT_LABELS[a] : 'no account');
const money = (minor: number) => formatMinor(Math.abs(minor));

function rows<T>(items: T[], per: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += per) out.push(items.slice(i, i + per));
  return out;
}

function categoryName(slug: string, cats: readonly MenuCategory[]): string {
  return (
    cats.find((c) => c.slug === slug)?.name ?? CATEGORY_BY_SLUG.get(slug)?.name ?? slug
  );
}

function categoryButtons(txn: string, cats: readonly MenuCategory[]): Button[][] {
  return rows(
    cats
      .filter((c) => c.slug.length <= MAX_MENU_SLUG)
      .map((c) => ({ text: c.name, data: encode({ op: 'category', txn, slug: c.slug }) })),
    3
  );
}

function accountRow(txn: string, current: AccountKey | null): Button[] {
  return ACCOUNT_KEYS.map((key) => ({
    text: key === current ? `● ${ACCOUNT_LABELS[key]}` : ACCOUNT_LABELS[key],
    data: encode({ op: 'account', txn, account: key }),
  }));
}

/** `✓ Transport −25,000 · Cash` with Undo / Change category / account row. */
export function renderTxn(v: TxnView, cats: readonly MenuCategory[]): Reply {
  const undo: Button = { text: 'Undo', data: encode({ op: 'undo', txn: v.id }) };

  if (v.direction === 'move') {
    return {
      text: `✓ Moved ${money(v.amountMinor)} · ${label(v.account)} → ${label(v.toAccount ?? null)}`,
      buttons: [[undo]],
    };
  }

  const sign = v.direction === 'income' ? '+' : MINUS;
  const amount = `${sign}${money(v.amountMinor)}`;

  if (!v.categorySlug) {
    return {
      text: `✓ ${amount} · ${label(v.account)} — what is it for?`,
      buttons: [...categoryButtons(v.id, cats), [undo], accountRow(v.id, v.account)],
    };
  }
  return {
    text: `✓ ${categoryName(v.categorySlug, cats)} ${amount} · ${label(v.account)}`,
    buttons: [
      [undo, { text: 'Change category', data: encode({ op: 'menu', txn: v.id }) }],
      accountRow(v.id, v.account),
    ],
  };
}

export function renderCategoryMenu(txn: string, cats: readonly MenuCategory[]): Reply {
  return { text: 'Which category?', buttons: categoryButtons(txn, cats) };
}

export function renderUndone(): Reply {
  return { text: 'Undone.', buttons: [] };
}

/** Flagged line: ask before saving. `reasons` are plain-language flag texts. */
export function renderConfirm(pending: string, raw: string, reasons: string[]): Reply {
  return {
    text: `Not sure about “${raw.trim()}”:\n${reasons.map((r) => `• ${r}`).join('\n')}\nSave it as?`,
    buttons: [
      [
        { text: 'Expense', data: encode({ op: 'pending', pending, choice: 'expense' }) },
        { text: 'Income', data: encode({ op: 'pending', pending, choice: 'income' }) },
        { text: 'Cancel', data: encode({ op: 'pending', pending, choice: 'cancel' }) },
      ],
    ],
  };
}

/** "250 or 250,000?" — a bare amount under 1,000 is never guessed. */
export function renderAmountAsk(pending: string, amountMinor: number): Reply {
  const as = amountMinor;
  const k = amountMinor * 1000;
  return {
    text: `${money(as)} or ${money(k)}?`,
    buttons: [
      [
        { text: money(as), data: encode({ op: 'pending', pending, choice: 'asis' }) },
        { text: money(k), data: encode({ op: 'pending', pending, choice: 'scale' }) },
        { text: 'Cancel', data: encode({ op: 'pending', pending, choice: 'cancel' }) },
      ],
    ],
  };
}

export function renderMoveFrom(pending: string, amountMinor: number): Reply {
  return {
    text: `Move ${money(amountMinor)} — from which account?`,
    buttons: [
      ACCOUNT_KEYS.map((a) => ({
        text: ACCOUNT_LABELS[a],
        data: encode({ op: 'moveFrom', pending, account: a }),
      })),
    ],
  };
}

export function renderMoveTo(pending: string, amountMinor: number, from: AccountKey): Reply {
  return {
    text: `Move ${money(amountMinor)} from ${label(from)} — to which account?`,
    buttons: [
      ACCOUNT_KEYS.filter((a) => a !== from).map((a) => ({
        text: ACCOUNT_LABELS[a],
        data: encode({ op: 'moveTo', pending, account: a }),
      })),
    ],
  };
}

export function renderOwedAsk(pending: string, person: string): Reply {
  return {
    text: `Is this ${person} paying back?`,
    buttons: [
      [
        { text: 'Yes', data: encode({ op: 'pending', pending, choice: 'yes' }) },
        { text: 'No', data: encode({ op: 'pending', pending, choice: 'cancel' }) },
      ],
    ],
  };
}

export function renderOwedReduced(person: string, paidMinor: number, leftMinor: number): Reply {
  return {
    text:
      leftMinor > 0
        ? `${person}: −${money(paidMinor)} noted. Still owes you ${money(leftMinor)}.`
        : `${person}: paid in full. 🎉`,
    buttons: [],
  };
}

export function renderBalanceQuestion(account: AccountKey): Reply {
  return { text: `${label(account)} now? Type the number.`, buttons: [] };
}

/** The gap in plain words, signed by direction. `gapMinor` = counted − ledger. */
export function renderGap(account: AccountKey, countedMinor: number, gapMinor: number | null): Reply {
  const name = label(account);
  if (gapMinor === null) return { text: `${name} noted: ${money(countedMinor)}. This is where it starts.`, buttons: [] };
  if (gapMinor === 0) return { text: `${name} ${money(countedMinor)} — matches. ✓`, buttons: [] };
  return {
    text:
      gapMinor < 0
        ? `${name} is ${money(gapMinor)} short — what's missing?`
        : `${name} has ${money(gapMinor)} more than logged — what came in?`,
    buttons: [],
  };
}

export interface DaySummary {
  /** Tashkent date label, e.g. "Wed 25 Nov". */
  dateLabel: string;
  totalMinor: number;
  top: { name: string; minor: number }[];
  /** Sunday also counts the cards. */
  sunday: boolean;
}

export function renderDayClose(s: DaySummary): Reply {
  const lines = [`${s.dateLabel} — spent ${money(s.totalMinor)}`];
  for (const t of s.top.slice(0, 3)) lines.push(`  ${t.name} ${money(t.minor)}`);
  lines.push('', 'Cash now? Type the number.');
  if (s.sunday) lines.push(`Sunday: I will also ask ${CARD_KEYS.map(label).join(', ')}.`);
  return {
    text: lines.join('\n'),
    buttons: [[{ text: 'Remind me in 1 h', data: encode({ op: 'snooze' }) }]],
  };
}

export function renderOwedDue(person: string, openMinor: number): Reply {
  return { text: `Due today: ${person} owes you ${money(openMinor)}.`, buttons: [] };
}

export const HELP_TEXT =
  'Type a line to save it: -25k taxi · +100k doc service\n' +
  'Start with * to move money between your accounts: *250k card to cash\n' +
  'I save first, you fix with the buttons.';
