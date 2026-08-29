#!/usr/bin/env node
/**
 * Fail the build when the target database is behind the migrations directory.
 *
 *   node scripts/check-migrations.mjs
 *
 * Why this exists, in one sentence: merging to main deploys, applying a
 * migration is a separate manual act in the Supabase SQL editor, and on
 * 2026-08-29 three merged stages of finance shipped against a database that
 * had never seen 008–010. /finance reported finance_settings missing,
 * /finance/transactions failed outright, and the accounts card said "No
 * accounts yet" — which read as a setup problem rather than a broken database
 * and cost a day.
 *
 * The fix is not "remember to run the migration". It is that a deploy which
 * needs one cannot go out green.
 *
 * ---------------------------------------------------------------------------
 * HOW IT KNOWS
 *
 * There is no migration history table here — migrations are pasted into the
 * SQL editor by hand, so nothing records what ran. Instead every migration
 * declares one object that proves it ran, and this probes the live database
 * for it through PostgREST with the anon key the app already uses. No
 * service-role key, no database password: existence is visible through RLS
 * even when the rows are not.
 *
 *   -- @sentinel: table accounts
 *   -- @sentinel: column transactions.beneficiary
 *   -- @sentinel: deferred <why, and when it should run>
 *   -- @sentinel: unprobeable <why>
 *
 * A migration with no marker is an error. That is deliberate: the check is
 * only worth having if it cannot quietly stop covering new files, and the
 * cost of the rule is one line per migration.
 *
 * Objects that a LATER migration drops are handled automatically — the
 * expectation flips from present to absent — so retiring a table does not
 * require anyone to remember to edit the marker of the migration that created
 * it. A `deferred` migration does not flip anything, because it has not run.
 *
 * ---------------------------------------------------------------------------
 * WHEN THE CONFIG IS MISSING, THIS FAILS
 *
 * No URL or key means the check refuses, rather than passing. A guard whose
 * predicate reads unset configuration and concludes "fine" is worse than no
 * guard: it is most permissive exactly where it is least configured, which is
 * the environment least likely to have been migrated. Opt out explicitly with
 * SKIP_MIGRATION_CHECK=1 and it says so in the log.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'supabase', 'migrations');

const RED = (s) => `\x1b[31m${s}\x1b[0m`;
const GREEN = (s) => `\x1b[32m${s}\x1b[0m`;
const DIM = (s) => `\x1b[2m${s}\x1b[0m`;
const YELLOW = (s) => `\x1b[33m${s}\x1b[0m`;

function loadEnv() {
  // Vercel injects these; locally they live in .env.local, which next reads
  // and node does not.
  for (const file of ['.env.local', '.env']) {
    try {
      const text = readFileSync(join(DIR, '..', '..', file), 'utf8');
      for (const line of text.split('\n')) {
        const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
        if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
      }
    } catch {
      /* absent is normal */
    }
  }
}

/** Every migration, in the order they are meant to run. */
function migrations() {
  return readdirSync(DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((file) => ({ file, text: readFileSync(join(DIR, file), 'utf8') }));
}

function parseSentinel(text) {
  const m = /--\s*@sentinel:\s*(\S+)\s*(.*)/.exec(text);
  if (!m) return null;
  const [, kind, rest] = m;
  if (kind === 'table') return { kind, table: rest.trim(), label: `table ${rest.trim()}` };
  if (kind === 'column') {
    const [table, column] = rest.trim().split('.');
    return { kind, table, column, label: `column ${table}.${column}` };
  }
  if (kind === 'deferred' || kind === 'unprobeable')
    return { kind, note: rest.trim(), label: kind };
  return null;
}

/**
 * Objects that a later migration removes, so a sentinel can be expected to be
 * ABSENT once its remover has run. Deferred migrations remove nothing yet.
 */
function droppedBy(all) {
  const dropped = new Map(); // "table x" | "column t.c" -> file
  for (const { file, text, sentinel } of all) {
    if (sentinel?.kind === 'deferred') continue;
    for (const m of text.matchAll(/DROP TABLE (?:IF EXISTS )?(\w+)/g))
      dropped.set(`table ${m[1]}`, file);
    for (const m of text.matchAll(/ALTER TABLE (\w+)([\s\S]*?);/g)) {
      for (const c of m[2].matchAll(/DROP COLUMN (?:IF EXISTS )?(\w+)/g))
        dropped.set(`column ${m[1]}.${c[1]}`, file);
    }
  }
  return dropped;
}

async function probe(url, key, sentinel) {
  const select = sentinel.kind === 'column' ? sentinel.column : '*';
  const res = await fetch(
    `${url}/rest/v1/${sentinel.table}?select=${encodeURIComponent(select)}&limit=0`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } }
  );

  if (res.ok) return { present: true };

  let body = {};
  try {
    body = await res.json();
  } catch {
    /* not json */
  }

  // The two answers that mean "not applied". Anything else is a question that
  // did not get asked, and must not be read as either answer.
  if (body.code === 'PGRST205') return { present: false };
  if (body.code === '42703') return { present: false };

  return {
    unknown: `HTTP ${res.status} ${body.code ?? ''} ${body.message ?? ''}`.trim(),
  };
}

async function main() {
  if (process.env.SKIP_MIGRATION_CHECK === '1') {
    console.log(YELLOW('migrations: check skipped (SKIP_MIGRATION_CHECK=1)'));
    return 0;
  }

  loadEnv();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    console.error(RED('migrations: cannot check — NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY are not set.'));
    console.error(
      '  Refusing rather than passing: an unconfigured environment is the one most\n' +
        '  likely to be un-migrated, and a guard that goes quiet there guards nothing.\n' +
        '  Set them, or opt out on purpose with SKIP_MIGRATION_CHECK=1.'
    );
    return 1;
  }

  const all = migrations().map((m) => ({ ...m, sentinel: parseSentinel(m.text) }));

  const undeclared = all.filter((m) => !m.sentinel);
  if (undeclared.length) {
    console.error(RED('migrations: these declare no sentinel, so nothing can verify they ran:'));
    for (const m of undeclared) console.error(`  ${m.file}`);
    console.error(
      '\n  Add one line near the top of each:\n' +
        '    -- @sentinel: table <name>            an object the migration creates\n' +
        '    -- @sentinel: column <table>.<name>\n' +
        '    -- @sentinel: deferred <why>          not meant to have run yet\n' +
        '    -- @sentinel: unprobeable <why>       nothing safe to probe over REST'
    );
    return 1;
  }

  const dropped = droppedBy(all);
  const behind = [];
  const unknown = [];
  const notes = [];

  for (const { file, sentinel } of all) {
    if (sentinel.kind === 'deferred' || sentinel.kind === 'unprobeable') {
      notes.push({ file, sentinel });
      continue;
    }

    const remover = dropped.get(sentinel.label);
    const expectPresent = !(remover && remover > file);

    const result = await probe(url, key, sentinel);
    if (result.unknown) {
      unknown.push({ file, sentinel, why: result.unknown });
      continue;
    }

    if (result.present !== expectPresent) {
      behind.push({ file, sentinel, expectPresent, remover });
    } else {
      const how = expectPresent ? sentinel.label : `${sentinel.label} (dropped by ${remover})`;
      console.log(`  ${GREEN('ok')}  ${file}  ${DIM(how)}`);
    }
  }

  for (const { file, sentinel } of notes)
    console.log(
      `  ${YELLOW('--')}  ${file}  ${DIM(`${sentinel.kind}: ${sentinel.note || 'no reason given'}`)}`
    );

  if (unknown.length) {
    console.error(RED('\nmigrations: could not determine the state of the database.'));
    for (const u of unknown) console.error(`  ${u.file}  ${u.sentinel.label}  ${u.why}`);
    console.error('  Treated as a failure — an unanswered question is not a yes.');
    return 1;
  }

  if (behind.length) {
    console.error(RED('\nmigrations: the database is not in the state this build expects.'));
    for (const b of behind) {
      if (b.expectPresent)
        console.error(
          `  ${b.file}  has not been applied — ${b.sentinel.label} does not exist.`
        );
      else
        console.error(
          `  ${b.remover}  has not been applied — ${b.sentinel.label} still exists.`
        );
    }
    console.error(
      '\n  Apply them in the Supabase SQL editor, in filename order, then build again.\n' +
        '  Shipping this deploy would put code on the internet that queries objects\n' +
        '  the database does not have.'
    );
    return 1;
  }

  console.log(GREEN(`migrations: database matches all ${all.length} files.`));
  return 0;
}

process.exit(await main());
