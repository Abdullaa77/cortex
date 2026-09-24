import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { validateEnvelope } from './contract.ts';
import { GITLAB, LIVE_CHECKS, NOW, WAVES, envelopeOf, wave } from './__fixtures__/runs.ts';

const errorsOf = (x: unknown) => {
  const r = validateEnvelope(x, NOW);
  return r.ok ? [] : r.errors;
};

const live = () => envelopeOf('session_check', { mode: 'live', exit_code: 0, verdict: 'ALL CLEAR', checks: structuredClone(LIVE_CHECKS) });

describe('contract v1 accepts what the producers send', () => {
  test('session_check, waves and gitlab fixtures are valid', () => {
    assert.deepEqual(errorsOf(live()), []);
    assert.deepEqual(errorsOf(envelopeOf('waves', { waves: structuredClone(WAVES) })), []);
    assert.deepEqual(errorsOf(envelopeOf('gitlab', structuredClone(GITLAB))), []);
  });

  test('a control run needs its control block; a live run may not have one', () => {
    const ctl = envelopeOf('session_check', { mode: 'control', exit_code: 1, verdict: 'x', checks: [] });
    assert.deepEqual(errorsOf(ctl), ['$.payload.control: required when mode=control']);
    const bad = live();
    (bad.payload as Record<string, unknown>).control = { expected: 'all_red', observed_all_red: true, not_red: [] };
    assert.deepEqual(errorsOf(bad), ['$.payload.control: forbidden when mode=live']);
  });
});

describe('contract v1 refuses, and lists every problem', () => {
  test('null anywhere is refused — the three-state rule', () => {
    const e = live();
    (e.payload as { checks: { values: Record<string, unknown> }[] }).checks[2].values.count = null;
    assert.deepEqual(errorsOf(e), ['$.payload.checks[2].values.count: null is not accepted']);
  });

  test('unknown and forbidden keys, at any depth, all reported at once', () => {
    const e = envelopeOf('waves', { waves: structuredClone(WAVES) });
    const w = (e.payload as { waves: Record<string, unknown>[] }).waves;
    w[0].body = 'prod finding';
    w[1].worktree = '/home/x';
    w[2].surprise = 1;
    assert.deepEqual(errorsOf(e), [
      '$.payload.waves[0].body: forbidden key',
      '$.payload.waves[1].worktree: forbidden key',
      '$.payload.waves[2].surprise: unknown key',
    ]);
  });

  test('method_label: required for exact/timing_proxy, forbidden for query/heartbeat', () => {
    const e = live();
    const checks = (e.payload as { checks: Record<string, unknown>[] }).checks;
    delete checks[0].method_label;
    checks[2].method_label = 'exact';
    assert.deepEqual(errorsOf(e), [
      '$.payload.checks[0].method_label: required when method=exact',
      '$.payload.checks[2].method_label: forbidden when method=query',
    ]);
  });

  test('mrs as a comma string, shas without the repo, a waiting text over the cap', () => {
    const e = envelopeOf('waves', { waves: structuredClone(WAVES) });
    const w = (e.payload as { waves: Record<string, unknown>[] }).waves;
    w[0].mrs = 'main-backend!1,admin-ui!2';
    w[1].shas = ['6920a3ca'];
    w[2].waiting_on_scott = 'x'.repeat(241);
    assert.deepEqual(errorsOf(e), [
      '$.payload.waves[0].mrs: must be a list',
      '$.payload.waves[1].shas[0]: does not match /^[\\w.-]+@[0-9a-f]{7,40}$/',
      '$.payload.waves[2].waiting_on_scott: longer than 240',
    ]);
  });

  test('a finish in the future or before the start is refused — freshness cannot be faked', () => {
    const e = live();
    e.finished_at = '2026-09-23T18:06:00Z';
    assert.deepEqual(errorsOf(e), ['$.finished_at: more than 5 minutes in the future']);
    e.finished_at = '2026-09-23T17:58:00Z';
    assert.deepEqual(errorsOf(e), ['$.finished_at: before started_at']);
  });

  test('a timestamp without Z, a wrong version, a duplicate wave slug', () => {
    const e = envelopeOf('waves', { waves: [structuredClone(WAVES[0]), structuredClone(WAVES[0])] });
    e.v = 2;
    e.started_at = '2026-09-23T17:59:00+05:00';
    assert.deepEqual(errorsOf(e), [
      '$.v: must be 1',
      '$.started_at: does not match /^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}Z$/',
      '$.payload.waves[1].slug: duplicate slug',
    ]);
  });

  test('commits_prod_to_head without a prod_sha is refused — an empty list would read as "nothing pending"', () => {
    const g = structuredClone(GITLAB);
    delete g.repos[0].prod_sha;
    assert.deepEqual(errorsOf(envelopeOf('gitlab', g)), ['$.payload.repos[0].commits_prod_to_head: forbidden without prod_sha']);
  });

  test('gitlab: untracked per repo and per MR, a pipeline-less MR, a direct-push commit (brain-4b, 2026-09-23)', () => {
    const g = structuredClone(GITLAB) as unknown as { repos: Record<string, unknown>[] };
    g.repos[2].untracked = { prod_sha: 'timing proxy — Amplify exposes no build SHA', commits_prod_to_head: 'no prod_sha' };
    const mr = (g.repos[0].open_mrs as Record<string, unknown>[])[2];
    delete mr.pipeline_status;
    mr.untracked = { pipeline_status: 'no pipeline for the current sha' };
    assert.deepEqual(errorsOf(envelopeOf('gitlab', g)), []);
  });

  test('a wave whose note records no branch or family omits the keys — "" is refused (9 real notes, 2026-09-23)', () => {
    const w = structuredClone(WAVES[0]) as unknown as Record<string, unknown>;
    delete w.branch;
    delete w.family;
    assert.deepEqual(errorsOf(envelopeOf('waves', { waves: [w] })), []);
    w.branch = '';
    assert.deepEqual(errorsOf(envelopeOf('waves', { waves: [w] })), ['$.payload.waves[0].branch: empty string is not accepted — omit the key']);
  });
});

describe('contract v1, 2026-09-24 additions — wave: status parked, scope, claimed, shippable', () => {
  test('status "parked" is accepted', () => {
    assert.deepEqual(errorsOf(envelopeOf('waves', { waves: [wave({ slug: 'a', status: 'parked' })] })), []);
  });

  test('scope ≤ 240 with scope_truncated is accepted; over the cap, or a truncated flag with no scope, is refused', () => {
    assert.deepEqual(errorsOf(envelopeOf('waves', { waves: [wave({ slug: 'a', scope: 'one-line human title', scope_truncated: true })] })), []);
    assert.deepEqual(errorsOf(envelopeOf('waves', { waves: [wave({ slug: 'a', scope: 'x'.repeat(241) })] })), [
      '$.payload.waves[0].scope: longer than 240',
    ]);
    const w = wave({ slug: 'a' }) as unknown as Record<string, unknown>;
    w.scope_truncated = true;
    assert.deepEqual(errorsOf(envelopeOf('waves', { waves: [w] })), ['$.payload.waves[0].scope_truncated: set without scope']);
  });

  test('claimed_age_seconds is forbidden unless claimed=true — the endpoint validates only the checkable half', () => {
    assert.deepEqual(errorsOf(envelopeOf('waves', { waves: [wave({ slug: 'a', claimed: true, claimed_age_seconds: 300 })] })), []);
    // claimed=true with no age at all: optional, not required.
    assert.deepEqual(errorsOf(envelopeOf('waves', { waves: [wave({ slug: 'a', claimed: true })] })), []);
    // claimed=false, or absent, with an age present: refused either way.
    assert.deepEqual(errorsOf(envelopeOf('waves', { waves: [wave({ slug: 'a', claimed: false, claimed_age_seconds: 300 })] })), [
      '$.payload.waves[0].claimed_age_seconds: forbidden unless claimed=true',
    ]);
    const w = wave({ slug: 'a' }) as unknown as Record<string, unknown>;
    w.claimed_age_seconds = 300;
    assert.deepEqual(errorsOf(envelopeOf('waves', { waves: [w] })), ['$.payload.waves[0].claimed_age_seconds: forbidden unless claimed=true']);
  });

  test('lease_expires_at: same observable-half rule as claimed_age_seconds — forbidden unless claimed=true, optional when claimed=true (f2d746d)', () => {
    assert.deepEqual(
      errorsOf(envelopeOf('waves', { waves: [wave({ slug: 'a', claimed: true, lease_expires_at: '2026-09-25T02:00:00Z' })] })),
      []
    );
    // claimed=true with no lease at all: optional, not required (a producer that
    // could not read the claim's expiresAt is not a schema violation).
    assert.deepEqual(errorsOf(envelopeOf('waves', { waves: [wave({ slug: 'a', claimed: true })] })), []);
    assert.deepEqual(
      errorsOf(envelopeOf('waves', { waves: [wave({ slug: 'a', claimed: false, lease_expires_at: '2026-09-25T02:00:00Z' })] })),
      ['$.payload.waves[0].lease_expires_at: forbidden unless claimed=true']
    );
    const w = wave({ slug: 'a' }) as unknown as Record<string, unknown>;
    w.lease_expires_at = '2026-09-25T02:00:00Z';
    assert.deepEqual(errorsOf(envelopeOf('waves', { waves: [w] })), ['$.payload.waves[0].lease_expires_at: forbidden unless claimed=true']);
  });

  test('lease_expires_at without a Z suffix is refused, same as every other timestamp in the contract', () => {
    assert.deepEqual(
      errorsOf(envelopeOf('waves', { waves: [wave({ slug: 'a', claimed: true, lease_expires_at: '2026-09-25T02:00:00+05:00' })] })),
      ['$.payload.waves[0].lease_expires_at: does not match /^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}Z$/']
    );
  });

  test('shippable_checked_at is required exactly when shippable is present, whatever its value', () => {
    assert.deepEqual(
      errorsOf(envelopeOf('waves', { waves: [wave({ slug: 'a', shippable: true, shippable_checked_at: '2026-09-24T10:00:00Z' })] })),
      []
    );
    assert.deepEqual(
      errorsOf(envelopeOf('waves', { waves: [wave({ slug: 'a', shippable: false, shippable_checked_at: '2026-09-24T10:00:00Z' })] })),
      []
    );
    assert.deepEqual(errorsOf(envelopeOf('waves', { waves: [wave({ slug: 'a', shippable: true })] })), [
      '$.payload.waves[0].shippable_checked_at: required when shippable is present',
    ]);
    const w = wave({ slug: 'a' }) as unknown as Record<string, unknown>;
    w.shippable_checked_at = '2026-09-24T10:00:00Z';
    assert.deepEqual(errorsOf(envelopeOf('waves', { waves: [w] })), [
      '$.payload.waves[0].shippable_checked_at: forbidden without shippable',
    ]);
  });
});

describe('contract v1, 2026-09-24 additions — kind: intent_request', () => {
  const valid = () =>
    envelopeOf('intent_request', {
      session_id: 'sess-abc123',
      trigger: 'notification',
      wait_state: 'blocked',
      notification_type: 'agent_needs_input',
      question: 'merge admin-ui!145 now or after !402 deploys?',
      asked_at: '2026-09-24T10:00:00Z',
      repo: 'main-backend',
    });

  const permission = () =>
    envelopeOf('intent_request', {
      session_id: 'sess-abc123',
      trigger: 'permission_request',
      wait_state: 'blocked',
      tool_name: 'Bash',
      action: 'curl -s -o /dev/null https://example.com/probe-cd34',
      description: 'Probe example.com endpoint silently',
      asked_at: '2026-09-24T10:00:00Z',
      repo: 'cortex',
    });

  test('a fully-populated notification and a fully-populated permission_request are both accepted; a minimal one (session_id + trigger + wait_state + asked_at only) is too', () => {
    assert.deepEqual(errorsOf(valid()), []);
    assert.deepEqual(errorsOf(permission()), []);
    assert.deepEqual(
      errorsOf(
        envelopeOf('intent_request', {
          session_id: 'sess-1',
          trigger: 'notification',
          wait_state: 'idle',
          asked_at: '2026-09-24T10:00:00Z',
        })
      ),
      []
    );
  });

  test('session_id, trigger, wait_state and asked_at are required', () => {
    assert.deepEqual(errorsOf(envelopeOf('intent_request', {})), [
      '$.payload.session_id: required',
      '$.payload.trigger: required',
      '$.payload.wait_state: required',
      '$.payload.asked_at: required',
    ]);
  });

  test('wait_state must be blocked or idle — missing or bogus is refused, valid passes', () => {
    const missing = valid();
    delete (missing.payload as Record<string, unknown>).wait_state;
    assert.deepEqual(errorsOf(missing), ['$.payload.wait_state: required']);
    const bogus = valid();
    (bogus.payload as Record<string, unknown>).wait_state = 'bogus';
    assert.deepEqual(errorsOf(bogus), ['$.payload.wait_state: must be one of blocked|idle']);
    const idle = valid();
    (idle.payload as Record<string, unknown>).notification_type = 'idle_prompt';
    (idle.payload as Record<string, unknown>).wait_state = 'idle';
    assert.deepEqual(errorsOf(idle), []);
  });

  test('session_id, notification_type and tool_name reject characters outside their pattern', () => {
    const bad1 = valid();
    (bad1.payload as Record<string, unknown>).session_id = 'has a space';
    assert.deepEqual(errorsOf(bad1), ['$.payload.session_id: does not match /^[A-Za-z0-9_-]+$/']);
    const bad2 = valid();
    (bad2.payload as Record<string, unknown>).notification_type = 'HasCaps';
    assert.deepEqual(errorsOf(bad2), ['$.payload.notification_type: does not match /^[a-z_]+$/']);
    const bad3 = permission();
    (bad3.payload as Record<string, unknown>).tool_name = 'has a space';
    assert.deepEqual(errorsOf(bad3), ['$.payload.tool_name: does not match /^[A-Za-z0-9_.:-]+$/']);
  });

  test('question over 240 is refused; question_truncated without a question is refused', () => {
    const long = valid();
    (long.payload as Record<string, unknown>).question = 'x'.repeat(241);
    assert.deepEqual(errorsOf(long), ['$.payload.question: longer than 240']);
    const orphan = envelopeOf('intent_request', {
      session_id: 'sess-1',
      trigger: 'notification',
      wait_state: 'blocked',
      asked_at: '2026-09-24T10:00:00Z',
      question_truncated: true,
    });
    assert.deepEqual(errorsOf(orphan), ['$.payload.question_truncated: set without question']);
  });

  test('action over 240 is refused; action_truncated without an action is refused', () => {
    const long = permission();
    (long.payload as Record<string, unknown>).action = 'x'.repeat(241);
    assert.deepEqual(errorsOf(long), ['$.payload.action: longer than 240']);
    const orphan = envelopeOf('intent_request', {
      session_id: 'sess-1',
      trigger: 'permission_request',
      wait_state: 'blocked',
      tool_name: 'Bash',
      asked_at: '2026-09-24T10:00:00Z',
      action_truncated: true,
    });
    assert.deepEqual(errorsOf(orphan), ['$.payload.action_truncated: set without action']);
  });

  test('description over 240 is refused; description_truncated without a description is refused', () => {
    const long = permission();
    (long.payload as Record<string, unknown>).description = 'x'.repeat(241);
    assert.deepEqual(errorsOf(long), ['$.payload.description: longer than 240']);
    const orphan = envelopeOf('intent_request', {
      session_id: 'sess-1',
      trigger: 'permission_request',
      wait_state: 'blocked',
      tool_name: 'Bash',
      asked_at: '2026-09-24T10:00:00Z',
      description_truncated: true,
    });
    assert.deepEqual(errorsOf(orphan), ['$.payload.description_truncated: set without description']);
  });

  test('cross-combination: permission_request-only fields are refused on trigger=notification, and vice versa (aeb9adf)', () => {
    const crossed = valid();
    (crossed.payload as Record<string, unknown>).tool_name = 'Bash';
    (crossed.payload as Record<string, unknown>).action = 'ls';
    assert.deepEqual(errorsOf(crossed), [
      '$.payload.tool_name: forbidden unless trigger=permission_request',
      '$.payload.action: forbidden unless trigger=permission_request',
    ]);
    const reversed = permission();
    (reversed.payload as Record<string, unknown>).notification_type = 'agent_needs_input';
    assert.deepEqual(errorsOf(reversed), ['$.payload.notification_type: forbidden unless trigger=notification']);
  });

  test('cwd is forbidden at any depth, alongside the existing list', () => {
    const e = valid();
    (e.payload as Record<string, unknown>).cwd = '/home/abdulloh/dev/worktrees/x';
    assert.deepEqual(errorsOf(e), ['$.payload.cwd: forbidden key']);
  });

  test('transcript_path is forbidden at any depth', () => {
    const e = valid();
    (e.payload as Record<string, unknown>).transcript_path = '/tmp/claude/transcript.jsonl';
    assert.deepEqual(errorsOf(e), ['$.payload.transcript_path: forbidden key']);
  });

  test('tool_input is forbidden at any depth — the raw payload never leaves the box, only the projected action does', () => {
    const e = permission();
    (e.payload as Record<string, unknown>).tool_input = { command: 'curl -s -o /dev/null https://example.com/probe-cd34' };
    assert.deepEqual(errorsOf(e), ['$.payload.tool_input: forbidden key']);
  });

  test('producer.name "intent-hook" is accepted for this kind', () => {
    assert.deepEqual(errorsOf(valid()), []);
    assert.equal((valid().producer as Record<string, unknown>).name, 'intent-hook');
  });
});
