import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

/**
 * The write door, executed — not read off the page. 013's tests, plus 014
 * (widened kind + forbidden_key) run on top of it in the same database, in
 * order, the way the Supabase SQL editor applies them.
 *
 * Same exception to the suite's no-database convention that 012's test took,
 * for the same reason: "the database refuses this" is a claim about what
 * Postgres DOES. The files under test are the actual text of 013 and 014,
 * run as-is in PGlite (Postgres in WASM, in-process, no network, nothing
 * touching the live project). The auth schema and the two Supabase API
 * roles are stubbed with exactly what 013 references.
 *
 * What this cannot prove: that 014 is applied to the live database, or that
 * the live token row exists. `npm run check:migrations` sees `ops_runs` (and
 * reports 014 unprobeable — see its sentinel); the first real push returning
 * 202 for an intent_request run is the rest.
 */

const MIGRATION = readFileSync(
  new URL('../../../supabase/migrations/013_ops_ingest.sql', import.meta.url),
  'utf8'
);
const MIGRATION_014 = readFileSync(
  new URL('../../../supabase/migrations/014_ops_intents_kind.sql', import.meta.url),
  'utf8'
);

const SCOTT = '00000000-0000-0000-0000-0000000000aa';
const OTHER = '00000000-0000-0000-0000-0000000000bb';
const TOKEN = 'k'.repeat(43);
const REVOKED = 'r'.repeat(43);

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
`;

let seq = 0;
const runId = () => `10000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;

function envelope(over: Record<string, unknown> = {}, payload: Record<string, unknown> = {}) {
  return {
    v: 1,
    kind: 'session_check',
    run_id: runId(),
    producer: { name: 'session-check', host: 'test', version: 'abc1234' },
    started_at: '2026-09-23T16:00:00Z',
    finished_at: '2026-09-23T16:00:25Z',
    payload: { mode: 'live', exit_code: 0, verdict: 'ALL CLEAR', checks: [], ...payload },
    ...over,
  };
}

const ready = (async () => {
  const db = await PGlite.create();
  await db.exec(STUB);
  await db.exec(MIGRATION);
  await db.exec(MIGRATION_014);
  await db.query(
    `INSERT INTO ops_private.ingest_tokens (token_hash, user_id, label, revoked_at) VALUES
       (sha256(convert_to($1, 'UTF8')), $3, 'dev box', NULL),
       (sha256(convert_to($2, 'UTF8')), $3, 'old', now())`,
    [TOKEN, REVOKED, SCOTT]
  );
  return db;
})();
after(async () => (await ready).close());

/** Call ops_ingest as the anon role, the way PostgREST would. */
async function ingest(token: string | null, env: unknown) {
  const db = await ready;
  await db.exec('SET ROLE anon');
  try {
    const res = await db.query<{ r: Record<string, unknown> }>(
      'SELECT public.ops_ingest($1, $2::jsonb) AS r',
      [token, JSON.stringify(env)]
    );
    return res.rows[0].r;
  } finally {
    await db.exec('RESET ROLE');
  }
}

async function count(where = 'true') {
  const db = await ready;
  const res = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM public.ops_runs WHERE ${where}`);
  return res.rows[0].n;
}

describe('013: the one write door', () => {
  test('a valid token stores the run, stamped with the token owner', async () => {
    const env = envelope();
    const r = await ingest(TOKEN, env);
    assert.deepEqual(r, { ok: true, run_id: env.run_id, duplicate: false });
    assert.equal(await count(`run_id = '${env.run_id}' AND user_id = '${SCOTT}' AND mode = 'live'`), 1);
  });

  test('the same run_id twice is a duplicate, written once', async () => {
    const env = envelope();
    await ingest(TOKEN, env);
    const again = await ingest(TOKEN, env);
    assert.equal(again.duplicate, true);
    assert.equal(await count(`run_id = '${env.run_id}'`), 1);
  });

  test('a wrong, revoked, short or missing token writes nothing', async () => {
    const before = await count();
    for (const t of ['x'.repeat(43), REVOKED, 'short', null])
      assert.deepEqual(await ingest(t, envelope()), { ok: false, error: 'unauthorized' }, String(t));
    assert.equal(await count(), before);
  });

  test('a forbidden key is refused at any depth, by name', async () => {
    const deep = envelope(
      { kind: 'waves', producer: { name: 'wave', host: 't', version: 'x' } },
      { mode: undefined, waves: [{ slug: 'a', extra: { nested: [{ body: 'prod finding' }] } }] }
    );
    const r = await ingest(TOKEN, deep);
    assert.deepEqual(r, { ok: false, error: 'forbidden_key', detail: 'body' });
    for (const k of ['note', 'content', 'markdown', 'worktree', 'chat', 'source_line']) {
      const r2 = await ingest(TOKEN, envelope({}, { checks: [{ [k]: 'x' }] }));
      assert.equal(r2.error, 'forbidden_key', k);
    }
  });

  test('a key that merely starts with a forbidden word is not refused', async () => {
    const env = envelope(
      { kind: 'waves', producer: { name: 'wave', host: 't', version: 'x' } },
      { mode: undefined, waves: [{ slug: 'a', note_mtime: '2026-09-23T10:00:00Z', chat_x: 1 }] }
    );
    assert.equal((await ingest(TOKEN, env)).ok, true);
  });

  test('unknown kind, session_check without a mode, bad uuid or timestamp: invalid, nothing written', async () => {
    const before = await count();
    assert.equal((await ingest(TOKEN, envelope({ kind: 'deploys' }))).error, 'invalid');
    assert.equal((await ingest(TOKEN, envelope({}, { mode: 'dry' }))).error, 'invalid');
    assert.equal((await ingest(TOKEN, envelope({ run_id: 'not-a-uuid' }))).error, 'invalid');
    // Postgres casts all three of these happily; each would be a lie about freshness.
    assert.equal((await ingest(TOKEN, envelope({ started_at: 'yesterday' }))).error, 'invalid');
    assert.equal((await ingest(TOKEN, envelope({ finished_at: 'infinity' }))).error, 'invalid');
    assert.equal((await ingest(TOKEN, envelope({ finished_at: '2099-01-01T00:00:00Z' }))).error, 'invalid');
    assert.equal((await ingest(TOKEN, envelope({ finished_at: '2026-09-23T15:59:00Z' }))).error, 'invalid', 'before started_at');
    assert.equal(await count(), before);
  });

  test('a waves run carries no mode; a control run keeps its mode', async () => {
    const w = envelope({ kind: 'waves', producer: { name: 'wave', host: 't', version: 'x' } }, { mode: undefined, waves: [] });
    assert.equal((await ingest(TOKEN, w)).ok, true);
    assert.equal(await count(`run_id = '${w.run_id}' AND mode IS NULL`), 1);
    const c = envelope({}, { mode: 'control' });
    assert.equal((await ingest(TOKEN, c)).ok, true);
    assert.equal(await count(`run_id = '${c.run_id}' AND mode = 'control'`), 1);
  });

  test('over 256 KiB is refused', async () => {
    const big = envelope({}, { checks: [{ line: 'x'.repeat(270_000) }] });
    assert.equal((await ingest(TOKEN, big)).error, 'too_large');
  });

  test('no API role can insert, update or delete directly, or read the tokens', async () => {
    const db = await ready;
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`SET ROLE ${role}`);
      for (const sql of [
        `INSERT INTO public.ops_runs (run_id, user_id, kind, mode, producer, started_at, finished_at, payload)
           VALUES ('${runId()}', '${SCOTT}', 'waves', NULL, '{}', now(), now(), '{}')`,
        `UPDATE public.ops_runs SET payload = '{}'`,
        `DELETE FROM public.ops_runs`,
        `SELECT * FROM ops_private.ingest_tokens`,
      ]) {
        await assert.rejects(db.query(sql), /permission denied/, `${role}: ${sql.slice(0, 30)}`);
      }
      await db.exec('RESET ROLE');
    }
  });

  test('RLS: the owner reads their runs, another user reads none', async () => {
    const db = await ready;
    await db.exec(`GRANT SELECT ON public.ops_runs TO authenticated; SET ROLE authenticated`);
    try {
      await db.exec(`SET request.jwt.claim.sub = '${SCOTT}'`);
      const mine = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM public.ops_runs');
      assert.ok(mine.rows[0].n > 0);
      await db.exec(`SET request.jwt.claim.sub = '${OTHER}'`);
      const theirs = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM public.ops_runs');
      assert.equal(theirs.rows[0].n, 0);
    } finally {
      await db.exec('RESET ROLE');
    }
  });
});

describe('014: intents kind + widened forbidden key', () => {
  test('an intent_request run is stored, carrying no mode', async () => {
    const env = envelope(
      { kind: 'intent_request', producer: { name: 'intent-hook', host: 'test', version: 'abc1234' } },
      { mode: undefined, session_id: 'sess-abc123', asked_at: '2026-09-24T10:00:00Z', notification_type: 'agent_needs_input' }
    );
    const r = await ingest(TOKEN, env);
    assert.deepEqual(r, { ok: true, run_id: env.run_id, duplicate: false });
    assert.equal(await count(`run_id = '${env.run_id}' AND kind = 'intent_request' AND mode IS NULL`), 1);
  });

  test('a waves run carrying the new wave keys (scope, claimed, shippable, status=parked) is stored', async () => {
    const env = envelope(
      { kind: 'waves', producer: { name: 'wave', host: 't', version: 'x' } },
      {
        mode: undefined,
        waves: [
          {
            slug: 'a',
            note_mtime: '2026-09-24T10:00:00Z',
            status: 'parked',
            scope: 'human-readable one-liner',
            scope_truncated: true,
            claimed: true,
            claimed_age_seconds: 14401,
            shippable: true,
            shippable_checked_at: '2026-09-24T09:00:00Z',
          },
        ],
      }
    );
    const r = await ingest(TOKEN, env);
    assert.equal(r.ok, true);
    assert.equal(await count(`run_id = '${env.run_id}'`), 1);
  });

  test('cwd, transcript_path and tool_input are refused at any depth, by name', async () => {
    for (const k of ['cwd', 'transcript_path', 'tool_input']) {
      const env = envelope({}, { checks: [{ [k]: 'x' }] });
      const r = await ingest(TOKEN, env);
      assert.equal(r.error, 'forbidden_key', k);
      assert.equal(r.detail, k);
    }
  });

  test('a pre-014 kind (session_check) still stores — no regression', async () => {
    const env = envelope();
    const r = await ingest(TOKEN, env);
    assert.deepEqual(r, { ok: true, run_id: env.run_id, duplicate: false });
    assert.equal(await count(`run_id = '${env.run_id}' AND kind = 'session_check'`), 1);
  });
});
