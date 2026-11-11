import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

/**
 * 020, executed: the tickets kind and its 7-day retention. Same harness as
 * ops-job-status.db.test.ts — the actual text of 013, 014, 019 and 020 run in
 * order in PGlite. The first test runs BEFORE 020 so the kind is watched
 * refused, then accepted.
 *
 * What this cannot prove: that 020 is applied to the live database. The first
 * real `ticket` push returning 202 is that.
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
const runId = () => `30000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;

function ledger(payload: Record<string, unknown> = {}) {
  return {
    v: 1,
    kind: 'tickets',
    run_id: runId(),
    producer: { name: 'ticket', host: 'test', version: 'abc1234' },
    started_at: '2026-11-11T16:00:00Z',
    finished_at: '2026-11-11T16:00:01Z',
    payload: {
      tickets: [
        {
          id: 'T-1',
          title: 'Workflow v2',
          status: 'building',
          waves: ['workflow-v2'],
          mrs: ['main-backend!918'],
          heard_at: '2026-11-11T10:00:00Z',
          updated_at: '2026-11-11T16:00:00Z',
          reopened: 0,
        },
      ],
      ...payload,
    },
  };
}

const ready = (async () => {
  const db = await PGlite.create();
  await db.exec(STUB);
  await db.exec(sql('013_ops_ingest.sql'));
  await db.exec(sql('014_ops_intents_kind.sql'));
  await db.exec(sql('019_ops_job_status.sql'));
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

describe('020: tickets kind', () => {
  test('before 020 a tickets run is refused; after it (applied twice — idempotent) it is stored with no mode', async () => {
    assert.deepEqual(await ingest(ledger()), { ok: false, error: 'invalid', detail: 'kind' });
    assert.equal(await count(`kind = 'tickets'`), 0);

    const db = await ready;
    await db.exec(sql('020_ops_tickets.sql'));
    await db.exec(sql('020_ops_tickets.sql'));

    const env = ledger();
    assert.deepEqual(await ingest(env), { ok: true, run_id: env.run_id, duplicate: false });
    assert.equal(await count(`run_id = '${env.run_id}' AND kind = 'tickets' AND mode IS NULL`), 1);
  });

  test('forbidden keys are still refused at any depth, by name', async () => {
    for (const k of ['note', 'body', 'transcript', 'cwd']) {
      const r = await ingest(ledger({ tickets: [{ id: 'T-1', [k]: 'x' }] }));
      assert.equal(r.error, 'forbidden_key', k);
      assert.equal(r.detail, k);
    }
  });

  test('a new tickets run deletes this user’s tickets runs older than 7 days — nothing else', async () => {
    const db = await ready;
    const old = (kind: string, user: string, days: number) =>
      db.query(
        `INSERT INTO public.ops_runs (run_id, user_id, kind, mode, producer, started_at, finished_at, payload, received_at)
         VALUES ($1, $2, $3, NULL, '{}'::jsonb, now(), now(), '{}'::jsonb, now() - ($4 || ' days')::interval)`,
        [runId(), user, kind, String(days)]
      );
    await old('tickets', SCOTT, 8);
    await old('tickets', SCOTT, 6);
    await old('tickets', OTHER, 8);
    await old('job_status', SCOTT, 6);

    assert.equal((await ingest(ledger())).ok, true);
    assert.equal(await count(`kind = 'tickets' AND user_id = '${SCOTT}' AND received_at < now() - interval '7 days'`), 0);
    assert.equal(await count(`kind = 'tickets' AND user_id = '${SCOTT}' AND received_at < now() - interval '5 days'`), 1);
    assert.equal(await count(`kind = 'tickets' AND user_id = '${OTHER}'`), 1);
    assert.equal(await count(`kind = 'job_status' AND user_id = '${SCOTT}'`), 1);
  });

  test('earlier kinds still store, job_status retention still runs — no regression', async () => {
    const env = {
      ...ledger(),
      kind: 'job_status',
      producer: { name: 'job-card', host: 't', version: 'x' },
      payload: { job: 'salary', map: 'm', lead: 'salary', status: 'building', workers: [], tickets: { done: 0, left: 1 }, relays: 0, updated_at: '2026-11-11T16:00:00Z' },
    };
    const db = await ready;
    await db.query(
      `INSERT INTO public.ops_runs (run_id, user_id, kind, mode, producer, started_at, finished_at, payload, received_at)
       VALUES ($1, $2, 'job_status', NULL, '{}'::jsonb, now(), now(), '{}'::jsonb, now() - interval '9 days')`,
      [runId(), SCOTT]
    );
    assert.equal((await ingest(env)).ok, true);
    assert.equal(await count(`kind = 'job_status' AND user_id = '${SCOTT}' AND received_at < now() - interval '7 days'`), 0);
  });
});
