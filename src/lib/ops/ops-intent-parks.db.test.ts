import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

/**
 * 017, executed — the 60-minute park path's database guards. 013 → 017 in
 * order, in PGlite, with Supabase's default EXECUTE grant mirrored (see
 * ops-intents.db.test.ts for why).
 */

const read = (f: string) => readFileSync(new URL(`../../../supabase/migrations/${f}`, import.meta.url), 'utf8');
const MIGRATIONS = [
  '013_ops_ingest.sql',
  '014_ops_intents_kind.sql',
  '015_ops_intents.sql',
  '016_ops_intents_decisions.sql',
  '017_ops_intent_parks.sql',
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
const runId = () => `40000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;

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
  await db.exec('GRANT SELECT ON public.ops_runs, public.ops_intents, public.ops_intent_parks TO anon, authenticated');
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
const answer = (run: string, text = 'B') => rpc('ops_intent_answer', [run, 'choose', text], 'authenticated', SCOTT);

describe('017: which questions are overdue', () => {
  test('a blocked decision question asked 61m ago is overdue; 59m ago is not', async () => {
    const old = await asked(61);
    const fresh = await asked(59);
    const ids = await overdueIds();
    assert.ok(ids.includes(old));
    assert.equal(ids.includes(fresh), false);
  });

  test('idle rows, permission prompts, and answered or already-parked questions never come back', async () => {
    const idle = await asked(90, { wait_state: 'idle', notification_type: 'idle_prompt' });
    const legacyIdle = await asked(90, { wait_state: undefined, notification_type: 'idle_prompt' });
    const perm = await asked(90, {
      trigger: 'permission_request', notification_type: undefined, question: undefined, tool_name: 'Bash', action: 'ls',
    });
    const answered = await asked(90);
    assert.equal((await answer(answered)).ok, true);
    const parked = await asked(90);
    assert.equal((await rpc('ops_intent_park', [TOKEN, parked])).ok, true);
    const ids = await overdueIds();
    for (const x of [idle, legacyIdle, perm, answered, parked]) assert.equal(ids.includes(x), false, x);
  });

  test('older than 24h drops out; another owner’s questions never appear; a bad token gets nothing', async () => {
    const ancient = await asked(25 * 60);
    const theirs = await asked(90, {}, OTHER_TOKEN);
    const ids = await overdueIds();
    assert.equal(ids.includes(ancient), false);
    assert.equal(ids.includes(theirs), false);
    assert.deepEqual(await rpc('ops_intents_overdue', ['x'.repeat(43)]), { ok: false, error: 'unauthorized' });
  });
});

describe('017: recording a park', () => {
  test('park is recorded once, idempotently', async () => {
    const run = await asked(70);
    assert.deepEqual(await rpc('ops_intent_park', [TOKEN, run]), { ok: true, run_id: run, duplicate: false });
    assert.deepEqual(await rpc('ops_intent_park', [TOKEN, run]), { ok: true, run_id: run, duplicate: true });
  });

  test('too early, answered, idle, not mine, bad token: refused, nothing recorded', async () => {
    const early = await asked(30);
    assert.equal((await rpc('ops_intent_park', [TOKEN, early])).error, 'too_early');
    const ans = await asked(70);
    await answer(ans);
    assert.equal((await rpc('ops_intent_park', [TOKEN, ans])).error, 'answered');
    const idle = await asked(70, { wait_state: 'idle', notification_type: 'idle_prompt' });
    assert.equal((await rpc('ops_intent_park', [TOKEN, idle])).error, 'not_parkable');
    const mine = await asked(70);
    assert.equal((await rpc('ops_intent_park', [OTHER_TOKEN, mine])).error, 'not_found');
    assert.equal((await rpc('ops_intent_park', ['x'.repeat(43), mine])).error, 'unauthorized');
    const db = await ready;
    const n = await db.query(`SELECT 1 FROM public.ops_intent_parks WHERE run_id IN ($1, $2, $3, $4)`, [early, ans, idle, mine]);
    assert.equal(n.rows.length, 0);
  });

  test('a park record is never changed or deleted, even by the owner role', async () => {
    const run = await asked(70);
    await rpc('ops_intent_park', [TOKEN, run]);
    const db = await ready;
    await assert.rejects(db.query(`UPDATE public.ops_intent_parks SET parked_at = now() WHERE run_id = $1`, [run]), /append-only/);
    await assert.rejects(db.query(`DELETE FROM public.ops_intent_parks WHERE run_id = $1`, [run]), /append-only/);
    await assert.rejects(
      as('authenticated', SCOTT, (d) => d.query(`INSERT INTO public.ops_intent_parks (run_id, user_id) VALUES ($1, $2)`, [run, SCOTT])),
      /permission denied/
    );
  });
});

describe('017: an answer to a parked question goes to the note, never the session', () => {
  test('pending carries parked_at; applied is refused; noted moves it pending → parked', async () => {
    const run = await asked(70);
    await rpc('ops_intent_park', [TOKEN, run]);
    const a = await answer(run, 'Option B');
    const id = a.id as string;
    const row = ((await rpc('ops_intents_pending', [TOKEN])).intents as R[]).find((x) => x.id === id)!;
    assert.ok(row.parked_at, 'parked_at present');
    assert.equal((await rpc('ops_intent_applied', [TOKEN, id])).error, 'invalid_transition');
    assert.deepEqual(await rpc('ops_intent_noted', [TOKEN, id]), { ok: true, id, duplicate: false });
    assert.deepEqual(await rpc('ops_intent_noted', [TOKEN, id]), { ok: true, id, duplicate: true });
    const db = await ready;
    assert.equal((await db.query<R>(`SELECT status FROM public.ops_intents WHERE id = $1`, [id])).rows[0].status, 'parked');
  });

  test('an unparked question: parked_at is null, noted is refused, applied works', async () => {
    const run = await asked(5);
    const id = (await answer(run)).id as string;
    const row = ((await rpc('ops_intents_pending', [TOKEN])).intents as R[]).find((x) => x.id === id)!;
    assert.equal(row.parked_at, null);
    assert.equal((await rpc('ops_intent_noted', [TOKEN, id])).error, 'not_parked');
    assert.equal((await rpc('ops_intent_applied', [TOKEN, id])).ok, true);
  });

  test('noted: bad token and another owner’s token refused', async () => {
    const run = await asked(70);
    await rpc('ops_intent_park', [TOKEN, run]);
    const id = (await answer(run)).id as string;
    assert.equal((await rpc('ops_intent_noted', ['x'.repeat(43), id])).error, 'unauthorized');
    assert.equal((await rpc('ops_intent_noted', [OTHER_TOKEN, id])).error, 'not_found');
  });
});
