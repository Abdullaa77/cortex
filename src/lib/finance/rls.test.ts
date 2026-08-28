import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

/**
 * Row level security, checked against the migrations themselves.
 *
 * There is no database in this suite and there should not be — every other
 * test here runs in milliseconds without a session, which is why they get run.
 * But RLS is the one thing whose absence is invisible from inside the app:
 * with a policy missing, every query Scott makes still returns exactly his own
 * rows, because he is the only user. It would look perfect until the second
 * account existed.
 *
 * So the SQL is read as text and the invariant is asserted structurally: any
 * table carrying a `user_id` must enable RLS and must own a policy scoped to
 * `auth.uid()`. That catches the realistic failure — a new table added without
 * the three lines that protect it — which is exactly what happened to be worth
 * catching this stage, with `balance_checkpoints`.
 */

const DIR = new URL('../../../supabase/migrations/', import.meta.url);

const SQL = readdirSync(DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .map((f) => ({ file: f, text: readFileSync(new URL(f, DIR), 'utf8') }));

const ALL = SQL.map((s) => s.text).join('\n');

/** Tables created anywhere in the migrations, with the body of the CREATE. */
function createdTables(): { name: string; body: string; file: string }[] {
  const out: { name: string; body: string; file: string }[] = [];
  for (const { file, text } of SQL) {
    const re = /CREATE TABLE (?:IF NOT EXISTS )?(\w+)\s*\(([\s\S]*?)\n\);/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) out.push({ name: m[1], body: m[2], file });
  }
  return out;
}

/** Tables dropped later, so a retired one is not held to a live standard. */
const DROPPED = new Set(
  [...ALL.matchAll(/DROP TABLE (?:IF EXISTS )?(\w+)/g)].map((m) => m[1])
);

const LIVE = createdTables().filter((t) => !DROPPED.has(t.name));

describe('every table that holds a user\'s rows is closed to everyone else', () => {
  const owned = LIVE.filter((t) => /\buser_id\b/.test(t.body));

  test('there are tables to check, so a broken parser cannot pass silently', () => {
    // Without this, a regex that matched nothing would make every assertion
    // below vacuously true and the whole file worthless.
    assert.ok(owned.length >= 8, `only found ${owned.length} user-owned tables`);
    assert.ok(owned.some((t) => t.name === 'balance_checkpoints'));
    assert.ok(owned.some((t) => t.name === 'accounts'));
    assert.ok(owned.some((t) => t.name === 'finance_settings'));
    assert.ok(owned.some((t) => t.name === 'transactions'));
  });

  for (const table of owned) {
    test(`${table.name} enables row level security`, () => {
      assert.match(
        ALL,
        new RegExp(`ALTER TABLE ${table.name}\\s+ENABLE ROW LEVEL SECURITY`),
        `${table.name} (${table.file}) never enables RLS`
      );
    });

    test(`${table.name} has a policy scoped to auth.uid()`, () => {
      const policy = new RegExp(
        `CREATE POLICY [^\\n]*ON ${table.name}[\\s\\S]{0,200}?auth\\.uid\\(\\)\\s*=\\s*user_id`
      );
      assert.match(ALL, policy, `${table.name} (${table.file}) has no owner policy`);
    });

    test(`${table.name} cascades from auth.users, so deleting an account clears it`, () => {
      assert.match(
        table.body,
        /user_id UUID REFERENCES auth\.users\(id\) ON DELETE CASCADE NOT NULL/,
        `${table.name} would leave orphaned rows behind a deleted user`
      );
    });
  }
});

describe('balance_checkpoints, specifically', () => {
  const sql = SQL.find((s) => s.file.startsWith('009'))!.text;

  test('one count per account per day', () => {
    // Two counts on one day is not two facts, it is one recount — and it would
    // make "the latest checkpoint at-or-before T" ambiguous, which is the one
    // thing the read path cannot afford.
    assert.match(sql, /UNIQUE \(account_id, counted_at\)/);
  });

  test('a count dies with its account, but an adjustment does not', () => {
    assert.match(sql, /account_id UUID REFERENCES accounts\(id\) ON DELETE CASCADE NOT NULL/);
    assert.match(
      sql,
      /adjustment_transaction_id UUID REFERENCES transactions\(id\) ON DELETE SET NULL/
    );
  });

  test('counted_minor carries no positivity check — zero and negative are real', () => {
    assert.equal(/counted_minor BIGINT NOT NULL[^,]*CHECK/.test(sql), false);
  });
});

describe('finance_opening_balance is gone, not merely unused', () => {
  test('the table is dropped', () => {
    // Two places holding "what did you start with" is the drift this codebase
    // keeps killing. Stage 1 wrote down that Stage 2 must migrate and drop it.
    assert.match(ALL, /DROP TABLE finance_opening_balance/);
    assert.equal(LIVE.some((t) => t.name === 'finance_opening_balance'), false);
  });

  test('its figure is migrated into a checkpoint before the drop', () => {
    const sql = SQL.find((s) => s.file.startsWith('009'))!.text;
    const insertAt = sql.indexOf('FROM finance_opening_balance');
    const dropAt = sql.indexOf('DROP TABLE finance_opening_balance');
    assert.ok(insertAt > 0, 'nothing reads the old table before dropping it');
    assert.ok(insertAt < dropAt, 'the drop happens before the migration reads it');
  });

  test("and the accounts' opening columns go with it", () => {
    const sql = SQL.find((s) => s.file.startsWith('009'))!.text;
    assert.match(sql, /DROP COLUMN opening_minor/);
    assert.match(sql, /DROP COLUMN opening_at/);
  });

  test('nothing in the app still reads either of them', () => {
    // A dropped column that some hook still selects is a runtime error nobody
    // sees until the page is opened.
    //
    // Comments are stripped first, deliberately. Prose about why the column
    // was removed is the opposite of a stale reference, and a check that
    // punished writing it down would be a check that discourages explaining
    // the change.
    const src = readdirSync(new URL('../../', import.meta.url), {
      recursive: true,
      withFileTypes: true,
    })
      // Tests excluded: this file names the dropped table on purpose, and a
      // test asserting a name is absent must not trip over itself saying it.
      .filter((d) => d.isFile() && /\.tsx?$/.test(d.name) && !/\.test\.tsx?$/.test(d.name))
      .map((d) => readFileSync(`${d.parentPath}/${d.name}`, 'utf8'))
      .join('\n')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');

    assert.equal(/finance_opening_balance/.test(src), false, 'the dropped table is still queried');
    assert.equal(/\bopening_minor\b/.test(src), false, 'the dropped column is still read');
    assert.equal(/\bopening_at\b/.test(src), false, 'the dropped column is still read');
  });
});

describe('a transaction cannot touch an account of another currency', () => {
  test('there is a trigger, because a CHECK cannot reach another table', () => {
    const sql = SQL.find((s) => s.file.startsWith('009'))!.text;
    assert.match(sql, /CREATE OR REPLACE FUNCTION assert_transaction_account_currency/);
    assert.match(
      sql,
      /CREATE TRIGGER transactions_account_currency[\s\S]*?BEFORE INSERT OR UPDATE/
    );
  });

  test('it checks both sides', () => {
    const sql = SQL.find((s) => s.file.startsWith('009'))!.text;
    const fn = sql.slice(
      sql.indexOf('FUNCTION assert_transaction_account_currency'),
      sql.indexOf('CREATE TRIGGER transactions_account_currency')
    );
    assert.match(fn, /NEW\.from_account_id IS NOT NULL/);
    assert.match(fn, /NEW\.to_account_id IS NOT NULL/);
  });
});
