/**
 * Command Centre fixtures, shaped exactly as contract v1 says the producers
 * send them. Lines are copied from real session-check output (2026-09-23),
 * SHAs are fake. `NOW` is fixed: the tests never read the wall clock.
 */
import type { Check, Envelope, GitlabPayload, IntentRequestPayload, SessionCheckPayload, Wave, WavesPayload } from '../contract.ts';
import type { StoredRun } from '../board.ts';

export const NOW = new Date('2026-09-23T18:00:00Z');
export const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString().replace(/\.\d{3}Z$/, 'Z');

const SHA = (c: string) => c.repeat(40).slice(0, 40);

export const LIVE_CHECKS: Check[] = [
  {
    id: 'drift.main-backend',
    section: 'deploy drift',
    state: 'ok',
    method: 'exact',
    method_label: 'exact',
    line: 'main-backend  OK     exact — 412 files match manifest 6920a3ca',
    measured_at: minutesAgo(10),
    values: { head_sha: SHA('a'), live_sha: SHA('a') },
  },
  {
    id: 'drift.admin-ui',
    section: 'deploy drift',
    state: 'ok',
    method: 'timing_proxy',
    method_label: 'timing',
    line: 'admin-ui      OK     timing — live deployed 2026-09-23T12:00:00Z, after head bbbbbbbb (2026-09-23T11:50:00Z)',
    measured_at: minutesAgo(10),
    values: { head_sha: SHA('b'), head_merged_at: '2026-09-23T11:50:00Z', live_deployed_at: '2026-09-23T12:00:00Z' },
    untracked: { live_sha: 'timing proxy — Amplify exposes no build SHA' },
  },
  {
    id: 'abandoned-token',
    section: 'abandoned attempts',
    state: 'ok',
    method: 'query',
    line: 'abandoned attempts holding a sessionToken: 0',
    measured_at: minutesAgo(10),
    values: { count: 0 },
  },
];

/** The same checks as --simulate-stale leaves them: every one pushed red. */
export const CONTROL_CHECKS: Check[] = LIVE_CHECKS.map((c) => ({
  ...c,
  state: c.method === 'timing_proxy' ? 'drift' : 'red',
  line: `${c.line} [control]`,
}));

export function sessionRun(
  checks: Check[],
  finishedMinAgo: number,
  mode: 'live' | 'control' = 'live',
  control?: SessionCheckPayload['control']
): StoredRun<SessionCheckPayload> {
  const payload: SessionCheckPayload = {
    mode,
    exit_code: mode === 'control' ? 1 : 0,
    verdict: mode === 'control' ? 'DRIFT / RED — act before new work' : 'ALL CLEAR',
    checks,
    ...(mode === 'control'
      ? { control: control ?? { expected: 'all_red', observed_all_red: true, not_red: [] } }
      : {}),
  };
  return { run_id: `run-${mode}-${finishedMinAgo}`, finished_at: minutesAgo(finishedMinAgo), received_at: minutesAgo(finishedMinAgo), payload };
}

export function wave(over: Partial<Wave> & { slug: string }): Wave {
  return {
    title: over.slug,
    family: 'erp',
    repos: ['main-backend'],
    branch: `feat/${over.slug}`,
    status: 'in-flight',
    gate: 'none',
    blocked_by: [],
    started: '2026-09-10',
    mrs: [],
    shas: [],
    issues: [],
    note_mtime: minutesAgo(120),
    in_registry: true,
    ...over,
  };
}

export const WAVES: Wave[] = [
  wave({ slug: 'referrals-page', gate: 'awaiting-confirm', started: '2026-09-15', mrs: ['main-backend!402', 'admin-ui!145'], waiting_on_scott: 'merge admin-ui!145 after !402 is deployed' }),
  wave({ slug: 'old-shipped-gated', status: 'shipped', gate: 'do-not-run', started: '2026-08-20', in_registry: false, shas: ['main-backend@6920a3ca'] }),
  wave({ slug: 'blocked-one', status: 'blocked', started: '2026-09-01' }),
  wave({ slug: 'quiet', started: '2026-09-02', mrs: ['mini-apps!61'] }),
  wave({ slug: 'shipped-clean', status: 'shipped', started: '2026-07-01', in_registry: false }),
];

export const wavesRun = (waves: Wave[] = WAVES, finishedMinAgo = 5): StoredRun<WavesPayload> => ({
  run_id: 'run-waves',
  finished_at: minutesAgo(finishedMinAgo),
  received_at: minutesAgo(finishedMinAgo),
  payload: { waves },
});

export const GITLAB: GitlabPayload = {
  repos: [
    {
      repo: 'main-backend',
      project_path: 'imperial-academy/main-backend',
      default_branch: 'master',
      head_sha: SHA('c'),
      head_committed_at: minutesAgo(300),
      prod_sha: SHA('a'),
      commits_prod_to_head: [
        { sha: SHA('c'), title: 'feat: referrals', authored_at: minutesAgo(300), mr: 'main-backend!402' },
        // Joined by sha prefix, no MR.
        { sha: '6920a3ca' + SHA('d').slice(8), title: 'fix: hotfix', authored_at: minutesAgo(400) },
        { sha: SHA('e'), title: 'chore: stray', authored_at: minutesAgo(500) },
      ],
      open_mrs: [
        { ref: 'main-backend!402', title: 'referrals', draft: true, source_branch: 'feat/referrals-page', sha: SHA('c'), pipeline_status: 'success', behind_default_by: 0, updated_at: minutesAgo(60) },
        { ref: 'main-backend!390', title: 'old green', draft: true, source_branch: 'feat/x', sha: SHA('f'), pipeline_status: 'success', behind_default_by: 7, updated_at: minutesAgo(3 * 1440) },
        { ref: 'main-backend!399', title: 'red one', draft: true, source_branch: 'feat/y', sha: SHA('1'), pipeline_status: 'failed', updated_at: minutesAgo(90) },
      ],
    },
    {
      // Same sha prefix as a main-backend wave sha, different repo — must NOT join.
      repo: 'admin-ui',
      project_path: 'imperial-academy/admin-ui',
      default_branch: 'master',
      head_sha: SHA('2'),
      head_committed_at: minutesAgo(100),
      prod_sha: SHA('3'),
      commits_prod_to_head: [
        { sha: '6920a3ca' + SHA('4').slice(8), title: 'feat: same prefix, other repo', authored_at: minutesAgo(100) },
      ],
      open_mrs: [],
    },
    {
      // No prod SHA known: its commit list is untracked, not empty.
      repo: 'mini-apps',
      project_path: 'imperial-academy/mini-apps',
      default_branch: 'main',
      head_sha: SHA('5'),
      head_committed_at: minutesAgo(100),
      open_mrs: [],
    },
  ],
};

export const gitlabRun = (finishedMinAgo = 5): StoredRun<GitlabPayload> => ({
  run_id: 'run-gitlab',
  finished_at: minutesAgo(finishedMinAgo),
  received_at: minutesAgo(finishedMinAgo),
  payload: GITLAB,
});

export function intentRun(over: Partial<IntentRequestPayload> & { session_id: string }, askedMinAgo: number): StoredRun<IntentRequestPayload> {
  const payload: IntentRequestPayload = {
    trigger: 'notification',
    asked_at: minutesAgo(askedMinAgo),
    ...over,
  };
  return {
    run_id: `run-intent-${over.session_id}-${askedMinAgo}`,
    finished_at: minutesAgo(askedMinAgo),
    received_at: minutesAgo(askedMinAgo),
    payload,
  };
}

/** A whole valid envelope of each kind, as a producer would POST it. */
export function envelopeOf<K extends Envelope['kind']>(kind: K, payload: unknown): Record<string, unknown> {
  return {
    v: 1,
    kind,
    run_id: '3f1c2b7a-0000-4000-8000-000000000001',
    producer: {
      name: kind === 'waves' ? 'wave' : kind === 'gitlab' ? 'gitlab-poll' : kind === 'intent_request' ? 'intent-hook' : 'session-check',
      host: 'hp2-wsl',
      version: 'c1e4581',
    },
    started_at: minutesAgo(1),
    finished_at: minutesAgo(0),
    payload,
  };
}
