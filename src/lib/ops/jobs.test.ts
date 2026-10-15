import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { jobsScreen, nextTrain, type JobsInput } from './jobs.ts';
import type { GitlabMr, IntentRequestPayload, JobStatusPayload, StoredResolution } from './contract.ts';
import type { StoredRun } from './board.ts';
import { GITLAB, LIVE_CHECKS, NOW, intentRun, minutesAgo, sessionRun } from './__fixtures__/runs.ts';

function job(over: Partial<JobStatusPayload> & { job: string }, updatedMinAgo = 2): StoredRun<JobStatusPayload> {
  const payload: JobStatusPayload = {
    map: over.job,
    lead: over.job,
    status: 'building',
    workers: [],
    tickets: { done: 1, left: 2 },
    relays: 0,
    updated_at: minutesAgo(updatedMinAgo),
    ...over,
  };
  return { run_id: `run-job-${over.job}-${updatedMinAgo}`, finished_at: payload.updated_at, received_at: payload.updated_at, payload };
}

function input(over: Partial<JobsInput> = {}): JobsInput {
  return {
    reach: { ok: true },
    live: sessionRun(LIVE_CHECKS, 4),
    gitlab: null,
    jobs: [],
    intents: [],
    resolutions: [],
    ...over,
  };
}

const intent = (session_id: string, askedMinAgo: number, over: Partial<IntentRequestPayload> = {}) =>
  intentRun({ session_id, trigger: 'stop', wait_state: 'idle', question: 'turn ended', ...over }, askedMinAgo);

describe('Job cards', () => {
  test('one card per Job, from its latest run; every field the card shows comes from the payload', () => {
    const s = jobsScreen(
      input({
        jobs: [
          job({ job: 'salary', summary: 'old words', summary_by: 'auto', summary_at: minutesAgo(40) }, 40),
          job(
            {
              job: 'salary',
              lead: 'salary',
              status: 'waiting_on_you',
              summary: 'Pay is built and dormant.',
              summary_by: 'lead',
              summary_at: minutesAgo(3),
              workers: [{ name: 'salary·t3', ticket: 'salary-3-bonus', model: 'opus', line: 'writing tests' }],
              tickets: { done: 3, left: 4 },
              acceptance: { ticked: 9, total: 20 },
              relays: 5,
              waiting_on_you: 'Pay on the 5th or the 10th?',
            },
            3
          ),
        ],
      }),
      NOW
    );
    assert.equal(s.jobs.length, 1);
    const c = s.jobs[0];
    assert.equal(c.job, 'salary');
    assert.equal(c.state, 'waiting_on_you');
    assert.equal(c.words, 'waiting on you');
    assert.equal(c.summary, 'Pay is built and dormant.');
    assert.equal(c.waiting, 'Pay on the 5th or the 10th?');
    assert.deepEqual(c.tickets, { done: 3, left: 4 });
    assert.deepEqual(c.acceptance, { ticked: 9, total: 20 });
    assert.equal(c.relays, 5);
    assert.equal(c.ageMin, 3);
    assert.deepEqual(c.workers, [{ name: 'salary·t3', ticket: 'salary-3-bonus', model: 'opus', line: 'writing tests' }]);
  });

  test('a building Job with no update for over 30 minutes is stale, never building', () => {
    const s = jobsScreen(input({ jobs: [job({ job: 'at30' }, 30), job({ job: 'at31' }, 31)] }), NOW);
    const by = Object.fromEntries(s.jobs.map((c) => [c.job, c]));
    assert.equal(by.at30.state, 'building');
    assert.equal(by.at31.state, 'stale');
    assert.equal(by.at31.words, 'stale 31m — no update');
    assert.equal(by.at31.tone, 'red');
  });

  test('a waiting, queued or idle Job keeps its status however old — it is not claiming to work', () => {
    const s = jobsScreen(
      input({
        jobs: [
          job({ job: 'w', status: 'waiting_on_you', waiting_on_you: 'q?' }, 300),
          job({ job: 'q', status: 'queued' }, 300),
          job({ job: 'i', status: 'idle' }, 300),
        ],
      }),
      NOW
    );
    assert.deepEqual(
      s.jobs.map((c) => c.state).sort(),
      ['idle', 'queued', 'waiting_on_you']
    );
  });

  test('a shipped Job leaves after 24 h; inside 24 h it stays', () => {
    const s = jobsScreen(
      input({ jobs: [job({ job: 'fresh', status: 'shipped' }, 24 * 60), job({ job: 'old', status: 'shipped' }, 24 * 60 + 1)] }),
      NOW
    );
    assert.deepEqual(
      s.jobs.map((c) => c.job),
      ['fresh']
    );
  });

  test('order: waiting on you, building, stale, queued, idle, shipped; newest first inside a status', () => {
    const s = jobsScreen(
      input({
        jobs: [
          job({ job: 'ship', status: 'shipped' }, 5),
          job({ job: 'idle', status: 'idle' }, 5),
          job({ job: 'queue', status: 'queued' }, 5),
          job({ job: 'stale' }, 45),
          job({ job: 'build-old' }, 20),
          job({ job: 'build-new' }, 1),
          job({ job: 'wait', status: 'waiting_on_you', waiting_on_you: 'q?' }, 50),
        ],
      }),
      NOW
    );
    assert.deepEqual(
      s.jobs.map((c) => c.job),
      ['wait', 'build-new', 'build-old', 'stale', 'queue', 'idle', 'ship']
    );
  });

  test('no summary yet is null — the card says so, it does not invent one', () => {
    const s = jobsScreen(input({ jobs: [job({ job: 'bare' })] }), NOW);
    assert.equal(s.jobs[0].summary, null);
    assert.equal(s.jobs[0].waiting, null);
  });

  test('a run updated in the future (clock skew) is not negative-aged', () => {
    const s = jobsScreen(input({ jobs: [job({ job: 'skew' }, -5)] }), NOW);
    assert.equal(s.jobs[0].ageMin, 0);
    assert.equal(s.jobs[0].state, 'building');
  });
});

describe('Solo lines', () => {
  test('one line per session not in a Job, its latest open row; resolved and Job sessions are left out', () => {
    const resolutions: StoredResolution[] = [{ run_id: intent('gone', 10).run_id, reason: 'session_exited', resolved_at: minutesAgo(5) }];
    const s = jobsScreen(
      input({
        jobs: [job({ job: 'lw', lead: 'lw', workers: [{ name: 'lw·t5', ticket: 'lw-5' }] })],
        intents: [
          intent('solo-a', 30, { session_name: 'fix-glab', repo: 'main-backend', question: 'older line' }),
          intent('solo-a', 6, { session_name: 'fix-glab', repo: 'main-backend', question: 'Done — MR !12 queued.' }),
          intent('gone', 10, { session_name: 'gone-one' }),
          intent('worker', 2, { session_name: 'lw·t5', job: 'lw' }),
          // Its Job has pushed no card yet (or the card left): the job field alone keeps it off Solo.
          intent('cardless', 2, { session_name: 'salary·t1', job: 'salary' }),
          // An older producer: no job field — matched by name against the Job's sessions.
          intent('lead', 2, { session_name: 'lw' }),
        ],
        resolutions,
      }),
      NOW
    );
    assert.deepEqual(s.solo, [{ key: 'solo-a', name: 'fix-glab', repo: 'main-backend', line: 'Done — MR !12 queued.', blocked: false, ageMin: 6 }]);
  });

  test('a session with no name shows its repo; a row with no line says what it is waiting on', () => {
    const s = jobsScreen(
      input({
        intents: [
          intent('anon', 3, { repo: 'cortex', question: undefined }),
          intent('perm', 1, { trigger: 'permission_request', wait_state: 'blocked', question: undefined, tool_name: 'Bash', action: 'git push' }),
        ],
      }),
      NOW
    );
    assert.deepEqual(s.solo, [
      { key: 'perm', name: null, repo: null, line: 'permission: Bash — git push', blocked: true, ageMin: 1 },
      { key: 'anon', name: null, repo: 'cortex', line: 'turn ended — waiting for you', blocked: false, ageMin: 3 },
    ]);
  });

  test('a Job whose shipped card has left the screen still keeps its sessions off Solo', () => {
    const s = jobsScreen(
      input({
        jobs: [job({ job: 'old', lead: 'old', status: 'shipped', workers: [{ name: 'old·t1', ticket: 't' }] }, 24 * 60 + 5)],
        intents: [intent('lead-left-open', 3, { session_name: 'old' }), intent('worker-left-open', 3, { session_name: 'old·t1' })],
      }),
      NOW
    );
    assert.deepEqual(s.jobs, []);
    assert.deepEqual(s.solo, []);
  });

  test('a Solo session blocked on Scott is marked and counted as waiting; an idle one is not', () => {
    const s = jobsScreen(
      input({
        intents: [
          intent('perm', 1, { trigger: 'permission_request', wait_state: 'blocked', question: undefined, tool_name: 'Bash', action: 'git push' }),
          intent('idle', 2),
        ],
      }),
      NOW
    );
    assert.deepEqual(
      s.solo.map((l) => [l.key, l.blocked]),
      [
        ['perm', true],
        ['idle', false],
      ]
    );
    assert.equal(s.top.waiting, 1);
  });

  test('rows older than 24 h are not a live session', () => {
    const s = jobsScreen(input({ intents: [intent('old', 24 * 60 + 1)] }), NOW);
    assert.deepEqual(s.solo, []);
  });
});

describe('top line', () => {
  test('prod OK when session-check is clean and fresh', () => {
    const s = jobsScreen(input(), NOW);
    assert.equal(s.top.tone, 'green');
    assert.equal(s.top.prod, 'prod OK');
    assert.equal(s.top.measured, 'measured 4m ago');
  });

  test('prod not OK says what — the rollup headline, never "OK"', () => {
    const red = LIVE_CHECKS.map((c) => (c.id === 'drift.admin-ui' ? { ...c, state: 'red' as const } : c));
    const s = jobsScreen(input({ live: sessionRun(red, 4) }), NOW);
    assert.equal(s.top.tone, 'red');
    assert.match(s.top.prod, /^RED — .*admin-ui/);
  });

  test('a stale or missing session-check is not OK', () => {
    assert.equal(jobsScreen(input({ live: sessionRun(LIVE_CHECKS, 90) }), NOW).top.tone, 'amber');
    assert.equal(jobsScreen(input({ live: null }), NOW).top.tone, 'red');
  });

  test('an unreachable database makes the whole screen say so', () => {
    const s = jobsScreen(input({ reach: { ok: false, at: minutesAgo(0), reason: 'database unreachable' } }), NOW);
    assert.equal(s.top.tone, 'red');
    assert.match(s.top.prod, /DATABASE UNREACHABLE/);
  });

  test('waiting count = Jobs waiting on you (+ blocked Solo sessions, below)', () => {
    const s = jobsScreen(input({ jobs: [job({ job: 'a', status: 'waiting_on_you', waiting_on_you: 'q' }), job({ job: 'b' })] }), NOW);
    assert.equal(s.top.waiting, 1);
  });

  test('queued count is the release-queue MRs; GitLab not read says so', () => {
    const mr = (ref: string, release_queue?: boolean): GitlabMr => ({
      ref,
      title: ref,
      draft: false,
      source_branch: ref,
      sha: 'a'.repeat(40),
      updated_at: minutesAgo(5),
      ...(release_queue === undefined ? {} : { release_queue }),
    });
    const gl = { ...GITLAB, repos: [{ ...GITLAB.repos[0], open_mrs: [mr('x!1', true), mr('x!2', false), mr('x!3', true), mr('x!4')] }] };
    const run = { run_id: 'g', finished_at: minutesAgo(5), received_at: minutesAgo(5), payload: gl };
    assert.match(jobsScreen(input({ gitlab: run }), NOW).top.train, /· 2 queued$/);
    assert.match(jobsScreen(input({ gitlab: null }), NOW).top.train, /· queue not read$/);
  });
});

describe('next train (13:00 and 19:00 Tashkent = 08:00Z, 14:00Z)', () => {
  const at = (iso: string) => new Date(iso);
  test('before 08:00Z → 13:00 today; at 08:00Z it has left → 19:00', () => {
    assert.equal(nextTrain(at('2026-10-16T07:59:00Z')), '13:00');
    assert.equal(nextTrain(at('2026-10-16T08:00:00Z')), '19:00');
  });
  test('after 14:00Z → 13:00 tomorrow', () => {
    assert.equal(nextTrain(at('2026-10-16T14:00:00Z')), 'tomorrow 13:00');
    assert.equal(nextTrain(at('2026-10-16T18:59:00Z')), 'tomorrow 13:00');
  });
  test('after Tashkent midnight (still the 16th in UTC) the 13:00 train is today', () => {
    // 19:30Z = 00:30 Tashkent on the 17th: the next train is 13:00 the same Tashkent day.
    assert.equal(nextTrain(at('2026-10-16T19:30:00Z')), '13:00');
  });
});
