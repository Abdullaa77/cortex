#!/usr/bin/env node
/**
 * Recompute the finance figures from a live data dump.
 *
 *   npx supabase db dump --linked --data-only --use-copy --schema public -f /tmp/d.sql
 *   node scripts/verify-finance-dump.mjs /tmp/d.sql
 *
 * Why a second implementation rather than importing summarize.ts: the point is
 * to derive the same numbers a different way. Calling the code under test to
 * check the code under test proves only that it is deterministic. This walks
 * the raw rows and applies the rules from scratch — netting, classification,
 * the ledger-currency filter — so a figure that matches has been arrived at
 * twice, independently.
 *
 * The dump holds real personal data. Write it outside the repo and delete it
 * when you are done; nothing here keeps a copy.
 */
import { readFileSync } from 'node:fs';

const CORE = new Set(['groceries', 'transport', 'eating-out']);
const LEDGER_CURRENCY = 'UZS';
const TZ = 'Asia/Tashkent';

const file = process.argv[2];
if (!file) {
  console.error('usage: node scripts/verify-finance-dump.mjs <dump.sql>');
  process.exit(1);
}

/** Every COPY block in a pg_dump, as arrays of objects keyed by column name. */
function parseCopyBlocks(sql) {
  const tables = new Map();
  const lines = sql.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const head = /^COPY "?public"?\."?(\w+)"? \(([^)]*)\) FROM stdin;/.exec(lines[i]);
    if (!head) continue;

    const [, table, colList] = head;
    const cols = colList.split(',').map((c) => c.trim().replace(/"/g, ''));
    const rows = [];

    for (i++; i < lines.length && lines[i] !== '\\.'; i++) {
      const cells = lines[i].split('\t');
      const row = {};
      cols.forEach((c, n) => {
        const v = cells[n];
        row[c] = v === '\\N' || v === undefined ? null : v;
      });
      rows.push(row);
    }
    tables.set(table, rows);
  }
  return tables;
}

/**
 * The calendar month a timestamp falls in, where the household is. UTC would
 * put a row captured just after midnight into the previous month.
 */
const monthFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
});
function monthKey(pgTimestamp) {
  // pg_dump writes "2026-07-01 00:00:00+00"; Date wants a T and a full offset.
  const iso = pgTimestamp.replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00');
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) throw new Error(`unparseable timestamp: ${pgTimestamp}`);
  const parts = monthFmt.formatToParts(d);
  const y = parts.find((p) => p.type === 'year').value;
  const m = parts.find((p) => p.type === 'month').value;
  return `${y}-${m}`;
}

const fmt = (minor) =>
  (minor / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const tables = parseCopyBlocks(readFileSync(file, 'utf8'));
const get = (t) => tables.get(t) ?? [];

const categories = new Map(get('finance_categories').map((c) => [c.id, c]));
const txns = get('transactions');

// countsTowardLedger — anything not so'm belongs to no figure on that page.
const ledger = txns.filter((t) => (t.currency ?? LEDGER_CURRENCY) === LEDGER_CURRENCY);
const ids = new Set(ledger.map((t) => t.id));

// reimbursementsByTarget — a pointer to a row outside the set is a dangling
// link and is ignored, so the expense it points at stands alone.
const back = new Map();
for (const t of ledger) {
  const target = t.reimburses_transaction_id;
  if (!target || !ids.has(target)) continue;
  back.set(target, (back.get(target) ?? 0) + Number(t.amount_minor));
}

// effectiveMinor — a repayment contributes nothing, a repaid expense
// contributes its remainder, clamped at zero.
function effective(t) {
  const target = t.reimburses_transaction_id;
  if (target && back.has(target)) return 0;
  const returned = back.get(t.id);
  const amount = Number(t.amount_minor);
  return returned ? Math.max(0, amount - returned) : amount;
}

// classifyRow — one answer to "what does this row count as".
function classify(t) {
  const kind = categories.get(t.category_id)?.kind ?? 'expense';
  if (kind === 'transfer') return t.direction === 'income' ? 'transfer-in' : 'transfer-out';
  if (kind === 'income' || t.direction === 'income') return 'income';
  return 'spend';
}

const months = new Map();
for (const t of ledger) {
  const key = monthKey(t.occurred_at);
  if (!months.has(key)) months.set(key, { spend: 0, floor: 0, income: 0, rows: 0 });
  const m = months.get(key);
  m.rows++;

  const minor = effective(t);
  if (minor === 0) continue;

  const klass = classify(t);
  if (klass === 'income') m.income += minor;
  if (klass !== 'spend') continue;

  m.spend += minor;
  const slug = categories.get(t.category_id)?.slug ?? 'uncategorised';
  if (CORE.has(slug)) m.floor += minor;
}

const line = (k, v) => console.log(`  ${String(k).padEnd(42)} ${v}`);

console.log('\nTHE FOUR NUMBERS  (recomputed from the dump, not read from the app)');
for (const [key, m] of [...months].sort()) {
  line(`${key} spend`, fmt(m.spend));
  line(`${key} floor`, fmt(m.floor));
}
line('total rows', txns.length);
line('month-precision', txns.filter((t) => t.date_precision === 'month').length);
line('rows not in so\'m (excluded above)', txns.length - ledger.length);

console.log('\nTHE OPENING BALANCE');
const openings = get('finance_opening_balance');
const checkpoints = get('balance_checkpoints');
const accounts = new Map(get('accounts').map((a) => [a.id, a]));
line('finance_opening_balance rows (011 deferred)', openings.length);
for (const o of openings) {
  const cp = checkpoints.find(
    (c) =>
      c.user_id === o.user_id &&
      c.counted_at === o.as_of &&
      Number(c.counted_minor) === Number(o.amount_minor)
  );
  line('amount / as of', `${fmt(Number(o.amount_minor))} ${o.currency} @ ${o.as_of}`);
  line('landed as a checkpoint', cp ? 'YES' : 'NO');
  if (cp) {
    const acct = accounts.get(cp.account_id);
    line('on account', acct ? `${acct.name} (${acct.currency})` : '(unknown)');
    line('currency matches that account', acct?.currency === o.currency ? 'YES' : `NO — ${o.currency} onto ${acct?.currency}`);
  }
}

console.log('\nTHE NEW OBJECTS');
line('accounts', accounts.size);
line('account names', [...accounts.values()].map((a) => `${a.name} [${a.owner}/${a.currency}]`).join(', '));
line('checkpoints', checkpoints.length);
line('finance_categories', categories.size);
line('finance_settings rows', get('finance_settings').length);
const settings = get('finance_settings')[0];
line('cutover date', settings?.cutover_date ?? 'NONE');
line('default account', settings ? accounts.get(settings.default_account_id)?.name ?? 'NONE' : 'NONE');
line(
  'rows touching no account',
  txns.filter((t) => !t.from_account_id && !t.to_account_id).length
);
line('rows backfilled to household', txns.filter((t) => t.beneficiary !== null).length);
console.log('');
