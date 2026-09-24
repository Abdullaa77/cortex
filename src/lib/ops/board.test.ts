import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ACTION_WITHHELD, NOT_ANSWERABLE_PERMISSION, boardState, deriveWaitState, freshness, intentsBand, readyBand, rollup, waitingBand, type BoardInput } from './board.ts';
import { CONTROL_CHECKS, LIVE_CHECKS, NOW, GITLAB, WAVES, gitlabRun, intentRun, minutesAgo, sessionRun, wave, wavesRun } from './__fixtures__/runs.ts';

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

  test('claimed=true renders an age; claimed=false and absent both carry no age, no lease status — only claimed:true is a badge', () => {
    const [claimed] = waitingBand([wave({ slug: 'a', gate: 'do-not-run', claimed: true, claimed_age_seconds: 300 })], NOW);
    assert.equal(claimed.claimed, true);
    assert.equal(claimed.claimedAgeSeconds, 300);
    const [notClaimed] = waitingBand([wave({ slug: 'b', gate: 'do-not-run', claimed: false })], NOW);
    assert.equal(notClaimed.claimed, false);
    assert.equal(notClaimed.claimedAgeSeconds, null);
    assert.equal(notClaimed.leaseStatus, null);
    const [absent] = waitingBand([wave({ slug: 'c', gate: 'do-not-run' })], NOW);
    assert.equal(absent.claimed, null);
    assert.equal(absent.claimedAgeSeconds, null);
    assert.equal(absent.leaseStatus, null);
  });

  // Replaces the old fixed 14399s/14400s age-threshold test (contract 2026-09-24,
  // f2d746d): age alone is no longer the staleness test at all — a --ttl 12
  // claim is live at 5h, which the old 4h-flat rule would have called stale.
  describe('lease staleness — judged against lease_expires_at, never against age (f2d746d)', () => {
    const secondsFromNow = (s: number) => new Date(NOW.getTime() + s * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');

    test('a --ttl 12 claim (12h lease) still renders live at 5h old — the old 4h age rule would have called this stale', () => {
      const [w] = waitingBand(
        [wave({ slug: 'a', gate: 'do-not-run', claimed: true, claimed_age_seconds: 5 * 3600, lease_expires_at: secondsFromNow(7 * 3600) })],
        NOW
      );
      assert.equal(w.leaseStatus, 'live');
      assert.equal(w.claimedAgeSeconds, 5 * 3600);
    });

    test('render time exactly at, or past, lease_expires_at is stale; one second before is still live', () => {
      const [before] = waitingBand([wave({ slug: 'a', gate: 'do-not-run', claimed: true, lease_expires_at: secondsFromNow(1) })], NOW);
      assert.equal(before.leaseStatus, 'live');
      const [atExpiry] = waitingBand([wave({ slug: 'b', gate: 'do-not-run', claimed: true, lease_expires_at: secondsFromNow(0) })], NOW);
      assert.equal(atExpiry.leaseStatus, 'stale');
      const [after] = waitingBand([wave({ slug: 'c', gate: 'do-not-run', claimed: true, lease_expires_at: secondsFromNow(-1) })], NOW);
      assert.equal(after.leaseStatus, 'stale');
    });

    test('claimed=true with lease_expires_at absent is "unknown" — never "stale", never "live"', () => {
      const [w] = waitingBand([wave({ slug: 'a', gate: 'do-not-run', claimed: true })], NOW);
      assert.equal(w.leaseStatus, 'unknown');
    });
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
    // Both are legacy rows (no notification_type) → derived blocked.
    assert.deepEqual(b.blocked.map((i) => i.sessionId), ['sess-2', 'sess-1']);
    assert.deepEqual(b.idle, []);
  });

  test('capped at 50, with an exact "more" count', () => {
    const runs = Array.from({ length: 63 }, (_, i) => intentRun({ session_id: `sess-${i}` }, i));
    const b = intentsBand(runs, NOW);
    assert.equal(b.blocked.length, 50);
    assert.equal(b.moreCount, 13);
  });

  test('outside the 24h window is dropped entirely, not just uncounted', () => {
    const inWindow = intentRun({ session_id: 'in' }, 60);
    const outOfWindow = intentRun({ session_id: 'out' }, 25 * 60);
    const b = intentsBand([inWindow, outOfWindow], NOW);
    assert.deepEqual(b.blocked.map((i) => i.sessionId), ['in']);
    assert.equal(b.moreCount, 0);
  });

  test('notification: an omitted notification_type or repo renders the fixed fallback copy; question is null when absent', () => {
    const b = intentsBand([intentRun({ session_id: 'sess-1', trigger: 'notification' }, 5)], NOW);
    assert.equal(b.blocked[0].question, null);
    assert.equal(b.blocked[0].notificationWords, 'not tracked');
    assert.equal(b.blocked[0].repo, 'repo not tracked');
  });

  test('notification: a known notification_type renders in words; an unknown one renders raw, not dropped', () => {
    const known = intentsBand([intentRun({ session_id: 's1', trigger: 'notification', notification_type: 'idle_prompt' }, 5)], NOW);
    assert.equal(known.idle[0].notificationWords, 'idle — waiting for input');
    const unknown = intentsBand([intentRun({ session_id: 's2', trigger: 'notification', notification_type: 'brand_new_type' }, 5)], NOW);
    assert.equal(unknown.blocked[0].notificationWords, 'brand_new_type');
  });

  test('permission_request: tool_name/action/description carry through; notification-only fields stay null', () => {
    const b = intentsBand(
      [
        intentRun(
          { session_id: 's1', trigger: 'permission_request', tool_name: 'Bash', action: 'ls -la', description: 'List the directory' },
          5
        ),
      ],
      NOW
    );
    const [item] = b.blocked;
    assert.equal(item.toolName, 'Bash');
    assert.equal(item.action, 'ls -la');
    assert.equal(item.description, 'List the directory');
    assert.equal(item.notificationWords, null);
  });

  test('permission_request: an absent action is null, not a blank string — the board renders the "not projected" copy for it', () => {
    const b = intentsBand([intentRun({ session_id: 's1', trigger: 'permission_request', tool_name: 'mcp__figma__get_node' }, 5)], NOW);
    assert.equal(b.blocked[0].toolName, 'mcp__figma__get_node');
    assert.equal(b.blocked[0].action, null);
  });

  test('a withheld action is flagged so the board never styles it as a command; an ordinary action is not flagged (f2d746d)', () => {
    const withheld = intentsBand(
      [intentRun({ session_id: 's1', trigger: 'permission_request', tool_name: 'Bash', action: ACTION_WITHHELD }, 5)],
      NOW
    );
    assert.equal(withheld.blocked[0].action, ACTION_WITHHELD);
    assert.equal(withheld.blocked[0].actionWithheld, true);
    const ordinary = intentsBand(
      [intentRun({ session_id: 's2', trigger: 'permission_request', tool_name: 'Bash', action: 'ls -la' }, 5)],
      NOW
    );
    assert.equal(ordinary.blocked[0].actionWithheld, false);
  });

  test('an empty 24h window is a measured zero, not an absent signal', () => {
    const b = boardState(base({ intents: [] }), NOW);
    assert.deepEqual(b.intents, { blocked: [], idle: [], moreCount: 0 });
  });

  test('boardState wires intents through unfiltered by the other bands', () => {
    const runs = [intentRun({ session_id: 'sess-1', trigger: 'notification', question: 'why?' }, 10)];
    const b = boardState(base({ intents: runs }), NOW);
    assert.equal(b.intents.blocked.length, 1);
    assert.equal(b.intents.blocked[0].question, 'why?');
  });
});

describe('idle vs blocked — wait_state (contract 2026-09-24 amendment)', () => {
  test('explicit wait_state on the payload wins outright, no derivation needed', () => {
    const b = intentsBand(
      [intentRun({ session_id: 's1', trigger: 'notification', notification_type: 'agent_needs_input', wait_state: 'blocked' }, 5)],
      NOW
    );
    assert.equal(b.blocked.length, 1);
    assert.equal(b.blocked[0].waitState, 'blocked');
    const c = intentsBand([intentRun({ session_id: 's2', trigger: 'notification', notification_type: 'idle_prompt', wait_state: 'idle' }, 5)], NOW);
    assert.equal(c.idle.length, 1);
    assert.equal(c.idle[0].waitState, 'idle');
  });

  test('PermissionRequest is always blocked', () => {
    const b = intentsBand([intentRun({ session_id: 's1', trigger: 'permission_request', tool_name: 'Bash', wait_state: 'blocked' }, 5)], NOW);
    assert.equal(b.blocked[0].waitState, 'blocked');
  });

  test('Notification agent_needs_input and elicitation_dialog are blocked; idle_prompt is idle', () => {
    const needsInput = intentsBand([intentRun({ session_id: 's1', trigger: 'notification', notification_type: 'agent_needs_input', wait_state: 'blocked' }, 5)], NOW);
    assert.equal(needsInput.blocked.length, 1);
    const elicitation = intentsBand([intentRun({ session_id: 's2', trigger: 'notification', notification_type: 'elicitation_dialog', wait_state: 'blocked' }, 5)], NOW);
    assert.equal(elicitation.blocked.length, 1);
    const idle = intentsBand([intentRun({ session_id: 's3', trigger: 'notification', notification_type: 'idle_prompt', wait_state: 'idle' }, 5)], NOW);
    assert.equal(idle.idle.length, 1);
  });

  test('legacy rows (no wait_state) derive from trigger/notification_type: idle_prompt -> idle, anything else -> blocked', () => {
    assert.equal(deriveWaitState({ trigger: 'notification', notification_type: 'idle_prompt', asked_at: 'x' } as never), 'idle');
    assert.equal(deriveWaitState({ trigger: 'notification', notification_type: 'agent_needs_input', asked_at: 'x' } as never), 'blocked');
    assert.equal(deriveWaitState({ trigger: 'notification', asked_at: 'x' } as never), 'blocked');
    assert.equal(deriveWaitState({ trigger: 'permission_request', asked_at: 'x' } as never), 'blocked');
  });

  test('a mixed batch: an idle row never appears in the blocked group, and vice versa', () => {
    const b = intentsBand(
      [
        intentRun({ session_id: 'idle-1', trigger: 'notification', notification_type: 'idle_prompt' }, 5),
        intentRun({ session_id: 'blocked-1', trigger: 'notification', notification_type: 'agent_needs_input' }, 6),
        intentRun({ session_id: 'blocked-2', trigger: 'permission_request', tool_name: 'Bash' }, 7),
      ],
      NOW
    );
    assert.deepEqual(b.idle.map((i) => i.sessionId), ['idle-1']);
    assert.deepEqual(
      b.blocked.map((i) => i.sessionId).sort(),
      ['blocked-1', 'blocked-2']
    );
    assert.ok(!b.blocked.some((i) => i.sessionId === 'idle-1'));
    assert.ok(!b.idle.some((i) => i.sessionId.startsWith('blocked')));
  });
});

describe('D7 — parked badge (imcoin-d7-affordability-report, 2026-09-24)', () => {
  test('a parked wave with gate "none" still gets the badge (the D7 shape)', () => {
    const [d7] = waitingBand(
      [wave({ slug: 'imcoin-d7-affordability-report', status: 'parked', gate: 'none', waiting_on_scott: 'confirm the report format' })],
      NOW
    );
    assert.equal(d7.status, 'parked');
    assert.equal(d7.gate, 'none');
    assert.equal(d7.parkedBadge, true);
  });

  test('a parked wave with a real gate also gets the badge (unchanged from before)', () => {
    const [gated] = waitingBand([wave({ slug: 'parked-gated', status: 'parked', gate: 'do-not-run' })], NOW);
    assert.equal(gated.parkedBadge, true);
  });

  test('a non-parked wave never gets the badge', () => {
    const [inFlight] = waitingBand([wave({ slug: 'not-parked', status: 'in-flight', gate: 'do-not-run' })], NOW);
    assert.equal(inFlight.parkedBadge, false);
  });
});

describe('answers — the return path (015, §5c)', () => {
  const answer = (runId: string, over: Record<string, unknown> = {}) => ({
    id: `ans-${runId}`,
    run_id: runId,
    decision: 'choose' as const,
    answer: 'Option B.',
    answered_at: minutesAgo(4),
    status: 'pending' as const,
    applied_at: null,
    ...over,
  });

  test('a run with no ops_intents row is waiting: answer null, answerable', () => {
    const b = intentsBand([intentRun({ session_id: 's1', trigger: 'notification', notification_type: 'agent_needs_input' }, 5)], NOW, []);
    assert.equal(b.blocked[0].answer, null);
    assert.deepEqual(b.blocked[0].answerable, { ok: true });
  });

  test('joined by run_id — never by session_id (one session can ask twice)', () => {
    const first = intentRun({ session_id: 'same', trigger: 'notification', notification_type: 'agent_needs_input' }, 30);
    const second = intentRun({ session_id: 'same', trigger: 'notification', notification_type: 'agent_needs_input' }, 5);
    const b = intentsBand([first, second], NOW, [answer(first.run_id)]);
    const byRun = new Map(b.blocked.map((i) => [i.runId, i]));
    assert.equal(byRun.get(first.run_id)!.answer!.text, 'Option B.');
    assert.equal(byRun.get(second.run_id)!.answer, null);
  });

  test('pending vs applied carry their own ages; the decision kind is in words', () => {
    const r1 = intentRun({ session_id: 'p', trigger: 'notification' }, 20);
    const r2 = intentRun({ session_id: 'a', trigger: 'notification' }, 20);
    const b = intentsBand([r1, r2], NOW, [
      answer(r1.run_id),
      answer(r2.run_id, { status: 'applied', applied_at: minutesAgo(2), decision: 'clarify' }),
    ]);
    const byRun = new Map(b.blocked.map((i) => [i.runId, i]));
    const p = byRun.get(r1.run_id)!.answer!;
    assert.equal(p.status, 'pending');
    assert.equal(p.answeredAgeMin, 4);
    assert.equal(p.appliedAgeMin, null);
    assert.equal(p.decisionWords, 'Choose between the options it gave');
    const a = byRun.get(r2.run_id)!.answer!;
    assert.equal(a.status, 'applied');
    assert.equal(a.appliedAgeMin, 2);
    assert.equal(a.decisionWords, 'Clarify what was meant');
  });

  test('an idle row takes an answer too (feeding it is the point); a permission prompt does not', () => {
    const idle = intentRun({ session_id: 'i', trigger: 'notification', notification_type: 'idle_prompt', wait_state: 'idle' }, 5);
    const perm = intentRun({ session_id: 'q', trigger: 'permission_request', tool_name: 'Bash', action: 'git push' }, 5);
    const b = intentsBand([idle, perm], NOW, []);
    assert.deepEqual(b.idle[0].answerable, { ok: true });
    assert.deepEqual(b.blocked[0].answerable, { ok: false, reason: NOT_ANSWERABLE_PERMISSION });
  });

  test('boardState passes input.answers through', () => {
    const run = intentRun({ session_id: 's', trigger: 'notification' }, 5);
    const b = boardState(base({ intents: [run], answers: [answer(run.run_id)] }), NOW);
    assert.equal(b.intents.blocked[0].answer!.status, 'pending');
  });
});

describe('parks — the 60-minute path (017)', () => {
  test('a parked run carries its park age; others are null; answer state is independent', () => {
    const parked = intentRun({ session_id: 'p', trigger: 'notification' }, 70);
    const plain = intentRun({ session_id: 'q', trigger: 'notification' }, 70);
    const b = intentsBand([parked, plain], NOW, [], [{ run_id: parked.run_id, parked_at: minutesAgo(8) }]);
    const byRun = new Map(b.blocked.map((i) => [i.runId, i]));
    assert.equal(byRun.get(parked.run_id)!.parkedAgeMin, 8);
    assert.equal(byRun.get(plain.run_id)!.parkedAgeMin, null);
    assert.equal(byRun.get(parked.run_id)!.answer, null);
  });

  test('boardState passes input.parks through', () => {
    const run = intentRun({ session_id: 's', trigger: 'notification' }, 70);
    const b = boardState(base({ intents: [run], parks: [{ run_id: run.run_id, parked_at: minutesAgo(3) }] }), NOW);
    assert.equal(b.intents.blocked[0].parkedAgeMin, 3);
  });
});
