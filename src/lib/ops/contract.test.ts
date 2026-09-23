import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { validateEnvelope } from './contract.ts';
import { GITLAB, LIVE_CHECKS, NOW, WAVES, envelopeOf } from './__fixtures__/runs.ts';

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
