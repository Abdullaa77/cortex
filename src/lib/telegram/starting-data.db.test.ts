import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { toSql, undoSql, ROWS, OWED, COUNTS, toUtc } from './starting-data.ts';

/** The generated SQL, executed against migrations 005–010 + 013 + 021 in PGlite. */
const mig = (f: string) => readFileSync(new URL(`../../../supabase/migrations/${f}`, import.meta.url), 'utf8');
const SCOTT = '00000000-0000-0000-0000-0000000000aa';

const ready = (async () => {
  const db = await PGlite.create();
  await db.exec(`
    CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;
    CREATE SCHEMA auth; CREATE TABLE auth.users (id UUID PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS UUID LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    GRANT USAGE ON SCHEMA auth TO anon, authenticated; GRANT USAGE ON SCHEMA public TO anon, authenticated;
    INSERT INTO auth.users (id) VALUES ('${SCOTT}');
    CREATE TABLE areas (id UUID PRIMARY KEY DEFAULT gen_random_uuid());
    CREATE FUNCTION update_updated_at() RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql;
  `);
  for (const f of ['005_finance.sql', '006_opening_balance.sql', '007_linked_transactions.sql', '008_accounts.sql', '009_checkpoints.sql', '010_beneficiary.sql', '013_ops_ingest.sql', '021_telegram_bot.sql'])
    await db.exec(mig(f));
  await db.query(
    `INSERT INTO finance_categories (user_id, slug, name, kind, sort_order) VALUES
     ($1,'groceries','Groceries','expense',0),($1,'transport','Transport','expense',1),($1,'eating-out','Eating out','expense',2),
     ($1,'phone-internet','Phone','expense',3),($1,'entertainment','Fun','expense',4),($1,'gifts-events','Gifts','expense',5),
     ($1,'travel','Travel','expense',6),($1,'income','Income','income',7),($1,'transfer','Transfer','transfer',8)`,
    [SCOTT]
  );
  for (const k of ['cash', 'humo', 'uzum', 'ofb', 'c7113']) {
    const a = await db.query<{ id: string }>(`INSERT INTO accounts (user_id, name, kind) VALUES ($1,$2,$3) RETURNING id`, [SCOTT, k, k === 'cash' ? 'cash' : 'card']);
    await db.query(`INSERT INTO ops_private.bot_account_keys (user_id, key, account_id) VALUES ($1,$2,$3)`, [SCOTT, k, a.rows[0].id]);
  }
  return db;
})();
after(async () => (await ready).close());

const count = async (sql: string) => Number((await (await ready).query<{ n: string }>(sql)).rows[0].n);

describe('starting data SQL', () => {
  test('Tashkent times convert to UTC', () => {
    assert.equal(toUtc('2026-11-23 19:03'), '2026-11-23T14:03:00Z');
  });

  test('runs, loads every row, owed and count; Education category created', async () => {
    const db = await ready;
    await db.exec(toSql());
    assert.equal(await count(`SELECT count(*) n FROM transactions`), ROWS.length);
    assert.equal(await count(`SELECT count(*) n FROM bot_owed`), OWED.length);
    assert.equal(await count(`SELECT count(*) n FROM balance_checkpoints`), COUNTS.length);
    assert.equal(await count(`SELECT count(*) n FROM finance_categories WHERE slug = 'education'`), 1);
    // the move has both sides, the repayment points at the reimbursement row
    assert.equal(await count(`SELECT count(*) n FROM transactions WHERE from_account_id IS NOT NULL AND to_account_id IS NOT NULL`), 1);
    assert.equal(await count(`SELECT count(*) n FROM transactions WHERE reimburses_transaction_id IS NOT NULL`), 1);
  });

  test('re-run changes nothing (same counts, no duplicates)', async () => {
    const db = await ready;
    await db.exec(toSql());
    assert.equal(await count(`SELECT count(*) n FROM transactions`), ROWS.length);
    assert.equal(await count(`SELECT count(*) n FROM bot_owed`), OWED.length);
    assert.equal(await count(`SELECT count(*) n FROM balance_checkpoints`), COUNTS.length);
  });

  test('undo removes exactly its own rows', async () => {
    const db = await ready;
    await db.query(`INSERT INTO transactions (user_id, direction, amount_minor, raw_input) VALUES ($1,'expense',100,'bot line')`, [SCOTT]);
    await db.exec(undoSql());
    assert.equal(await count(`SELECT count(*) n FROM transactions`), 1);
    assert.equal(await count(`SELECT count(*) n FROM bot_owed`), 0);
    assert.equal(await count(`SELECT count(*) n FROM balance_checkpoints`), 0);
  });
});
