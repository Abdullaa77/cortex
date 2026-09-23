/**
 * The Command Centre board — stored runs in, bands out. Pure; `now` is passed.
 *
 * IT RENDERS, IT DOES NOT MEASURE. Every value here was measured by a producer
 * and stored by ops_ingest (013). This file only decides three things about
 * each value: is it fresh enough to show, which of the three states it is in
 * (a value · not tracked · restricted), and what the board as a whole says.
 *
 * THE RULES IT KEEPS (brief 2026-09-23, Scott's answers the same day):
 *
 * - A tile past its freshness budget renders STALE and does not show its last
 *   value. session_check 45 min, gitlab 30 min, waves none (each row carries
 *   its own age). 45 and not 2 h: the failure it guards — merged, deploy
 *   skipped, nobody knows — cost 13.5 hours once.
 * - Absent is never zero. "Never reported", "not tracked" and "the database
 *   did not answer" are each their own state, and none of them rolls up to
 *   green. A blank board reading as calm is the defect this exists to end.
 * - A control run (session-check --simulate-stale) never becomes live state.
 *   It is shown in its own strip, through the same check model, so the board
 *   is seen painting red from real data without ever being red for a fake
 *   reason.
 */

import type {
  Check,
  CheckState,
  GitlabPayload,
  SessionCheckPayload,
  Wave,
  WavesPayload,
} from './contract.ts';

export const BUDGET_MIN = { session_check: 45, gitlab: 30 } as const;

export interface StoredRun<P> {
  run_id: string;
  finished_at: string;
  received_at: string;
  payload: P;
}

/** Could the board ask its own database? */
export type Reach = { ok: true } | { ok: false; at: string; reason: string };

export interface BoardInput {
  reach: Reach;
  live: StoredRun<SessionCheckPayload> | null;
  control: StoredRun<SessionCheckPayload> | null;
  waves: StoredRun<WavesPayload> | null;
  gitlab: StoredRun<GitlabPayload> | null;
  /** api.health's state from every live run in the last 7 days. */
  apiSamples: { at: string; state: CheckState }[];
}

export type Tone = 'red' | 'amber' | 'green' | 'grey';

export type Freshness =
  | { state: 'never' }
  | { state: 'fresh'; at: string; ageMin: number; budgetMin: number }
  | { state: 'stale'; at: string; ageMin: number; budgetMin: number };

export interface CheckView {
  id: string;
  section: string;
  state: CheckState;
  tone: Tone;
  /** "exact" or "inferred, not measured" — from the method, never the repo name. */
  methodNote: string | null;
  line: string;
  measuredAt: string;
  values: Check['values'];
  untracked: Record<string, string>;
}

export interface WaitingItem {
  slug: string;
  title: string;
  repos: string[];
  status: Wave['status'];
  gate: Wave['gate'];
  waiting: string | null;
  truncated: boolean;
  started: string;
  ageDays: number;
  noteAgeMin: number;
  inRegistry: boolean;
}

export interface ReadyMr {
  repo: string;
  ref: string;
  title: string;
  ageDays: number;
  /** null = not tracked by the producer. */
  behind: number | null;
  needsRefresh: boolean;
  wave: string | null;
}

export interface CommitRow {
  repo: string;
  sha: string;
  title: string;
  mr: string | null;
  wave: string | null;
}

export type Tracked<T> = { tracked: true; value: T } | { tracked: false; reason: string };

export interface Board {
  reach: Reach;
  tone: Tone;
  headline: string;
  /** The one line on the home page. */
  summary: string;
  heartbeat: {
    sessionCheck: Freshness;
    gitlab: Freshness;
    waves: { at: string | null; ageMin: number | null; rows: number | null };
    control:
      | { state: 'never' }
      | { state: 'proven' | 'failed'; at: string; ageMin: number; notRed: string[] };
  };
  api: Tracked<{ health: CheckView | null; errors: CheckView | null; samples: { ok: number; total: number } }>;
  waiting: Tracked<WaitingItem[]>;
  ready: Tracked<{ mrs: ReadyMr[]; commits: CommitRow[]; commitsUntracked: { repo: string; reason: string }[] }>;
  repos: Tracked<CheckView[]>;
  controlStrip: CheckView[] | null;
}

// ---------------------------------------------------------------- small pieces

export function ageMinutes(iso: string, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - Date.parse(iso)) / 60_000));
}

export function freshness(at: string | null, budgetMin: number, now: Date): Freshness {
  if (!at) return { state: 'never' };
  const ageMin = ageMinutes(at, now);
  // Past the budget is stale; AT the budget is still fresh. 45 minutes means 45.
  return { state: ageMin > budgetMin ? 'stale' : 'fresh', at, ageMin, budgetMin };
}

export function formatAge(min: number): string {
  if (min < 60) return `${min}m`;
  if (min < 48 * 60) return `${Math.floor(min / 60)}h`;
  return `${Math.floor(min / 1440)}d`;
}

/** What a check's state means for the board. */
export function toneOf(state: CheckState): Tone {
  switch (state) {
    case 'ok':
      return 'green';
    case 'pending':
      return 'amber';
    case 'not_deployed':
      return 'grey';
    // unknown is "could not tell" — session-check's own rule: treat as drift.
    case 'drift':
    case 'red':
    case 'unknown':
      return 'red';
  }
}

export function viewCheck(c: Check): CheckView {
  return {
    id: c.id,
    section: c.section,
    state: c.state,
    tone: toneOf(c.state),
    methodNote:
      c.method === 'exact'
        ? 'exact'
        : c.method === 'timing_proxy'
          ? 'inferred, not measured'
          : null,
    line: c.line,
    measuredAt: c.measured_at,
    values: c.values,
    untracked: c.untracked ?? {},
  };
}

const worst = (tones: Tone[]): Tone =>
  tones.includes('red') ? 'red' : tones.includes('amber') ? 'amber' : tones.includes('grey') ? 'grey' : 'green';

// ---------------------------------------------------------------- the rollup

/**
 * The board's verdict from one run's checks and how fresh that run is.
 *
 * Kept apart from run selection ON PURPOSE, so it can be fed a control run's
 * checks directly: the check strip proves the component paints red, this
 * proves the verdict and the home line do. (Scott, 2026-09-23.)
 */
export function rollup(input: {
  checks: Check[] | null;
  fresh: Freshness;
  waitingCount: number | null;
  reach: Reach;
}): { tone: Tone; headline: string; summary: string } {
  const waitingPart =
    input.waitingCount === null ? 'waiting: not tracked' : `${input.waitingCount} waiting on you`;

  if (!input.reach.ok)
    return {
      tone: 'red',
      headline: 'DATABASE UNREACHABLE — nothing below is current',
      summary: `ops: database unreachable · ${input.reach.reason}`,
    };

  if (input.fresh.state === 'never' || input.checks === null)
    return {
      tone: 'red',
      headline: 'NO SESSION-CHECK HAS EVER REPORTED',
      summary: `${waitingPart} · prod: never measured`,
    };

  const measured = `measured ${formatAge(input.fresh.ageMin)} ago`;
  if (input.fresh.state === 'stale')
    return {
      tone: 'amber',
      headline: `STALE — session-check last reported ${formatAge(input.fresh.ageMin)} ago (budget ${input.fresh.budgetMin}m)`,
      summary: `${waitingPart} · prod STALE · ${measured}`,
    };

  const bad = input.checks.filter((c) => toneOf(c.state) === 'red');
  const pending = input.checks.filter((c) => toneOf(c.state) === 'amber');
  const names = (cs: Check[]) => cs.map((c) => c.id.replace(/^drift\./, '')).join(', ');

  if (bad.length)
    return {
      tone: 'red',
      headline: `RED — ${names(bad)}`,
      summary: `${waitingPart} · prod RED: ${names(bad)} · ${measured}`,
    };
  if (pending.length)
    return {
      tone: 'amber',
      headline: `PENDING — ${names(pending)}`,
      summary: `${waitingPart} · prod pending: ${names(pending)} · ${measured}`,
    };
  return { tone: 'green', headline: 'ALL CLEAR', summary: `${waitingPart} · prod clean · ${measured}` };
}

// ---------------------------------------------------------------- bands

export function isWaiting(w: Wave): boolean {
  return w.gate !== 'none' || w.status === 'blocked' || w.waiting_on_scott !== undefined;
}

function daysBetween(day: string, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - Date.parse(`${day}T00:00:00Z`)) / 86_400_000));
}

/** Oldest first: the wait that has rotted longest is the one to read first. */
export function waitingBand(waves: Wave[], now: Date): WaitingItem[] {
  return waves
    .filter(isWaiting)
    .map((w) => ({
      slug: w.slug,
      title: w.title,
      repos: w.repos,
      status: w.status,
      gate: w.gate,
      waiting: w.waiting_on_scott ?? null,
      truncated: w.waiting_on_scott_truncated === true,
      started: w.started,
      ageDays: daysBetween(w.started, now),
      noteAgeMin: ageMinutes(w.note_mtime, now),
      inRegistry: w.in_registry,
    }))
    .sort((a, b) => a.started.localeCompare(b.started) || a.slug.localeCompare(b.slug));
}

/** repo!iid → wave slug, and repo@sha-prefix → wave slug. The join lives here, not in the producer. */
function waveIndex(waves: Wave[]) {
  const byMr = new Map<string, string>();
  const shas: { repo: string; prefix: string; slug: string }[] = [];
  for (const w of waves) {
    for (const mr of w.mrs) if (!byMr.has(mr)) byMr.set(mr, w.slug);
    for (const s of w.shas) {
      const at = s.indexOf('@');
      shas.push({ repo: s.slice(0, at), prefix: s.slice(at + 1).toLowerCase(), slug: w.slug });
    }
  }
  return {
    mr: (ref: string | undefined) => (ref ? byMr.get(ref) ?? null : null),
    sha: (repo: string, sha: string) =>
      shas.find((x) => x.repo === repo && sha.toLowerCase().startsWith(x.prefix))?.slug ?? null,
  };
}

export function readyBand(gitlab: GitlabPayload, waves: Wave[], now: Date) {
  const idx = waveIndex(waves);
  const mrs: ReadyMr[] = [];
  const commits: CommitRow[] = [];
  const commitsUntracked: { repo: string; reason: string }[] = [];

  for (const r of gitlab.repos) {
    for (const m of r.open_mrs) {
      // "Green draft MRs": the batch is drafts that passed, waiting for the evening merge.
      if (!m.draft || m.pipeline_status !== 'success') continue;
      const behind = m.behind_default_by ?? null;
      mrs.push({
        repo: r.repo,
        ref: m.ref,
        title: m.title,
        ageDays: Math.floor(ageMinutes(m.updated_at, now) / 1440),
        behind,
        needsRefresh: behind !== null && behind > 0,
        wave: idx.mr(m.ref),
      });
    }
    if (r.commits_prod_to_head === undefined)
      commitsUntracked.push({
        repo: r.repo,
        reason: r.untracked?.commits_prod_to_head ?? r.untracked?.prod_sha ?? 'prod SHA unknown',
      });
    else
      for (const c of r.commits_prod_to_head)
        commits.push({
          repo: r.repo,
          sha: c.sha,
          title: c.title,
          mr: c.mr ?? null,
          wave: idx.mr(c.mr) ?? idx.sha(r.repo, c.sha),
        });
  }
  // Persistent and oldest first — a branch green for three days is the one rotting.
  mrs.sort((a, b) => b.ageDays - a.ageDays || a.ref.localeCompare(b.ref));
  return { mrs, commits, commitsUntracked };
}

// ---------------------------------------------------------------- the board

export function boardState(input: BoardInput, now: Date): Board {
  const sc = freshness(input.live?.finished_at ?? null, BUDGET_MIN.session_check, now);
  const gl = freshness(input.gitlab?.finished_at ?? null, BUDGET_MIN.gitlab, now);
  const waveRows = input.waves?.payload.waves ?? null;

  const waiting: Board['waiting'] = waveRows
    ? { tracked: true, value: waitingBand(waveRows, now) }
    : { tracked: false, reason: 'no waves snapshot has ever arrived' };

  const liveChecks = input.live?.payload.checks ?? null;
  const verdict = rollup({
    checks: liveChecks,
    fresh: sc,
    waitingCount: waiting.tracked ? waiting.value.length : null,
    reach: input.reach,
  });

  // Past budget, the values are withheld — STALE never shows the last value.
  const repos: Board['repos'] =
    sc.state === 'never'
      ? { tracked: false, reason: 'no live session-check has ever reported' }
      : sc.state === 'stale'
        ? { tracked: false, reason: `STALE — last measured ${formatAge(sc.ageMin)} ago` }
        : { tracked: true, value: liveChecks!.filter((c) => !c.id.startsWith('api.')).map(viewCheck) };

  const apiHealth = liveChecks?.find((c) => c.id === 'api.health');
  const apiErrors = liveChecks?.find((c) => c.id === 'api.errors');
  const api: Board['api'] =
    sc.state === 'never'
      ? { tracked: false, reason: 'no live session-check has ever reported' }
      : sc.state === 'stale'
        ? { tracked: false, reason: `STALE — last measured ${formatAge(sc.ageMin)} ago` }
        : !apiHealth && !apiErrors
          ? { tracked: false, reason: 'session-check does not probe the API yet' }
          : {
              tracked: true,
              value: {
                health: apiHealth ? viewCheck(apiHealth) : null,
                errors: apiErrors ? viewCheck(apiErrors) : null,
                samples: {
                  ok: input.apiSamples.filter((s) => s.state === 'ok').length,
                  total: input.apiSamples.length,
                },
              },
            };

  const ready: Board['ready'] =
    gl.state === 'never'
      ? { tracked: false, reason: 'no GitLab producer yet — Session B builds it next' }
      : gl.state === 'stale'
        ? { tracked: false, reason: `STALE — GitLab last read ${formatAge(gl.ageMin)} ago (budget ${gl.budgetMin}m)` }
        : { tracked: true, value: readyBand(input.gitlab!.payload, waveRows ?? [], now) };

  const ctl = input.control;
  const control: Board['heartbeat']['control'] = !ctl
    ? { state: 'never' }
    : {
        state:
          ctl.payload.control?.observed_all_red === true && (ctl.payload.control?.not_red.length ?? 1) === 0
            ? 'proven'
            : 'failed',
        at: ctl.finished_at,
        ageMin: ageMinutes(ctl.finished_at, now),
        notRed: ctl.payload.control?.not_red ?? [],
      };

  // A red heartbeat outranks a green verdict: a control that failed to go red
  // means the checks above cannot be trusted to.
  const tone = control.state === 'failed' ? worst([verdict.tone, 'red']) : verdict.tone;
  const headline =
    control.state === 'failed' && verdict.tone !== 'red'
      ? `NEGATIVE CONTROL FAILED — ${control.notRed.join(', ') || 'control block missing'} did not go red`
      : verdict.headline;

  return {
    reach: input.reach,
    tone,
    headline,
    summary: verdict.summary,
    heartbeat: {
      sessionCheck: sc,
      gitlab: gl,
      waves: input.waves
        ? { at: input.waves.finished_at, ageMin: ageMinutes(input.waves.finished_at, now), rows: waveRows!.length }
        : { at: null, ageMin: null, rows: null },
      control,
    },
    api,
    waiting,
    ready,
    repos,
    controlStrip: ctl ? ctl.payload.checks.map(viewCheck) : null,
  };
}
