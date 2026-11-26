import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

/**
 * Migration 021 (the bot's database door), executed — not read off the page.
 * Runs the real finance migrations 005–010 plus 021 in PGlite, in order, the
 * way the Supabase SQL editor applies them. Only `auth`, the two API roles,
 * `areas` and `update_updated_at` (001) are stubbed.
 *
 * Cannot prove: that 021 is applied to the live project, or that the live
 * token / account-key rows exist. `npm run check:migrations` sees `bot_owed`.
 */

const mig = (f: string) =>
  readFileSync(new URL(`../../../supabase/migrations/${f}`, import.meta.url), 'utf8');

const SCOTT = '00000000-0000-0000-0000-0000000000aa';
const OTHER = '00000000-0000-0000-0000-0000000000bb';
const TOKEN = 'k'.repeat(43);
const REVOKED = 'r'.repeat(43);
const OTHER_TOKEN = 'o'.repeat(43);

const STUB = `
  CREATE ROLE anon NOLOGIN;
  CREATE ROLE authenticated NOLOGIN;
  CREATE SCHEMA auth;
  CREATE TABLE auth.users (id UUID PRIMARY KEY);
  CREATE FUNCTION auth.uid() RETURNS UUID LANGUAGE sql STABLE
    AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  GRANT USAGE ON SCHEMA auth TO anon, authenticated;
  GRANT USAGE ON SCHEMA public TO anon, authenticated;
  INSERT INTO auth.users (id) VALUES ('${SCOTT}'), ('${OTHER}');
  CREATE TABLE areas (id UUID PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE FUNCTION update_updated_at() RETURNS TRIGGER AS $$
  BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql;
`;

const ready = (async () => {
  const db = await PGlite.create();
  await db.exec(STUB);
  for (const f of [
    '005_finance.sql',
    '006_opening_balance.sql',
    '007_linked_transactions.sql',
    '008_accounts.sql',
    '009_checkpoints.sql',
    '010_beneficiary.sql',
    '013_ops_ingest.sql',
    '021_telegram_bot.sql',
  ])
    await db.exec(mig(f));

  // seed_finance_categories() checks auth.uid(); insert the rows the tests use directly.
  for (const u of [SCOTT, OTHER])
    await db.query(
      `INSERT INTO finance_categories (user_id, slug, name, kind, sort_order) VALUES
         ($1, 'eating-out', 'Eating out', 'expense', 2),
         ($1, 'groceries', 'Groceries', 'expense', 0),
         ($1, 'income', 'Income', 'income', 15),
         ($1, 'transfer', 'Transfer / debt', 'transfer', 16)`,
      [u]
    );
  await db.query(
    `INSERT INTO ops_private.bot_tokens (token_hash, user_id, label, revoked_at) VALUES
       (sha256(convert_to($1, 'UTF8')), $4, 'vercel', NULL),
       (sha256(convert_to($2, 'UTF8')), $4, 'old', now()),
       (sha256(convert_to($3, 'UTF8')), $5, 'other', NULL)`,
    [TOKEN, REVOKED, OTHER_TOKEN, SCOTT, OTHER]
  );
  for (const [uid, keys] of [
    [SCOTT, ['cash', 'humo']],
    [OTHER, ['cash', 'humo']],
  ] as const)
    for (const k of keys) {
      const a = await db.query<{ id: string }>(
        `INSERT INTO accounts (user_id, name, kind) VALUES ($1, $2, $3) RETURNING id`,
        [uid, `${k}-${uid.slice(-2)}`, k === 'cash' ? 'cash' : 'card']
      );
      await db.query(
        `INSERT INTO ops_private.bot_account_keys (user_id, key, account_id) VALUES ($1, $2, $3)`,
        [uid, k, a.rows[0].id]
      );
    }
  return db;
})();
after(async () => (await ready).close());

type J = Record<string, any>;

/** Call a public function as anon, the way PostgREST would. */
async function rpc(fn: string, ...args: unknown[]): Promise<J> {
  const db = await ready;
  await db.exec('SET ROLE anon');
  try {
    const ph = args.map((_, i) => `$${i + 1}`).join(', ');
    const res = await db.query<{ r: J }>(`SELECT public.${fn}(${ph}) AS r`, args);
    return res.rows[0].r;
  } finally {
    await db.exec('RESET ROLE');
  }
}

const draft = (over: J = {}) => ({
  direction: 'expense',
  amount_minor: 1000000,
  comment: 'lunch',
  category_slug: 'eating-out',
  account: 'cash',
  ...over,
});

describe('021 — who can call', () => {
  test('anon cannot read or write any bot table or the ops_private schema', async () => {
    const db = await ready;
    await db.exec('SET ROLE anon');
    try {
      await assert.rejects(db.query('SELECT * FROM ops_private.bot_tokens'));
      await assert.rejects(db.query('SELECT * FROM ops_private.bot_pending'));
      await assert.rejects(db.query('SELECT * FROM ops_private.bot_account_keys'));
      await assert.rejects(db.query(`INSERT INTO public.bot_owed (user_id, person, original_minor, open_minor)
                                     VALUES ('${SCOTT}', 'x', 1, 1)`));
      await assert.rejects(db.query(`SELECT ops_private.bot_user('${TOKEN}')`));
    } finally {
      await db.exec('RESET ROLE');
    }
  });

  test('wrong, short, null and revoked tokens are refused by every door', async () => {
    const id = '00000000-0000-0000-0000-000000000001';
    for (const t of ['x'.repeat(43), 'short', null, REVOKED]) {
      assert.equal((await rpc('bot_capture', t, 'x', JSON.stringify([draft()]))).error, 'unauthorized');
      assert.equal((await rpc('bot_undo', t, id)).error, 'unauthorized');
      assert.equal((await rpc('bot_context', t)).error, 'unauthorized');
      assert.equal((await rpc('bot_pending_resolve', t, id)).error, 'unauthorized');
      assert.equal((await rpc('bot_owed_add', t, 'a', 1, null)).error, 'unauthorized');
    }
  });
});

describe('021 — capture, undo, edit', () => {
  test('capture stores an expense against the account, then undo removes it', async () => {
    const r = await rpc('bot_capture', TOKEN, '-10k lunch', JSON.stringify([draft()]));
    assert.equal(r.ok, true);
    assert.equal(r.saved[0].direction, 'expense');
    assert.equal(r.saved[0].account, 'cash');
    assert.equal(r.saved[0].categorySlug, 'eating-out');
    const u = await rpc('bot_undo', TOKEN, r.saved[0].id);
    assert.equal(u.ok, true);
    assert.equal((await rpc('bot_undo', TOKEN, r.saved[0].id)).error, 'not_found');
  });

  test('income lands on to_account; a bad draft rolls back the whole message', async () => {
    const ok = await rpc('bot_capture', TOKEN, '+1M', JSON.stringify([draft({ direction: 'income', account: 'humo' })]));
    assert.equal(ok.saved[0].account, 'humo');
    const db = await ready;
    const before = (await db.query<{ n: number }>('SELECT count(*)::int n FROM transactions')).rows[0].n;
    const bad = await rpc('bot_capture', TOKEN, 'x', JSON.stringify([draft(), draft({ account: 'nope' })]));
    assert.equal(bad.ok, false);
    assert.equal((await db.query<{ n: number }>('SELECT count(*)::int n FROM transactions')).rows[0].n, before);
  });

  test('set_category learns a rule; set_account moves an expense', async () => {
    const r = await rpc('bot_capture', TOKEN, 'x', JSON.stringify([draft({ comment: 'Plov  Place', category_slug: null })]));
    const id = r.saved[0].id;
    const c = await rpc('bot_set_category', TOKEN, id, 'eating-out');
    assert.equal(c.txn.categorySlug, 'eating-out');
    const ctx = await rpc('bot_context', TOKEN);
    assert.equal(ctx.learned['plov place'], 'eating-out');
    const a = await rpc('bot_set_account', TOKEN, id, 'humo');
    assert.equal(a.txn.account, 'humo');
  });

  test('a move is one transfer row with both accounts; set_account refuses it', async () => {
    const m = await rpc('bot_move', TOKEN, '*250k', 25000000, 'to cash', 'humo', 'cash');
    assert.equal(m.saved[0].direction, 'move');
    assert.equal(m.saved[0].categorySlug, 'transfer');
    assert.equal(m.saved[0].toAccount, 'cash');
    assert.equal((await rpc('bot_set_account', TOKEN, m.saved[0].id, 'humo')).error, 'not_found');
    assert.equal((await rpc('bot_move', TOKEN, 'x', 100, '', 'cash', 'cash')).ok, false);
  });
});

describe('021 — isolation between users', () => {
  test("another user's token cannot touch, edit or undo my rows", async () => {
    const r = await rpc('bot_capture', TOKEN, 'x', JSON.stringify([draft()]));
    const id = r.saved[0].id;
    assert.equal((await rpc('bot_undo', OTHER_TOKEN, id)).error, 'not_found');
    assert.equal((await rpc('bot_set_category', OTHER_TOKEN, id, 'groceries')).error, 'not_found');
    assert.equal((await rpc('bot_set_account', OTHER_TOKEN, id, 'humo')).error, 'not_found');
    assert.equal((await rpc('bot_set_account', TOKEN, id, 'humo')).ok, true);
  });

  test('pending rows are claimed once and are private to their owner', async () => {
    const p = await rpc('bot_pending_put', TOKEN, 'confirm', '10', JSON.stringify({ a: 1 }));
    assert.equal((await rpc('bot_pending_get', OTHER_TOKEN, p.id)).error, 'not_found');
    assert.equal((await rpc('bot_pending_patch', TOKEN, p.id, JSON.stringify({ from: 'humo' }))).ok, true);
    const got = await rpc('bot_pending_resolve', TOKEN, p.id);
    assert.deepEqual(got.payload, { a: 1, from: 'humo' });
    assert.equal((await rpc('bot_pending_resolve', TOKEN, p.id)).error, 'not_found');
  });
});

describe('021 — counts, summary, owed, state', () => {
  test('first count has no basis; a recount the same day replaces it', async () => {
    const day = '2026-11-25';
    assert.equal((await rpc('bot_checkpoint', TOKEN, 'cash', 16000000, day)).ok, true);
    assert.equal((await rpc('bot_checkpoint', TOKEN, 'cash', 17000000, day)).ok, true);
    const inp = await rpc('bot_balance_inputs', TOKEN, 'cash');
    assert.equal(inp.checkpoints.length, 1);
    assert.equal(Number(inp.checkpoints[0].counted_minor), 17000000);
    assert.ok(Array.isArray(inp.rows));
    assert.equal((await rpc('bot_balance_inputs', TOKEN, 'ofb')).ok, false);
  });

  test('day summary totals spending only (transfers excluded), top three', async () => {
    const db = await ready;
    const today = (await db.query<{ d: string }>(
      `SELECT ((now() AT TIME ZONE 'Asia/Tashkent')::date)::text d`)).rows[0].d;
    const s = await rpc('bot_day_summary', TOKEN, today);
    assert.equal(s.ok, true);
    assert.ok(s.top.length <= 3);
    assert.ok(Number(s.totalMinor) > 0);
    // the 250k move above is in 'transfer' and must not be in the total
    assert.ok(!s.top.some((t: J) => t.name === 'Transfer / debt'));
  });

  test('owed: add, reduce never below zero, due list, mine only', async () => {
    const a = await rpc('bot_owed_add', TOKEN, ' Ali ', 500000, '2026-11-20');
    assert.equal(a.ok, true);
    assert.equal((await rpc('bot_owed_add', TOKEN, 'Bad', 0, null)).ok, false);
    assert.equal((await rpc('bot_owed_reduce', OTHER_TOKEN, a.id, 1)).error, 'not_found');
    const r1 = await rpc('bot_owed_reduce', TOKEN, a.id, 200000);
    assert.equal(Number(r1.openMinor), 300000);
    const r2 = await rpc('bot_owed_reduce', TOKEN, a.id, 999999);
    assert.equal(Number(r2.openMinor), 0);
    assert.equal((await rpc('bot_owed_due', OTHER_TOKEN, '2026-11-26')).due.length, 0);
  });

  test('owner can read bot_owed through RLS; another user cannot', async () => {
    const db = await ready;
    await rpc('bot_owed_add', TOKEN, 'Vali', 100, '2027-01-01');
    for (const [uid, expectRows] of [[SCOTT, true], [OTHER, false]] as const) {
      await db.exec(`SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub', '${uid}', false)`);
      try {
        const n = (await db.query<{ n: number }>('SELECT count(*)::int n FROM public.bot_owed')).rows[0].n;
        assert.equal(n > 0, expectRows);
      } finally {
        await db.exec('RESET ROLE');
      }
    }
  });

  test('state: patch applies present keys only; bad value refused', async () => {
    assert.equal((await rpc('bot_state_set', TOKEN, JSON.stringify({ pendingBalance: 'cash' }))).ok, true);
    assert.equal((await rpc('bot_state_set', TOKEN, JSON.stringify({ snoozeUntil: '2026-11-26T12:00:00Z' }))).ok, true);
    const ctx = await rpc('bot_context', TOKEN);
    assert.equal(ctx.pendingBalance, 'cash');
    assert.ok(ctx.snoozeUntil);
    assert.equal((await rpc('bot_state_set', TOKEN, JSON.stringify({ pendingBalance: 'bogus' }))).ok, false);
    assert.equal((await rpc('bot_state_set', TOKEN, JSON.stringify({ pendingBalance: null }))).ok, true);
    assert.equal((await rpc('bot_context', TOKEN)).pendingBalance, null);
  });
});
