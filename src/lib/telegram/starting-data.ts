/**
 * The starting data for the Telegram expenses bot (spec "Starting data"):
 * 13 real lines from 23–25 Nov 2026, five balance counts, two owed rows.
 *
 * Pure: builds a plan, prints it, and renders SQL for the Supabase SQL editor
 * (the codebase has no service-role key; the same way import-finance does it).
 * Rows carry `import_batch_id`, so re-running replaces them and undo removes
 * exactly them. Nothing here touches a database.
 */
import type { AccountKey } from './accounts.ts';

export const BATCH_ID = '00000000-0000-4000-8000-5d0000000001';
export const CHECKPOINT_NOTE = 'starting-data';
export const COUNT_DAY = '2026-11-25';

export interface PlanRow {
  n: number;
  /** Tashkent wall time (UTC+5, no DST). */
  at: string;
  direction: 'expense' | 'income';
  minor: number;
  comment: string;
  slug: string;
  /** Expense: money leaves it. Income: money lands in it. */
  account: AccountKey;
  /** A move: money goes from `account` to this one. */
  moveTo?: AccountKey;
  /** Scott has not confirmed this account yet (shown with "?"). */
  confirm?: boolean;
  /** Row n of the plan this income repays. */
  reimburses?: number;
}
export interface PlanOwed { id: string; person: string; originalMinor: number; openMinor: number; dueOn: string | null }
export interface PlanCount { account: AccountKey; minor: number }

const k = (n: number) => n * 100_000; // 1k so'm in minor units
const som = (n: number) => Math.round(n * 100);

export const ROWS: PlanRow[] = [
  { n: 1, at: '2026-11-23 19:03', direction: 'income', minor: k(80), comment: 'XAZNA P2P — transfer from mom', slug: 'income', account: 'humo' },
  { n: 2, at: '2026-11-23 20:34', direction: 'income', minor: k(6000), comment: 'HAMKOR HUMO P2P — salary, first part', slug: 'income', account: 'humo' },
  { n: 3, at: '2026-11-24 17:06', direction: 'expense', minor: som(70_200), comment: 'VIA PAYMENT — phone plan (mine + mom)', slug: 'phone-internet', account: 'humo' },
  { n: 4, at: '2026-11-24 18:08', direction: 'expense', minor: som(930_823.89), comment: 'Muxlisa opa reimbursement', slug: 'transfer', account: 'uzum' },
  { n: 5, at: '2026-11-24 18:17', direction: 'expense', minor: k(10), comment: 'taxi', slug: 'transport', account: 'cash' },
  { n: 6, at: '2026-11-24 18:18', direction: 'expense', minor: k(250), comment: 'card to cash exchange', slug: 'transfer', account: 'humo', moveTo: 'cash' },
  { n: 7, at: '2026-11-24 18:18', direction: 'expense', minor: k(43), comment: 'gm club', slug: 'entertainment', account: 'cash' },
  { n: 8, at: '2026-11-24 18:18', direction: 'expense', minor: k(15), comment: 'sandwich', slug: 'eating-out', account: 'cash' },
  { n: 9, at: '2026-11-25 11:22', direction: 'expense', minor: k(8), comment: 'banana', slug: 'groceries', account: 'cash' },
  { n: 10, at: '2026-11-25 11:24', direction: 'income', minor: k(100), comment: 'doc service', slug: 'income', account: 'humo' },
  { n: 11, at: '2026-11-25 11:25', direction: 'expense', minor: k(400), comment: 'math course payment', slug: 'education', account: 'humo' },
  { n: 12, at: '2026-11-25 11:26', direction: 'expense', minor: k(200), comment: 'cosmetics for mom', slug: 'gifts-events', account: 'humo' },
  { n: 13, at: '2026-11-25 11:26', direction: 'expense', minor: k(310), comment: 'train ticket', slug: 'travel', account: 'humo' },
  { n: 14, at: '2026-11-25 11:29', direction: 'expense', minor: k(50), comment: 'lent to Dior', slug: 'transfer', account: 'cash' },
  { n: 15, at: '2026-11-25 12:20', direction: 'expense', minor: k(200), comment: "gift to Muxlisa opa's sister", slug: 'gifts-events', account: 'uzum' },
  { n: 16, at: '2026-11-25 12:24', direction: 'expense', minor: k(40), comment: 'bread', slug: 'groceries', account: 'cash' },
  { n: 17, at: '2026-11-25 12:18', direction: 'income', minor: k(310), comment: 'Muxlisa opa paying back', slug: 'transfer', account: 'humo', reimburses: 4 },
];

export const OWED: PlanOwed[] = [
  { id: '00000000-0000-4000-8000-5d0000000101', person: 'Muxlisa opa', originalMinor: som(930_823.89), openMinor: som(930_823.89) - k(310), dueOn: null },
  { id: '00000000-0000-4000-8000-5d0000000102', person: 'Dior', originalMinor: k(50), openMinor: k(50), dueOn: '2026-11-30' },
];

/** Balances at 25 Nov ~22:00 Tashkent. */
export const COUNTS: PlanCount[] = [
  { account: 'cash', minor: som(160_000) },
  { account: 'humo', minor: som(3_711_800.5) },
  { account: 'uzum', minor: som(350_805.23) },
  { account: 'ofb', minor: som(800.44) },
  { account: 'c7113', minor: 0 },
];

const rowId = (n: number) => `00000000-0000-4000-8000-5d00000002${String(n).padStart(2, '0')}`;
const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
/** "2026-11-23 19:03" Tashkent -> "2026-11-23T14:03:00Z". */
export function toUtc(at: string): string {
  return new Date(`${at.replace(' ', 'T')}:00+05:00`).toISOString().replace('.000Z', 'Z');
}
const fmt = (minor: number) => (minor / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function renderPlan(): string {
  const out = ['# | when (Tashkent) | line | category | account'];
  for (const r of ROWS) {
    const sign = r.moveTo ? '⇄' : r.direction === 'income' ? '+' : '−';
    const acct = r.moveTo ? `${r.account} → ${r.moveTo}` : r.account;
    out.push(`${r.n} | ${r.at} | ${sign}${fmt(r.minor)} ${r.comment} | ${r.slug} | ${acct}${r.confirm ? ' ?' : ''}`);
  }
  out.push('', 'Owed to me:');
  for (const o of OWED) out.push(`  ${o.person}: open ${fmt(o.openMinor)} of ${fmt(o.originalMinor)}${o.dueOn ? `, due ${o.dueOn}` : ''}`);
  out.push('', `Balance counts on ${COUNT_DAY}:`);
  for (const c of COUNTS) out.push(`  ${c.account}: ${fmt(c.minor)}`);
  return out.join('\n');
}

const sideSql = (r: PlanRow) => {
  const a = (key: string) => `(SELECT account_id FROM ops_private.bot_account_keys WHERE user_id = v_user AND key = ${q(key)})`;
  if (r.moveTo) return { from: a(r.account), to: a(r.moveTo) };
  return r.direction === 'expense' ? { from: a(r.account), to: 'NULL' } : { from: 'NULL', to: a(r.account) };
};

/** Idempotent: deletes its own batch first, then inserts. Paste in the SQL editor. */
export function toSql(): string {
  const o: string[] = [
    '-- Generated by scripts/starting-data.mjs. Review the plan first. Re-running replaces its own rows only.',
    'DO $$',
    'DECLARE',
    "  v_user UUID := (SELECT user_id FROM ops_private.bot_account_keys WHERE key = 'cash' LIMIT 1);",
    `  v_batch UUID := '${BATCH_ID}';`,
    'BEGIN',
    "  IF v_user IS NULL THEN RAISE EXCEPTION 'account keys missing: paste migration 021 and its setup first'; END IF;",
    "  INSERT INTO finance_categories (user_id, slug, name, icon, color, kind, sort_order)",
    "  VALUES (v_user, 'education', 'Education', '◉', '#8B5CF6', 'expense', 90) ON CONFLICT (user_id, slug) DO NOTHING;",
    '  DELETE FROM transactions WHERE user_id = v_user AND import_batch_id = v_batch;',
    `  DELETE FROM bot_owed WHERE user_id = v_user AND id IN (${OWED.map((x) => q(x.id)).join(', ')});`,
    `  DELETE FROM balance_checkpoints WHERE user_id = v_user AND counted_at = ${q(COUNT_DAY)} AND note = ${q(CHECKPOINT_NOTE)};`,
  ];
  for (const r of ROWS) {
    const s = sideSql(r);
    o.push(
      `  INSERT INTO transactions (id, user_id, category_id, direction, amount_minor, currency, comment, raw_input, category_source, needs_review, occurred_at, date_precision, import_batch_id, from_account_id, to_account_id, reimburses_transaction_id) VALUES (`,
      `    ${q(rowId(r.n))}, v_user, (SELECT id FROM finance_categories WHERE user_id = v_user AND slug = ${q(r.slug)}), ${q(r.direction)}, ${r.minor}, 'UZS', ${q(r.comment)}, ${q('starting-data: ' + r.comment)}, 'confirmed', false, ${q(toUtc(r.at))}, 'day', v_batch, ${s.from}, ${s.to}, ${r.reimburses ? q(rowId(r.reimburses)) : 'NULL'});`
    );
  }
  for (const w of OWED)
    o.push(`  INSERT INTO bot_owed (id, user_id, person, original_minor, open_minor, due_on) VALUES (${q(w.id)}, v_user, ${q(w.person)}, ${w.originalMinor}, ${w.openMinor}, ${w.dueOn ? q(w.dueOn) : 'NULL'});`);
  for (const c of COUNTS)
    o.push(
      `  INSERT INTO balance_checkpoints (user_id, account_id, counted_at, counted_minor, note) VALUES (v_user, (SELECT account_id FROM ops_private.bot_account_keys WHERE user_id = v_user AND key = ${q(c.account)}), ${q(COUNT_DAY)}, ${c.minor}, ${q(CHECKPOINT_NOTE)}) ON CONFLICT (account_id, counted_at) DO UPDATE SET counted_minor = EXCLUDED.counted_minor, note = EXCLUDED.note;`
    );
  o.push('END $$;');
  return o.join('\n');
}

/** Removes exactly what toSql added (the "Education" category is left: it is empty and harmless). */
export function undoSql(): string {
  return [
    'DO $$',
    'DECLARE',
    "  v_user UUID := (SELECT user_id FROM ops_private.bot_account_keys WHERE key = 'cash' LIMIT 1);",
    'BEGIN',
    `  DELETE FROM transactions WHERE user_id = v_user AND import_batch_id = '${BATCH_ID}';`,
    `  DELETE FROM bot_owed WHERE user_id = v_user AND id IN (${OWED.map((x) => q(x.id)).join(', ')});`,
    `  DELETE FROM balance_checkpoints WHERE user_id = v_user AND counted_at = ${q(COUNT_DAY)} AND note = ${q(CHECKPOINT_NOTE)};`,
    'END $$;',
  ].join('\n');
}
