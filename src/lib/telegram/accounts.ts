/**
 * The five places Scott's money lives, as the bot names them.
 *
 * The key is what travels in callback_data (Telegram caps it at 64 bytes), the
 * label is what is printed on a button. Mapping a key to a real `accounts` row
 * happens in the database (`bot_account_keys`, migration 021) — never by name
 * matching in the route.
 */
export const ACCOUNT_KEYS = ['cash', 'humo', 'uzum', 'ofb', 'c7113'] as const;
export type AccountKey = (typeof ACCOUNT_KEYS)[number];

export const ACCOUNT_LABELS: Record<AccountKey, string> = {
  cash: 'Cash',
  humo: 'Humo',
  uzum: 'Uzum',
  ofb: 'OFB',
  c7113: '7113',
};

/** Cash is the default; the account is set by button, never typed. */
export const DEFAULT_ACCOUNT: AccountKey = 'cash';

/** Cards are counted on Sundays; cash every evening. */
export const CARD_KEYS: readonly AccountKey[] = ['humo', 'uzum', 'ofb', 'c7113'];

export function isAccountKey(v: unknown): v is AccountKey {
  return typeof v === 'string' && (ACCOUNT_KEYS as readonly string[]).includes(v);
}
