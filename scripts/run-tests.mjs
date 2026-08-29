#!/usr/bin/env node
/**
 * Run the suite, and refuse to exit 0 if it never ran.
 *
 *   node scripts/run-tests.mjs
 *
 * `npm test` was `node --test "src/**\/*.test.ts"`, which is correct — but on a
 * shell whose `npm` resolved to Windows npm through /mnt/c, the command went
 * through CMD.EXE, the glob was never expanded, and the runner found nothing:
 *
 *   ℹ tests 0
 *   ℹ pass 0
 *   ℹ fail 0
 *
 * Exit code 0. A green light that means nothing, which is worse than a red one
 * — the same shape as a migration that skips the row it cannot place and
 * reports success. So zero tests is a failure here, explicitly.
 *
 * The toolchain check is in front of it because that is what actually broke:
 * `node`, `npm` and `npx` must all come from the same place, and it must not
 * be Windows.
 */
import { spawn } from 'node:child_process';
import { execFileSync } from 'node:child_process';

const PATTERN = 'src/**/*.test.ts';

function toolchain() {
  const problems = [];

  const major = Number(process.versions.node.split('.')[0]);
  if (major < 24)
    problems.push(`node is v${process.versions.node}; package.json engines wants >=24 <25`);

  // The real symptom: node from one place, npm from another. On WSL that
  // second place was /mnt/c/Program Files/nodejs, and every npm script ran
  // under CMD.EXE against a UNC path it could not use.
  for (const tool of ['npm', 'npx']) {
    let resolved;
    try {
      resolved = execFileSync('sh', ['-c', `command -v ${tool}`], { encoding: 'utf8' }).trim();
    } catch {
      problems.push(`${tool} is not on PATH at all`);
      continue;
    }
    if (resolved.startsWith('/mnt/'))
      problems.push(`${tool} resolves to ${resolved} — that is the Windows one, reached through /mnt`);
  }

  return problems;
}

const problems = toolchain();
if (problems.length) {
  console.error('toolchain: refusing to run the suite.\n');
  for (const p of problems) console.error(`  - ${p}`);
  console.error(
    '\n  A suite run by the wrong toolchain does not report what you think it does.\n' +
      '  Fix: nvm alias default 24 && exec zsh'
  );
  process.exit(1);
}

const child = spawn(process.execPath, ['--test', PATTERN], { stdio: ['inherit', 'pipe', 'inherit'] });

let out = '';
child.stdout.on('data', (chunk) => {
  out += chunk;
  process.stdout.write(chunk);
});

child.on('close', (code) => {
  // The spec reporter's summary. Absent means the runner did not get far
  // enough to print one, which is itself a failure.
  const m = /^\D*tests (\d+)$/m.exec(out);
  const count = m ? Number(m[1]) : null;

  if (count === null) {
    console.error('\nno test summary was printed — the runner did not complete.');
    process.exit(1);
  }

  if (count === 0) {
    console.error(
      `\nzero tests ran, matching ${PATTERN}.\n` +
        '  Exiting 1. An empty suite passing is not a pass — it is the check\n' +
        '  having gone missing without saying so.'
    );
    process.exit(1);
  }

  process.exit(code ?? 1);
});
