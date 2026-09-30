import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { boardState, stagesBand, type BoardInput } from './board.ts';
import type { GitlabMr, GitlabPayload } from './contract.ts';
import { validateEnvelope } from './contract.ts';
import { CONTROL_CHECKS, LIVE_CHECKS, NOW, GITLAB, envelopeOf, gitlabRun, minutesAgo, sessionRun, wave, wavesRun } from './__fixtures__/runs.ts';

const SHA = (c: string) => c.repeat(40);

function mr(ref: string, over: Partial<GitlabMr> = {}): GitlabMr {
  return { ref, title: ref, draft: false, source_branch: `b/${ref}`, sha: SHA('a'), updated_at: minutesAgo(30), ...over };
}

function gitlabWith(open: GitlabMr[]): GitlabPayload {
  return { repos: [{ repo: 'main-backend', project_path: 'x/main-backend', default_branch: 'master', head_sha: SHA('c'), head_committed_at: minutesAgo(60), open_mrs: open }] };
}

/** slug → stage (or the side list it landed in). */
function where(band: ReturnType<typeof stagesBand>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, cards] of Object.entries(band.columns)) for (const c of cards) out[c.slug] = k;
  for (const k of ['blocked', 'parked', 'planned', 'shipped'] as const) for (const c of band[k]) out[c.slug] = k;
  return out;
}

describe('pipeline stages — every wave in the one stage it is in now', () => {
  const waves = [
    wave({ slug: 'no-mr' }),
    wave({ slug: 'mr-open', mrs: ['main-backend!1'] }),
    wave({ slug: 'mr-queued', mrs: ['main-backend!2'] }),
    wave({ slug: 'half-queued', mrs: ['main-backend!2', 'main-backend!1'] }),
    wave({ slug: 'all-merged', mrs: ['main-backend!9'], shippable: true, shippable_checked_at: minutesAgo(5) }),
    wave({ slug: 'mr-gone', mrs: ['main-backend!8'] }),
    wave({ slug: 'blocked', status: 'blocked', mrs: ['main-backend!2'] }),
    wave({ slug: 'parked', status: 'parked' }),
    wave({ slug: 'planned', status: 'planned' }),
    wave({ slug: 'shipped-recent', status: 'shipped', shipped_on: '2026-09-20' }),
    wave({ slug: 'shipped-old', status: 'shipped', shipped_on: '2026-09-01' }),
  ];
  const gl = gitlabWith([mr('main-backend!1', { release_queue: false }), mr('main-backend!2', { release_queue: true })]);

  test('the matrix: status, then shippable, then open MRs and the train label', () => {
    assert.deepEqual(where(stagesBand(waves, gl, NOW)), {
      'no-mr': 'building',
      'mr-open': 'review',
      'mr-queued': 'train',
      // One MR queued and one not: the wave is not on the train until all of it is.
      'half-queued': 'review',
      'all-merged': 'live',
      'mr-gone': 'live',
      // Status outranks MR state — a blocked wave with a queued MR is still blocked.
      blocked: 'blocked',
      parked: 'parked',
      planned: 'planned',
      'shipped-recent': 'shipped',
      // shipped-old (29 days) has left the pipeline.
    });
  });

  test('a merged-or-closed MR is a guess and says so; shippable=true is not', () => {
    const b = stagesBand(waves, gl, NOW);
    const gone = b.columns.live.find((c) => c.slug === 'mr-gone')!;
    assert.match(gone.stageNote!, /merged or closed/);
    assert.equal(b.columns.live.find((c) => c.slug === 'all-merged')!.stageNote, null);
    const closed = stagesBand([wave({ slug: 'x', mrs: ['main-backend!8'], shippable: false, shippable_checked_at: minutesAgo(5) })], gl, NOW);
    assert.match(closed.columns.live[0].stageNote!, /closed\?/);
  });

  test('GitLab not read: MR waves are never placed as certain', () => {
    const b = stagesBand(waves, null, NOW);
    assert.equal(b.gitlabKnown, false);
    const w = where(b);
    assert.equal(w['mr-queued'], 'review');
    assert.equal(w['mr-open'], 'review');
    for (const c of b.columns.review) assert.match(c.stageNote!, /GitLab not read/);
    assert.ok(b.columns.review.every((c) => c.mrs.every((m) => m.state === 'unknown')));
    // What needs no GitLab still lands exactly.
    assert.equal(w['no-mr'], 'building');
    assert.equal(w['all-merged'], 'live');
  });

  test('labels not read (older producer): an open MR is "MR open" with a note, never "on the train"', () => {
    const b = stagesBand([wave({ slug: 'x', mrs: ['main-backend!1'] })], gitlabWith([mr('main-backend!1')]), NOW);
    assert.equal(b.columns.review.length, 1);
    assert.match(b.columns.review[0].stageNote!, /labels not read/);
    assert.equal(b.columns.review[0].mrs[0].state, 'unknown');
  });

  test('"you" = a waiting-on-Scott line or an awaiting-confirm gate; active = a live lease only', () => {
    const b = stagesBand(
      [
        wave({ slug: 'asks', waiting_on_scott: 'go on the switch-on?' }),
        wave({ slug: 'gated', gate: 'awaiting-confirm' }),
        wave({ slug: 'live-lease', claimed: true, claimed_age_seconds: 60, lease_expires_at: '2026-09-23T19:00:00Z' }),
        wave({ slug: 'stale-lease', claimed: true, claimed_age_seconds: 60, lease_expires_at: '2026-09-23T17:00:00Z' }),
        wave({ slug: 'no-expiry', claimed: true }),
      ],
      gl,
      NOW,
    );
    const by = Object.fromEntries(b.columns.building.map((c) => [c.slug, c]));
    assert.equal(by.asks.waitingOnYou, 'go on the switch-on?');
    assert.equal(by.gated.waitingOnYou, 'awaiting your confirm');
    assert.equal(by['live-lease'].waitingOnYou, null);
    assert.equal(by['live-lease'].active, true);
    assert.equal(by['stale-lease'].active, false);
    // No expiry sent: unknown, and unknown is never "a session is on it".
    assert.equal(by['no-expiry'].active, false);
  });

  test('a red pipeline and a draft ride along on the MR chip', () => {
    const b = stagesBand([wave({ slug: 'x', mrs: ['main-backend!1'] })], gitlabWith([mr('main-backend!1', { release_queue: false, draft: true, pipeline_status: 'failed' })]), NOW);
    assert.deepEqual(b.columns.review[0].mrs[0], { ref: 'main-backend!1', state: 'open', draft: true, pipeline: 'failed' });
  });
});

describe('the board wires stages to freshness', () => {
  const base = (over: Partial<BoardInput> = {}): BoardInput => ({
    reach: { ok: true },
    live: sessionRun(LIVE_CHECKS, 10),
    control: sessionRun(CONTROL_CHECKS, 30, 'control'),
    waves: wavesRun(),
    gitlab: gitlabRun(),
    apiSamples: [],
    intents: [],
    answers: [],
    parks: [],
    resolutions: [],
    ...over,
  });

  test('no waves snapshot: not tracked, never an empty pipeline', () => {
    const s = boardState(base({ waves: null }), NOW).stages;
    assert.equal(s.tracked, false);
  });

  test('a stale GitLab run is treated as not read', () => {
    const s = boardState(base({ gitlab: gitlabRun(31) }), NOW).stages;
    assert.ok(s.tracked);
    assert.equal(s.value.gitlabKnown, false);
    const fresh = boardState(base(), NOW).stages;
    assert.ok(fresh.tracked && fresh.value.gitlabKnown);
  });
});

describe('contract: open_mrs[].release_queue', () => {
  const env = (m: Record<string, unknown>) =>
    envelopeOf('gitlab', { repos: [{ ...GITLAB.repos[2], open_mrs: [{ ...mr('mini-apps!1'), ...m }] }] });

  test('true, false and absent are accepted', () => {
    for (const m of [{ release_queue: true }, { release_queue: false }, {}]) assert.equal(validateEnvelope(env(m), NOW).ok, true, JSON.stringify(m));
  });

  test('anything but a boolean is refused by name', () => {
    for (const bad of ['yes', 1, null]) {
      const v = validateEnvelope(env({ release_queue: bad }), NOW);
      assert.equal(v.ok, false);
      assert.ok(!v.ok && v.errors.some((e) => e.includes('release_queue')), JSON.stringify(v));
    }
  });
});
