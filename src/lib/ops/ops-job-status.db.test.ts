import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

/**
 * 019, executed: the job_status kind, three more forbidden keys, and the
 * 7-day job_status retention. Same harness as ops-ingest.db.test.ts — the
 * actual text of 013, 014 and 019 run in order in PGlite, the way the
 * Supabase SQL editor applies them. The first test runs BEFORE 019 so the
 * kind is watched refused, then accepted.
 *
 * What this cannot prove: that 019 is applied to the live database. The first
 * real job-card push returning 202 is that.
 */

const sql = (f: string) => readFileSync(new URL(`../../../supabase/migrations/${f}`, import.meta.url), 'utf8');

const SCOTT = '00000000-0000-0000-0000-0000000000aa';
const OTHER = '00000000-0000-0000-0000-0000000000bb';
const TOKEN = 'k'.repeat(43);

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
const runId = () => `20000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;

function card(payload: Record<string, unknown> = {}) {
  return {
    v: 1,
    kind: 'job_status',
    run_id: runId(),
    producer: { name: 'job-card', host: 'test', version: 'abc1234' },
    started_at: '2026-10-15T16:00:00Z',
    finished_at: '2026-10-15T16:00:01Z',
    payload: {
      job: 'salary',
      map: 'lead-and-workers',
      lead: 'salary',
      status: 'building',
      workers: [{ name: 'salary·t1', ticket: 'salary-export', model: 'sonnet' }],
      tickets: { done: 1, left: 3 },
      relays: 0,
      updated_at: '2026-10-15T16:00:00Z',
      ...payload,
    },
  };
}

const ready = (async () => {
  const db = await PGlite.create();
  await db.exec(STUB);
  await db.exec(sql('013_ops_ingest.sql'));
  await db.exec(sql('014_ops_intents_kind.sql'));
  await db.query(
    `INSERT INTO ops_private.ingest_tokens (token_hash, user_id, label, revoked_at)
     VALUES (sha256(convert_to($1, 'UTF8')), $2, 'dev box', NULL)`,
    [TOKEN, SCOTT]
  );
  return db;
})();
after(async () => (await ready).close());

/** Call ops_ingest as the anon role, the way PostgREST would. */
async function ingest(env: unknown) {
  const db = await ready;
  await db.exec('SET ROLE anon');
  try {
    const res = await db.query<{ r: Record<string, unknown> }>('SELECT public.ops_ingest($1, $2::jsonb) AS r', [
      TOKEN,
      JSON.stringify(env),
    ]);
    return res.rows[0].r;
  } finally {
    await db.exec('RESET ROLE');
  }
}

async function count(where: string) {
  const db = await ready;
  const res = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM public.ops_runs WHERE ${where}`);
  return res.rows[0].n;
}

describe('019: job_status kind', () => {
  test('before 019 a job_status run is refused; after it (applied twice — idempotent) it is stored with no mode', async () => {
    assert.deepEqual(await ingest(card()), { ok: false, error: 'invalid', detail: 'kind' });
    assert.equal(await count(`kind = 'job_status'`), 0);

    const db = await ready;
    await db.exec(sql('019_ops_job_status.sql'));
    await db.exec(sql('019_ops_job_status.sql'));

    const env = card();
    assert.deepEqual(await ingest(env), { ok: true, run_id: env.run_id, duplicate: false });
    assert.equal(await count(`run_id = '${env.run_id}' AND kind = 'job_status' AND mode IS NULL`), 1);
  });

  test('transcript, tool_output and tool_response are refused at any depth, by name; the earlier keys still are', async () => {
    for (const k of ['transcript', 'tool_output', 'tool_response', 'cwd', 'transcript_path', 'tool_input', 'body']) {
      const r = await ingest(card({ workers: [{ name: 'salary·t1', ticket: 'x', [k]: 'x' }] }));
      assert.equal(r.error, 'forbidden_key', k);
      assert.equal(r.detail, k);
    }
  });

  test('a new job_status run deletes this user’s job_status runs older than 7 days — nothing else', async () => {
    const db = await ready;
    const old = (kind: string, user: string, days: number) =>
      db.query(
        `INSERT INTO public.ops_runs (run_id, user_id, kind, mode, producer, started_at, finished_at, payload, received_at)
         VALUES ($1, $2, $3, NULL, '{}'::jsonb, now(), now(), '{}'::jsonb, now() - ($4 || ' days')::interval)`,
        [runId(), user, kind, String(days)]
      );
    await old('job_status', SCOTT, 8);
    await old('job_status', SCOTT, 6);
    await old('job_status', OTHER, 8);
    await old('intent_request', SCOTT, 8);

    assert.equal((await ingest(card())).ok, true);
    assert.equal(await count(`kind = 'job_status' AND user_id = '${SCOTT}' AND received_at < now() - interval '7 days'`), 0);
    assert.equal(await count(`kind = 'job_status' AND user_id = '${SCOTT}' AND received_at < now() - interval '5 days'`), 1);
    assert.equal(await count(`kind = 'job_status' AND user_id = '${OTHER}'`), 1);
    assert.equal(await count(`kind = 'intent_request' AND user_id = '${SCOTT}'`), 1);
  });

  test('an earlier kind still stores — no regression', async () => {
    const env = {
      ...card(),
      kind: 'session_check',
      producer: { name: 'session-check', host: 't', version: 'x' },
      payload: { mode: 'live', exit_code: 0, verdict: 'ALL CLEAR', checks: [] },
    };
    assert.equal((await ingest(env)).ok, true);
  });
});
