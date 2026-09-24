import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

/**
 * 015, executed — the return path's database guards. 013 → 014 → 015 run in
 * order in PGlite, as the SQL editor applies them (same exception to the
 * suite's no-database convention as ops-ingest.db.test.ts, same reason: "the
 * database refuses this" is a claim about what Postgres does).
 *
 * Roles are exercised the way PostgREST does it: `SET ROLE authenticated` +
 * the JWT sub GUC for Scott in the browser, `SET ROLE anon` for the daemon.
 *
 * What this cannot prove: that 015 is applied to the live database. The
 * sentinel (`table ops_intents`) makes `npm run check:migrations` see that.
 */

const read = (f: string) => readFileSync(new URL(`../../../supabase/migrations/${f}`, import.meta.url), 'utf8');
const M013 = read('013_ops_ingest.sql');
const M014 = read('014_ops_intents_kind.sql');
const M015 = read('015_ops_intents.sql');

const SCOTT = '00000000-0000-0000-0000-0000000000aa';
const OTHER = '00000000-0000-0000-0000-0000000000bb';
const TOKEN = 'k'.repeat(43);
const OTHER_TOKEN = 'o'.repeat(43);
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
const runId = () => `20000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;

function intentRun(payload: Record<string, unknown> = {}) {
  return {
    v: 1,
    kind: 'intent_request',
    run_id: runId(),
    producer: { name: 'intent-hook', host: 'test', version: 'abc1234' },
    started_at: '2026-09-24T16:00:00Z',
    finished_at: '2026-09-24T16:00:01Z',
    payload: {
      session_id: 'sess-1',
      trigger: 'notification',
      wait_state: 'blocked',
      notification_type: 'agent_needs_input',
      question: 'Merge !404 to master?',
      asked_at: '2026-09-24T16:00:00Z',
      repo: 'main-backend',
      ...payload,
    },
  };
}

const ready = (async () => {
  const db = await PGlite.create();
  await db.exec(STUB);
  await db.exec(M013);
  await db.exec(M014);
  await db.exec(M015);
  // The STUB's GRANT SELECT ran before these tables existed; restate it for
  // them, as Supabase's default privileges would.
  await db.exec('GRANT SELECT ON public.ops_runs, public.ops_intents TO anon, authenticated');
  await db.query(
    `INSERT INTO ops_private.ingest_tokens (token_hash, user_id, label, revoked_at) VALUES
       (sha256(convert_to($1, 'UTF8')), $4, 'dev box', NULL),
       (sha256(convert_to($2, 'UTF8')), $5, 'other', NULL),
       (sha256(convert_to($3, 'UTF8')), $4, 'old', now())`,
    [TOKEN, OTHER_TOKEN, REVOKED, SCOTT, OTHER]
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

async function ingest(token: string, env: unknown): Promise<R> {
  return as('anon', null, async (db) => {
    const res = await db.query<{ r: R }>('SELECT public.ops_ingest($1, $2::jsonb) AS r', [token, JSON.stringify(env)]);
    return res.rows[0].r;
  });
}

/** A stored intent_request run; returns its run_id. */
async function asked(payload: Record<string, unknown> = {}, token = TOKEN): Promise<string> {
  const env = intentRun(payload);
  const r = await ingest(token, env);
  assert.equal(r.ok, true, JSON.stringify(r));
  return env.run_id;
}

async function answer(sub: string | null, run: string, item: number | null, text: string | null): Promise<R> {
  return as('authenticated', sub, async (db) => {
    const res = await db.query<{ r: R }>('SELECT public.ops_intent_answer($1, $2, $3) AS r', [run, item, text]);
    return res.rows[0].r;
  });
}

async function pending(token: string): Promise<R> {
  return as('anon', null, async (db) => {
    const res = await db.query<{ r: R }>('SELECT public.ops_intents_pending($1) AS r', [token]);
    return res.rows[0].r;
  });
}

async function applied(token: string, id: string): Promise<R> {
  return as('anon', null, async (db) => {
    const res = await db.query<{ r: R }>('SELECT public.ops_intent_applied($1, $2) AS r', [token, id]);
    return res.rows[0].r;
  });
}

async function row(id: string) {
  const db = await ready;
  const res = await db.query<R>('SELECT * FROM public.ops_intents WHERE id = $1', [id]);
  return res.rows[0];
}

async function rejects(p: Promise<unknown>, re: RegExp) {
  await assert.rejects(p, (e: Error) => re.test(e.message));
}

describe('015: Scott answers (ops_intent_answer)', () => {
  test('an answer is stored pending, copying the reply-to and question from the run — never a cwd', async () => {
    const run = await asked({ session_id: 'sess-answer', wave_slug: 'mock-kpi' });
    const r = await answer(SCOTT, run, 1, 'Yes — merge it.');
    assert.equal(r.ok, true, JSON.stringify(r));
    const x = await row(r.id as string);
    assert.equal(x.status, 'pending');
    assert.equal(x.session_id, 'sess-answer');
    assert.equal(x.wave_slug, 'mock-kpi');
    assert.equal(x.stop_item, 1);
    assert.equal(x.question, 'Merge !404 to master?');
    assert.equal(x.answer, 'Yes — merge it.');
    assert.equal(x.applied_at, null);
    assert.equal('cwd' in x, false);
  });

  test('no stop-list item, or one outside 1–7, has no way in (§3)', async () => {
    const run = await asked();
    for (const item of [null, 0, 8, -1]) {
      const r = await answer(SCOTT, run, item, 'ok');
      assert.equal(r.error, 'not_stop_list', String(item));
    }
    const db = await ready;
    assert.equal((await db.query(`SELECT 1 FROM public.ops_intents WHERE run_id = $1`, [run])).rows.length, 0);
  });

  test('an empty, blank or over-1000-char answer is refused', async () => {
    const run = await asked();
    for (const a of [null, '', '   ', 'x'.repeat(1001)]) assert.equal((await answer(SCOTT, run, 2, a)).error, 'invalid');
    assert.equal((await answer(SCOTT, run, 2, 'x'.repeat(1000))).ok, true);
  });

  test('signed out, anon, or someone else’s run: nothing written', async () => {
    const run = await asked();
    assert.equal((await answer(null, run, 1, 'ok')).error, 'unauthorized');
    assert.equal((await answer(OTHER, run, 1, 'ok')).error, 'not_found');
    await rejects(
      as('anon', null, (db) => db.query('SELECT public.ops_intent_answer($1, 1, $2)', [run, 'ok'])),
      /permission denied/
    );
  });

  test('a permission prompt is not answerable here — the socket cannot click it', async () => {
    const run = await asked({
      trigger: 'permission_request',
      notification_type: undefined,
      question: undefined,
      tool_name: 'Bash',
      action: 'git push',
    });
    assert.equal((await answer(SCOTT, run, 1, 'yes')).error, 'not_answerable');
  });

  test('a run that is not an intent_request is not_found', async () => {
    const env = {
      ...intentRun(),
      kind: 'session_check',
      producer: { name: 'session-check', host: 't', version: 'x' },
      payload: { mode: 'live', exit_code: 0, verdict: 'ALL CLEAR', checks: [] },
    };
    assert.equal((await ingest(TOKEN, env)).ok, true);
    assert.equal((await answer(SCOTT, env.run_id, 1, 'ok')).error, 'not_found');
  });

  test('one answer per question', async () => {
    const run = await asked();
    assert.equal((await answer(SCOTT, run, 5, 'first')).ok, true);
    assert.equal((await answer(SCOTT, run, 5, 'second')).error, 'already_answered');
  });

  test('no API role can write the table directly', async () => {
    const run = await asked();
    await rejects(
      as('authenticated', SCOTT, (db) =>
        db.query(
          `INSERT INTO public.ops_intents (user_id, run_id, session_id, stop_item, asked_at, answer)
           VALUES ($1, $2, 's', 1, now(), 'x')`,
          [SCOTT, run]
        )
      ),
      /permission denied/
    );
    await rejects(as('authenticated', SCOTT, (db) => db.query(`UPDATE public.ops_intents SET status = 'applied'`)), /permission denied/);
    await rejects(as('authenticated', SCOTT, (db) => db.query(`DELETE FROM public.ops_intents`)), /permission denied/);
  });

  test('RLS: each user reads only their own answers', async () => {
    const run = await asked();
    const r = await answer(SCOTT, run, 3, 'mine');
    const mine = await as('authenticated', SCOTT, (db) => db.query('SELECT id FROM public.ops_intents WHERE id = $1', [r.id]));
    const theirs = await as('authenticated', OTHER, (db) => db.query('SELECT id FROM public.ops_intents WHERE id = $1', [r.id]));
    assert.equal(mine.rows.length, 1);
    assert.equal(theirs.rows.length, 0);
  });
});

describe('015: the daemon pulls and confirms', () => {
  test('pending lists only pending rows of the token’s owner, oldest answer first, no cwd', async () => {
    const a = await answer(SCOTT, await asked({ session_id: 'pull-a' }), 1, 'A');
    const b = await answer(SCOTT, await asked({ session_id: 'pull-b' }), 1, 'B');
    const otherRun = await asked({ session_id: 'pull-other' }, OTHER_TOKEN);
    assert.equal((await answer(OTHER, otherRun, 1, 'not scott')).ok, true);

    const r = await pending(TOKEN);
    assert.equal(r.ok, true);
    const list = r.intents as R[];
    const ids = list.map((i) => i.id);
    assert.ok(ids.indexOf(a.id) < ids.indexOf(b.id) && ids.indexOf(a.id) >= 0);
    assert.equal(list.some((i) => i.session_id === 'pull-other'), false);
    for (const i of list) {
      assert.equal('cwd' in i, false);
      assert.equal(typeof i.answer, 'string');
    }
  });

  test('a wrong, revoked, short or null token gets nothing', async () => {
    for (const t of ['x'.repeat(43), REVOKED, 'short', null])
      assert.deepEqual(await pending(t as string), { ok: false, error: 'unauthorized' }, String(t));
  });

  test('applied: pending → applied stamps applied_at, drops out of pending, and is idempotent', async () => {
    const a = await answer(SCOTT, await asked({ session_id: 'confirm-me' }), 4, 'go');
    const id = a.id as string;
    assert.deepEqual(await applied(TOKEN, id), { ok: true, id, duplicate: false });
    const x = await row(id);
    assert.equal(x.status, 'applied');
    assert.ok(x.applied_at instanceof Date);
    assert.deepEqual(await applied(TOKEN, id), { ok: true, id, duplicate: true });
    const ids = ((await pending(TOKEN)).intents as R[]).map((i) => i.id);
    assert.equal(ids.includes(id), false);
  });

  test('applied: wrong token, other owner’s token, unknown id — refused, nothing moves', async () => {
    const a = await answer(SCOTT, await asked(), 4, 'go');
    const id = a.id as string;
    assert.equal((await applied('x'.repeat(43), id)).error, 'unauthorized');
    assert.equal((await applied(OTHER_TOKEN, id)).error, 'not_found');
    assert.equal((await applied(TOKEN, '30000000-0000-4000-8000-000000000000')).error, 'not_found');
    assert.equal((await row(id)).status, 'pending');
  });
});

describe('015: append-only, below every role', () => {
  // Run as the table owner (PGlite's superuser) — the same privileges the
  // SECURITY DEFINER functions hold. The trigger must stop even this.
  test('the answer, question and reply-to never change once written', async () => {
    const a = await answer(SCOTT, await asked(), 6, 'original');
    const db = await ready;
    for (const set of [`answer = 'rewritten'`, `session_id = 'hijack'`, `stop_item = 2`, `question = 'q'`]) {
      await rejects(db.query(`UPDATE public.ops_intents SET ${set} WHERE id = $1`, [a.id]), /append-only/);
    }
    assert.equal((await row(a.id as string)).answer, 'original');
  });

  test('no delete, ever', async () => {
    const a = await answer(SCOTT, await asked(), 6, 'keep');
    const db = await ready;
    await rejects(db.query('DELETE FROM public.ops_intents WHERE id = $1', [a.id]), /append-only/);
    assert.ok(await row(a.id as string));
  });

  test('status moves forward only: applied → pending, parked → applied, pending → pending all refused', async () => {
    const db = await ready;
    const a = await answer(SCOTT, await asked(), 7, 'x');
    await applied(TOKEN, a.id as string);
    await rejects(db.query(`UPDATE public.ops_intents SET status = 'pending', applied_at = NULL WHERE id = $1`, [a.id]), /forward/);

    const b = await answer(SCOTT, await asked(), 7, 'y');
    await db.query(`UPDATE public.ops_intents SET status = 'parked' WHERE id = $1`, [b.id]);
    assert.equal((await applied(TOKEN, b.id as string)).error, 'invalid_transition');
    await rejects(db.query(`UPDATE public.ops_intents SET status = 'applied', applied_at = now() WHERE id = $1`, [b.id]), /forward/);

    const c = await answer(SCOTT, await asked(), 7, 'z');
    await rejects(db.query(`UPDATE public.ops_intents SET status = 'pending' WHERE id = $1`, [c.id]), /forward/);
  });

  test('013/014 are untouched: the ingest door still stores and refuses as before', async () => {
    assert.equal((await ingest(TOKEN, intentRun())).ok, true);
    const bad = intentRun({ cwd: '/home/x/worktree' });
    assert.deepEqual(await ingest(TOKEN, bad), { ok: false, error: 'forbidden_key', detail: 'cwd' });
  });
});
