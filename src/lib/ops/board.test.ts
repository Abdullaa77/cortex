import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { boardState, CLAIMED_STALE_SECONDS, freshness, intentsBand, readyBand, rollup, waitingBand, type BoardInput } from './board.ts';
import { CONTROL_CHECKS, LIVE_CHECKS, NOW, GITLAB, WAVES, gitlabRun, intentRun, minutesAgo, sessionRun, wave, wavesRun } from './__fixtures__/runs.ts';

const base = (over: Partial<BoardInput> = {}): BoardInput => ({
  reach: { ok: true },
  live: sessionRun(LIVE_CHECKS, 10),
  control: sessionRun(CONTROL_CHECKS, 30, 'control'),
  waves: wavesRun(),
  gitlab: gitlabRun(),
  apiSamples: [],
  intents: [],
  ...over,
});

describe('the rollup can go red — Scott, 2026-09-23', () => {
  test('the control payload fed to the rollup reads red, verdict AND home line', () => {
    // The strip proves the check component paints red. This proves the part
    // with its own logic — the verdict and the one-line summary — does too.
    const control = sessionRun(CONTROL_CHECKS, 5, 'control');
    const r = rollup({ checks: control.payload.checks, fresh: freshness(control.finished_at, 45, NOW), waitingCount: 3, reach: { ok: true } });
    assert.equal(r.tone, 'red');
    assert.match(r.headline, /^RED — main-backend, admin-ui, abandoned-token$/);
    assert.match(r.summary, /^3 waiting on you · prod RED: main-backend, admin-ui, abandoned-token · measured 5m ago$/);
  });

  test('the live payload reads green, with the line the home page shows', () => {
    const r = rollup({ checks: LIVE_CHECKS, fresh: freshness(minutesAgo(12), 45, NOW), waitingCount: 3, reach: { ok: true } });
    assert.equal(r.tone, 'green');
    assert.equal(r.summary, '3 waiting on you · prod clean · measured 12m ago');
  });

  test('"unknown" (could not tell) is red, never clean', () => {
    const checks = LIVE_CHECKS.map((c, i) => (i === 0 ? { ...c, state: 'unknown' as const } : c));
    assert.equal(rollup({ checks, fresh: freshness(minutesAgo(1), 45, NOW), waitingCount: 0, reach: { ok: true } }).tone, 'red');
  });
});

describe('a control run never becomes live state', () => {
  test('with only a control run, the board is not green and shows no repo values', () => {
    const b = boardState(base({ live: null }), NOW);
    assert.equal(b.tone, 'red');
    assert.equal(b.headline, 'NO SESSION-CHECK HAS EVER REPORTED');
    assert.equal(b.repos.tracked, false);
    // …but the strip renders the control's checks, red.
    assert.ok(b.controlStrip!.every((c) => c.tone === 'red'));
  });

  test('a newer control run does not replace the live repo state', () => {
    const b = boardState(base({ control: sessionRun(CONTROL_CHECKS, 1, 'control') }), NOW);
    assert.equal(b.tone, 'green');
    assert.ok(b.repos.tracked && b.repos.value.every((c) => c.tone === 'green'));
    assert.equal(b.heartbeat.control.state, 'proven');
  });

  test('a control that failed to go red turns the board red, naming the check', () => {
    const failed = sessionRun(CONTROL_CHECKS, 2, 'control', { expected: 'all_red', observed_all_red: false, not_red: ['drift.admin-ui'] });
    const b = boardState(base({ control: failed }), NOW);
    assert.equal(b.tone, 'red');
    assert.match(b.headline, /NEGATIVE CONTROL FAILED — drift.admin-ui/);
  });
});

describe('freshness: STALE is shown, the last value is not', () => {
  test('45 minutes is fresh; 46 is stale', () => {
    assert.equal(freshness(minutesAgo(45), 45, NOW).state, 'fresh');
    assert.equal(freshness(minutesAgo(46), 45, NOW).state, 'stale');
  });

  test('a stale session-check withholds repo and API values and reads amber', () => {
    const b = boardState(base({ live: sessionRun(LIVE_CHECKS, 46) }), NOW);
    assert.equal(b.tone, 'amber');
    assert.equal(b.repos.tracked, false);
    assert.match(!b.repos.tracked ? b.repos.reason : '', /^STALE/);
    assert.equal(b.api.tracked, false);
    assert.match(b.summary, /prod STALE · measured 46m ago/);
  });

  test('gitlab goes stale at 31 minutes, on its own budget', () => {
    assert.equal(boardState(base({ gitlab: gitlabRun(30) }), NOW).ready.tracked, true);
    const b = boardState(base({ gitlab: gitlabRun(31) }), NOW);
    assert.equal(b.ready.tracked, false);
  });
});

describe('absent is never zero, and never calm', () => {
  test('the database not answering is red, and says so', () => {
    const b = boardState(base({ reach: { ok: false, at: NOW.toISOString(), reason: 'fetch failed' } }), NOW);
    assert.equal(b.tone, 'red');
    assert.match(b.headline, /DATABASE UNREACHABLE/);
  });

  test('no gitlab producer: ready band is not tracked, with the reason', () => {
    const b = boardState(base({ gitlab: null }), NOW);
    assert.deepEqual(b.ready, { tracked: false, reason: 'no GitLab producer yet — Session B builds it next' });
  });

  test('no api checks: the API tile is not tracked, not a zero error rate', () => {
    const b = boardState(base(), NOW);
    assert.deepEqual(b.api, { tracked: false, reason: 'session-check does not probe the API yet' });
  });

  test('an API probe that failed turns the board red', () => {
    const health = { id: 'api.health', section: 'api', state: 'red' as const, method: 'probe' as const, line: 'api.health 502 in 30012ms', measured_at: minutesAgo(10), values: { http_status: 502, latency_ms: 30012 } };
    const b = boardState(base({ live: sessionRun([...LIVE_CHECKS, health], 10), apiSamples: [{ at: minutesAgo(10), state: 'red' }, { at: minutesAgo(100), state: 'ok' }] }), NOW);
    assert.equal(b.tone, 'red');
    assert.ok(b.api.tracked);
    assert.deepEqual(b.api.tracked && b.api.value.samples, { ok: 1, total: 2 });
    // …and the API checks are not duplicated into the repo band.
    assert.ok(b.repos.tracked && !b.repos.value.some((c) => c.id.startsWith('api.')));
  });

  test('no waves snapshot: waiting is not tracked, and the summary says so instead of "0 waiting"', () => {
    const b = boardState(base({ waves: null }), NOW);
    assert.equal(b.waiting.tracked, false);
    assert.match(b.summary, /^waiting: not tracked/);
  });

  test('timing proxies say "inferred, not measured" — by method, not by name', () => {
    const b = boardState(base(), NOW);
    const notes = b.repos.tracked ? Object.fromEntries(b.repos.value.map((c) => [c.id, c.methodNote])) : {};
    assert.deepEqual(notes, { 'drift.main-backend': 'exact', 'drift.admin-ui': 'inferred, not measured', 'abandoned-token': null });
  });
});

describe('waiting on you', () => {
  test('gated, blocked or waiting — including shipped-but-gated — oldest first; shipped clean is out', () => {
    const w = waitingBand(WAVES, NOW);
    assert.deepEqual(w.map((x) => x.slug), ['old-shipped-gated', 'blocked-one', 'referrals-page']);
    assert.equal(w[0].inRegistry, false);
  });
});

describe('ready to merge — persistent, oldest first, joined Cortex-side', () => {
  const r = readyBand(GITLAB, WAVES, NOW);

  test('only green drafts; a three-day-old one leads and is flagged for a refresh', () => {
    assert.deepEqual(r.mrs.map((m) => [m.ref, m.ageDays, m.needsRefresh, m.wave]), [
      ['main-backend!390', 3, true, null],
      ['main-backend!402', 0, false, 'referrals-page'],
    ]);
  });

  test('commits join by MR, else by repo@sha prefix; a stranger stays visibly unjoined', () => {
    assert.deepEqual(
      r.commits.map((c) => [c.repo, c.wave]),
      [['main-backend', 'referrals-page'], ['main-backend', 'old-shipped-gated'], ['main-backend', null], ['admin-ui', null]]
    );
  });

  test('a repo with no prod SHA says its commit list is untracked, not empty', () => {
    assert.deepEqual(r.commitsUntracked, [{ repo: 'mini-apps', reason: 'prod SHA unknown' }]);
  });
});

describe('waiting on you — 2026-09-24 additions (parked, scope, claimed, shippable)', () => {
  test('a parked wave that still holds a gate or a waiting_on_scott stays in the set', () => {
    const w = waitingBand([wave({ slug: 'parked-gated', status: 'parked', gate: 'do-not-run' })], NOW);
    assert.deepEqual(w.map((x) => x.slug), ['parked-gated']);
    assert.equal(w[0].status, 'parked');
  });

  test('scope renders alongside the slug when present; absent is null, not ""', () => {
    const [withScope] = waitingBand([wave({ slug: 'a', gate: 'do-not-run', scope: 'one-line human title', scope_truncated: true })], NOW);
    assert.equal(withScope.scope, 'one-line human title');
    assert.equal(withScope.scopeTruncated, true);
    const [noScope] = waitingBand([wave({ slug: 'b', gate: 'do-not-run' })], NOW);
    assert.equal(noScope.scope, null);
    assert.equal(noScope.scopeTruncated, false);
  });

  test('claimed=true renders an age; claimed=false and absent both carry no age — only claimed:true is a badge', () => {
    const [claimed] = waitingBand([wave({ slug: 'a', gate: 'do-not-run', claimed: true, claimed_age_seconds: 300 })], NOW);
    assert.equal(claimed.claimed, true);
    assert.equal(claimed.claimedAgeSeconds, 300);
    const [notClaimed] = waitingBand([wave({ slug: 'b', gate: 'do-not-run', claimed: false })], NOW);
    assert.equal(notClaimed.claimed, false);
    assert.equal(notClaimed.claimedAgeSeconds, null);
    const [absent] = waitingBand([wave({ slug: 'c', gate: 'do-not-run' })], NOW);
    assert.equal(absent.claimed, null);
    assert.equal(absent.claimedAgeSeconds, null);
  });

  test('lease stale threshold is exactly 14400s — 14399 fresh, 14400 stale', () => {
    assert.equal(CLAIMED_STALE_SECONDS, 14400);
    const [fresh] = waitingBand([wave({ slug: 'a', gate: 'do-not-run', claimed: true, claimed_age_seconds: 14399 })], NOW);
    assert.equal(fresh.claimedStale, false);
    const [stale] = waitingBand([wave({ slug: 'b', gate: 'do-not-run', claimed: true, claimed_age_seconds: 14400 })], NOW);
    assert.equal(stale.claimedStale, true);
  });

  test('shippable=true renders a checked age; false and absent both render nothing (null)', () => {
    const [yes] = waitingBand(
      [wave({ slug: 'a', gate: 'do-not-run', shippable: true, shippable_checked_at: minutesAgo(12) })],
      NOW
    );
    assert.equal(yes.shippable, true);
    assert.equal(yes.shippableCheckedAgeMin, 12);
    const [no] = waitingBand([wave({ slug: 'b', gate: 'do-not-run', shippable: false })], NOW);
    assert.equal(no.shippable, false);
    assert.equal(no.shippableCheckedAgeMin, null);
    const [absent] = waitingBand([wave({ slug: 'c', gate: 'do-not-run' })], NOW);
    assert.equal(absent.shippable, null);
    assert.equal(absent.shippableCheckedAgeMin, null);
  });
});

describe('blocked sessions — intents band 3', () => {
  test('newest first', () => {
    const older = intentRun({ session_id: 'sess-1', question: 'older' }, 120);
    const newer = intentRun({ session_id: 'sess-2', question: 'newer' }, 5);
    const b = intentsBand([older, newer], NOW);
    assert.deepEqual(b.items.map((i) => i.sessionId), ['sess-2', 'sess-1']);
  });

  test('capped at 50, with an exact "more" count', () => {
    const runs = Array.from({ length: 63 }, (_, i) => intentRun({ session_id: `sess-${i}` }, i));
    const b = intentsBand(runs, NOW);
    assert.equal(b.items.length, 50);
    assert.equal(b.moreCount, 13);
  });

  test('outside the 24h window is dropped entirely, not just uncounted', () => {
    const inWindow = intentRun({ session_id: 'in' }, 60);
    const outOfWindow = intentRun({ session_id: 'out' }, 25 * 60);
    const b = intentsBand([inWindow, outOfWindow], NOW);
    assert.deepEqual(b.items.map((i) => i.sessionId), ['in']);
    assert.equal(b.moreCount, 0);
  });

  test('an omitted question, notification_type or repo renders the fixed fallback copy', () => {
    const b = intentsBand([intentRun({ session_id: 'sess-1' }, 5)], NOW);
    assert.equal(b.items[0].question, 'no message in hook payload');
    assert.equal(b.items[0].notificationType, 'not tracked');
    assert.equal(b.items[0].repo, 'repo not tracked');
  });

  test('an empty 24h window is a measured zero, not an absent signal', () => {
    const b = boardState(base({ intents: [] }), NOW);
    assert.deepEqual(b.intents, { items: [], moreCount: 0 });
  });

  test('boardState wires intents through unfiltered by the other bands', () => {
    const runs = [intentRun({ session_id: 'sess-1', question: 'why?' }, 10)];
    const b = boardState(base({ intents: runs }), NOW);
    assert.equal(b.intents.items.length, 1);
    assert.equal(b.intents.items[0].question, 'why?');
  });
});
