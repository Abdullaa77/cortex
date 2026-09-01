#!/usr/bin/env node
/**
 * Refuse to believe the suite about code that is not running.
 *
 *   node scripts/check-deployed.mjs            # fetch origin, then check
 *   node scripts/check-deployed.mjs --offline  # skip the network entirely
 *
 * WHAT THIS EXISTS FOR, in one sentence: on 1 September 2026 a cutover guard
 * was written, tested, committed and never pushed, production went on serving
 * the build from three days earlier, and a count of thirteen drawers wrote
 * 3,488,123.87 so'm of fictional spending against a `reconcileCount` that did
 * not take a cutover date at all.
 *
 * Every check in this repo passed. They were all telling the truth about the
 * working tree, and the working tree was not what anyone was using. A day went
 * into chasing a guard that was never running, and the first hypothesis — an
 * unset setting — fitted the numbers perfectly and was wrong, because an
 * absent guard and an inert guard produce identical output.
 *
 * So this asks two questions nothing else here can:
 *
 *   1. Is local main ahead of origin/main? Cheap, offline, and the 90% case:
 *      it is answerable from the remote-tracking ref with no network at all,
 *      which is why run-tests.mjs shouts it on every run.
 *
 *   2. Is the SHA that is actually serving equal to origin/main? Only the
 *      deployment can answer that, so it is asked of the deployment, over
 *      HTTP, at /api/version. Not of the CI provider's API — that reports what
 *      it believes it deployed, which is a different claim from what is
 *      answering requests.
 *
 * A CLEAN EXIT CODE IS NOT A RESULT. Every way of failing to get an answer —
 * no network, the endpoint missing, a redirect to /login — exits non-zero and
 * says which. "Could not ask" must never render as "nothing is wrong"; that is
 * the same rule PositionsCard keeps for a failed load, and this file is the
 * deployment's version of it.
 */
import { execFileSync } from 'node:child_process';

const PROD = process.env.PROD_URL ?? 'https://cortex-sepia.vercel.app';
const BRANCH = process.env.DEPLOY_BRANCH ?? 'main';
const OFFLINE = process.argv.includes('--offline');

const RED = (s) => `\x1b[31m${s}\x1b[0m`;
const GREEN = (s) => `\x1b[32m${s}\x1b[0m`;
const YELLOW = (s) => `\x1b[33m${s}\x1b[0m`;
const DIM = (s) => `\x1b[2m${s}\x1b[0m`;

const git = (...args) =>
  execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

const problems = [];
const notes = [];

// ---------------------------------------------------------------- local vs origin
if (!OFFLINE) {
  try {
    git('fetch', 'origin', BRANCH, '--quiet');
  } catch {
    notes.push(`could not fetch origin/${BRANCH}; comparing against the last known ref`);
  }
}

let head = null;
let remote = null;
try {
  head = git('rev-parse', 'HEAD');
  remote = git('rev-parse', `origin/${BRANCH}`);
} catch {
  problems.push(`there is no origin/${BRANCH} to compare against`);
}

if (head && remote) {
  // left = commits on origin not local, right = commits local not on origin.
  const [behind, ahead] = git('rev-list', '--left-right', '--count', `origin/${BRANCH}...HEAD`)
    .split(/\s+/)
    .map(Number);

  if (ahead > 0) {
    const unpushed = git('log', '--oneline', `origin/${BRANCH}..HEAD`)
      .split('\n')
      .filter(Boolean);
    problems.push(
      `local is ${ahead} commit${ahead === 1 ? '' : 's'} ahead of origin/${BRANCH} — ` +
        `NOT DEPLOYED:\n` +
        unpushed.map((l) => `        ${l}`).join('\n')
    );
  }
  if (behind > 0) notes.push(`local is ${behind} commit(s) behind origin/${BRANCH}`);
}

// ---------------------------------------------------------------- what is serving
let serving = null;
if (OFFLINE) {
  notes.push('--offline: the deployed SHA was not checked');
} else {
  try {
    const res = await fetch(`${PROD}/api/version`, { redirect: 'manual' });

    if (res.status >= 300 && res.status < 400)
      problems.push(
        `${PROD}/api/version redirected to ${res.headers.get('location')} — ` +
          `the stamp is behind the auth wall, so what is deployed cannot be read`
      );
    else if (res.status === 404)
      problems.push(
        `${PROD}/api/version is 404 — the running build predates this check, ` +
          `which means it is old enough to be exactly what this exists to catch`
      );
    else if (!res.ok) problems.push(`${PROD}/api/version returned ${res.status}`);
    else {
      const body = await res.json();
      serving = body.sha;
      if (!serving) problems.push(`${PROD}/api/version reported no SHA`);
    }
  } catch (err) {
    problems.push(`could not reach ${PROD}: ${err.message}`);
  }
}

if (serving && remote && serving !== remote)
  problems.push(
    `the deployed SHA is not origin/${BRANCH}:\n` +
      `        serving   ${serving}\n` +
      `        origin/${BRANCH}   ${remote}`
  );

// ---------------------------------------------------------------- say it
const line = (k, v) => console.log(`  ${k.padEnd(26)} ${v}`);
console.log('');
line('HEAD', head ?? '(unknown)');
line(`origin/${BRANCH}`, remote ?? '(unknown)');
line('serving', serving ?? (OFFLINE ? DIM('not checked') : RED('unknown')));
console.log('');

for (const n of notes) console.log(`  ${YELLOW('--')} ${n}`);

if (problems.length === 0) {
  console.log(`  ${GREEN('deployed: origin/' + BRANCH + ' is what is serving.')}`);
  process.exit(0);
}

console.error(`  ${RED('deployed: what is running is not what you tested.')}\n`);
for (const p of problems) console.error(`    - ${p}`);
console.error(
  `\n  A green suite describes the working tree. It says nothing about the\n` +
    `  build answering requests. Push, wait for the deploy, and re-run.`
);
process.exit(1);
