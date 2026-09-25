import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

/**
 * 018, executed — band-3 resolutions. 013 → 018 in order, in PGlite, with
 * Supabase's default EXECUTE grant mirrored (see ops-intents.db.test.ts).
 */

const read = (f: string) => readFileSync(new URL(`../../../supabase/migrations/${f}`, import.meta.url), 'utf8');
const MIGRATIONS = [
  '013_ops_ingest.sql',
  '014_ops_intents_kind.sql',
  '015_ops_intents.sql',
  '016_ops_intents_decisions.sql',
  '017_ops_intent_parks.sql',
  '018_ops_intent_resolutions.sql',
].map(read);

const SCOTT = '00000000-0000-0000-0000-0000000000aa';
const OTHER = '00000000-0000-0000-0000-0000000000bb';
const TOKEN = 'k'.repeat(43);
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
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated;
  INSERT INTO auth.users (id) VALUES ('${SCOTT}'), ('${OTHER}');
`;

const isoAgo = (min: number) => new Date(Date.now() - min * 60_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
let seq = 0;
const runId = () => `41000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;

function intentRun(askedMinAgo: number, payload: Record<string, unknown> = {}) {
  return {
    v: 1,
    kind: 'intent_request',
    run_id: runId(),
    producer: { name: 'intent-hook', host: 'test', version: 'abc1234' },
    started_at: isoAgo(askedMinAgo),
    finished_at: isoAgo(askedMinAgo),
    payload: {
      session_id: 'sess-park',
      trigger: 'notification',
      wait_state: 'blocked',
      notification_type: 'agent_needs_input',
      question: 'Option A or B?',
      asked_at: isoAgo(askedMinAgo),
      ...payload,
    },
  };
}

const ready = (async () => {
  const db = await PGlite.create();
  await db.exec(STUB);
  for (const m of MIGRATIONS) await db.exec(m);
  await db.exec('GRANT SELECT ON public.ops_runs, public.ops_intents, public.ops_intent_parks, public.ops_intent_resolutions TO anon, authenticated');
  await db.query(
    `INSERT INTO ops_private.ingest_tokens (token_hash, user_id, label) VALUES
       (sha256(convert_to($1, 'UTF8')), $3, 'dev box'), (sha256(convert_to($2, 'UTF8')), $4, 'other')`,
    [TOKEN, OTHER_TOKEN, SCOTT, OTHER]
  );
  return db;
})();
after(async () => (await ready).close());

type R = Record<string, unknown>;

async function as<T>(role: 'anon' | 'authenticated', sub: string | null, fn: (db: PGlite) => Promise<T>): Promise<T> {
  const db = await ready;
  await db.exec(`SET ROLE ${role}`);
  await db.query(`SELECT set_config('request.jwt.claim.sub', $1, false)`, [sub ?? '']);
  try {
    return await fn(db);
  } finally {
    await db.exec('RESET ROLE');
    await db.query(`SELECT set_config('request.jwt.claim.sub', '', false)`);
  }
}
const rpc = (fn: string, args: unknown[], role: 'anon' | 'authenticated' = 'anon', sub: string | null = null) =>
  as(role, sub, async (db) => {
    const ph = args.map((_, i) => `$${i + 1}`).join(', ');
    return (await db.query<{ r: R }>(`SELECT public.${fn}(${ph}) AS r`, args)).rows[0].r;
  });

async function asked(minAgo: number, payload: Record<string, unknown> = {}, token = TOKEN): Promise<string> {
  const env = intentRun(minAgo, payload);
  const r = await rpc('ops_ingest', [token, JSON.stringify(env)]);
  assert.equal(r.ok, true, JSON.stringify(r));
  return env.run_id;
}
const overdueIds = async (token = TOKEN) => ((await rpc('ops_intents_overdue', [token])).overdue as R[]).map((x) => x.run_id);

const openIds = async (token = TOKEN) => ((await rpc('ops_intents_open', [token])).open as R[]).map((x) => x.run_id);
const resolve = (run: string, reason = 'moved_on', token = TOKEN) => rpc('ops_intent_resolve', [token, run, reason]);

describe('018: open rows and resolving them', () => {
  test('a new row is open, carrying what the daemon needs; resolving removes it; a second resolve is a duplicate', async () => {
    const run = await asked(5, { trigger: 'stop', wait_state: 'idle', notification_type: undefined });
    const row = ((await rpc('ops_intents_open', [TOKEN])).open as R[]).find((x) => x.run_id === run)!;
    assert.deepEqual(Object.keys(row).sort(), ['asked_at', 'run_id', 'session_id', 'trigger']);
    assert.equal(row.trigger, 'stop');
    assert.deepEqual(await resolve(run), { ok: true, run_id: run, duplicate: false });
    assert.equal((await openIds()).includes(run), false);
    assert.deepEqual(await resolve(run, 'session_exited'), { ok: true, run_id: run, duplicate: true });
    // The first reason stands — a resolution is never rewritten.
    const db = await ready;
    assert.equal((await db.query<R>('SELECT reason FROM public.ops_intent_resolutions WHERE run_id = $1', [run])).rows[0].reason, 'moved_on');
  });

  test('every reason is accepted; anything else is refused', async () => {
    for (const reason of ['moved_on', 'superseded', 'session_exited', 'manual']) {
      assert.equal((await resolve(await asked(5), reason)).ok, true, reason);
    }
    assert.deepEqual(await resolve(await asked(5), 'deleted'), { ok: false, error: 'invalid', detail: 'reason' });
    assert.deepEqual(await resolve(await asked(5), null as unknown as string), { ok: false, error: 'invalid', detail: 'reason' });
  });

  test('another owner’s row is not_found and never listed; a bad token gets nothing; a non-intent run is not_found', async () => {
    const theirs = await asked(5, {}, OTHER_TOKEN);
    assert.equal((await openIds()).includes(theirs), false);
    assert.deepEqual(await resolve(theirs), { ok: false, error: 'not_found' });
    assert.deepEqual(await rpc('ops_intents_open', ['x'.repeat(43)]), { ok: false, error: 'unauthorized' });
    assert.deepEqual(await resolve(await asked(5), 'manual', 'x'.repeat(43)), { ok: false, error: 'unauthorized' });
    assert.deepEqual(await resolve('41000000-0000-4000-8000-999999999999'), { ok: false, error: 'not_found' });
  });

  test('older than 24h is not open', async () => {
    const ancient = await asked(25 * 60);
    assert.equal((await openIds()).includes(ancient), false);
  });

  test('a resolved question never comes back as overdue', async () => {
    const run = await asked(70);
    assert.ok((await overdueIds()).includes(run));
    await resolve(run, 'session_exited');
    assert.equal((await overdueIds()).includes(run), false);
  });
});

describe('018: append-only, owner-read-only', () => {
  test('update and delete are refused, even for the table owner', async () => {
    const run = await asked(5);
    await resolve(run);
    const db = await ready;
    await assert.rejects(db.query(`UPDATE public.ops_intent_resolutions SET reason = 'manual' WHERE run_id = $1`, [run]), /append-only/);
    await assert.rejects(db.query('DELETE FROM public.ops_intent_resolutions WHERE run_id = $1', [run]), /append-only/);
  });

  test('anon and authenticated cannot insert; RLS shows Scott only his own rows', async () => {
    const mine = await asked(5);
    const theirs = await asked(5, {}, OTHER_TOKEN);
    await resolve(mine);
    await resolve(theirs, 'manual', OTHER_TOKEN);
    for (const role of ['anon', 'authenticated'] as const) {
      await assert.rejects(
        as(role, SCOTT, (db) => db.query(`INSERT INTO public.ops_intent_resolutions (run_id, user_id, reason) VALUES ($1, $2, 'manual')`, [mine, SCOTT])),
        /permission denied/
      );
    }
    const seen = await as('authenticated', SCOTT, async (db) =>
      (await db.query<R>('SELECT run_id FROM public.ops_intent_resolutions')).rows.map((r) => r.run_id)
    );
    assert.ok(seen.includes(mine));
    assert.equal(seen.includes(theirs), false);
  });
});
