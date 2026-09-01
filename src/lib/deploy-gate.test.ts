import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * The question no other check in this repo asks.
 *
 * On 1 September 2026 a cutover guard was written, tested, committed and never
 * pushed. Production went on serving the build from three days earlier — one
 * in which `reconcileCount` did not take a cutover date at all — and a
 * physical count of thirteen drawers wrote 3,488,123.87 so'm of fictional
 * spending into the ledger. 605 tests passed throughout. They were telling the
 * truth about the working tree, which was not what anyone was using.
 *
 * The first diagnosis fitted every number and was wrong: an absent guard and
 * an inert guard produce identical output, so the data could not tell them
 * apart. Only the deployment could, and nothing was asking it.
 *
 * These pin the two halves of the answer — the offline one that fires on every
 * suite run, and the networked one that asks the deployment itself.
 */

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const ROUTE = read('../app/api/version/route.ts');
const MIDDLEWARE = read('../middleware.ts');
const CHECK = read('../../scripts/check-deployed.mjs');
const RUNNER = read('../../scripts/run-tests.mjs');
const PKG = JSON.parse(read('../../package.json'));

describe('the deployment can say which commit it is', () => {
  test('the stamp exposes the SHA and nothing else', () => {
    assert.match(ROUTE, /VERCEL_GIT_COMMIT_SHA/);
    // A build identity, not an environment dump. Anything else here would make
    // a public endpoint a disclosure decision every time it was edited.
    const keys = [...ROUTE.matchAll(/^\s{4}(\w+):/gm)].map((m) => m[1]);
    assert.deepEqual(keys.sort(), ['env', 'ref', 'sha']);
  });

  test('it is static, because a build identity cannot change between requests', () => {
    assert.match(ROUTE, /export const dynamic = 'force-static'/);
  });

  test('local dev claims no SHA rather than a misleading one', () => {
    // `?? null`, never a fallback to HEAD: a dev server is not a deployment,
    // and a stamp that guessed would be the exact failure this prevents.
    assert.match(ROUTE, /VERCEL_GIT_COMMIT_SHA \?\? null/);
  });
});

describe('the stamp is reachable without a session', () => {
  /** The real matcher, executed — not the comment above it. */
  const matcher = (() => {
    const m = /^\s*'(\/\(\(\?!.+)',?$/m.exec(MIDDLEWARE);
    assert.ok(m, 'the middleware matcher could not be read');
    // Anchored, the way Next applies it. Unanchored, `/api/version` would
    // still "match" from a later offset where the lookahead sees only
    // `version`, and this test would pass while the wall stayed shut.
    return new RegExp(`^${m[1].replace(/\\\\/g, '\\')}$`);
  })();

  test('/api/version is exempt, so the check is not redirected to /login', () => {
    assert.equal(
      matcher.test('/api/version'),
      false,
      'middleware still intercepts the stamp — check:deployed cannot read it'
    );
  });

  test('and the app itself is still guarded', () => {
    // The exemption must be a hole for one path, not a hole in the auth wall.
    for (const path of ['/finance', '/finance/cutover', '/settings', '/api/other'])
      assert.equal(matcher.test(path), true, `${path} stopped being guarded`);
  });
});

describe('could not ask is never reported as nothing is wrong', () => {
  test('every way of failing to get an answer is a problem, not a pass', () => {
    // The repo's rule, applied to the deployment: an empty answer is not the
    // answer "fine". See failure-states.test.ts for the same rule on screen.
    for (const branch of ['redirected to', 'is 404', 'returned', 'could not reach'])
      assert.ok(CHECK.includes(branch), `check-deployed lost its "${branch}" branch`);

    const problems = CHECK.slice(CHECK.indexOf('let serving = null'), CHECK.indexOf('// ---'));
    assert.doesNotMatch(problems, /process\.exit\(0\)/, 'a failed read exits clean');
  });

  test('it asks the deployment, not the provider that believes it deployed', () => {
    assert.match(CHECK, /\/api\/version/);
    assert.match(CHECK, /redirect: 'manual'/, 'a redirect would be followed and read as content');
  });

  test('a SHA mismatch fails', () => {
    assert.match(CHECK, /serving !== remote/);
  });

  test('it is reachable as a named command', () => {
    assert.equal(PKG.scripts['check:deployed'], 'node scripts/check-deployed.mjs');
  });
});

describe('the suite says what it is green about', () => {
  test('it names unpushed commits after the summary', () => {
    assert.match(RUNNER, /green — about code that is not deployed/);
    assert.match(RUNNER, /origin\/\$\{branch\}\.\.HEAD/);
  });

  test('offline, so it costs the suite nothing and cannot flake', () => {
    const fn = RUNNER.slice(RUNNER.indexOf('function unpushed'), RUNNER.indexOf('const child ='));
    assert.doesNotMatch(fn, /fetch|https?:/, 'the per-run check reaches the network');
    assert.match(fn, /return null/, 'no upstream is treated as a failure rather than unknown');
  });

  test('and it does not fail the suite', () => {
    // An unpushed commit does not make a test result wrong. It makes it
    // misleading, and the fix for misleading is a sentence, not a red build.
    const tail = RUNNER.slice(RUNNER.indexOf('const drift = unpushed()'));
    assert.doesNotMatch(tail, /process\.exit\(1\)/);
  });

  test('it points at the check that does refuse', () => {
    assert.match(RUNNER, /npm run check:deployed/);
  });
});
