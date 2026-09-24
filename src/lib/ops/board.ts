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
  IntentRequestPayload,
  Decision,
  IntentStatus,
  SessionCheckPayload,
  StoredAnswer,
  StoredPark,
  WaitState,
  Wave,
  WavesPayload,
} from './contract.ts';
import { DECISIONS } from './contract.ts';

export const BUDGET_MIN = { session_check: 45, gitlab: 30 } as const;

/** Intents band 3 shows: newest first, over this window, capped at this many rows. */
export const INTENTS_WINDOW_MS = 24 * 60 * 60 * 1000;
export const INTENTS_CAP = 50;

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
  /**
   * Raw intent_request runs the caller fetched (a superset of the window is
   * fine — this file does its own 24h filter, ordering and cap, so it is the
   * one place that decision is testable without a database).
   */
  intents: StoredRun<IntentRequestPayload>[];
  /**
   * ops_intents rows (015) the caller fetched; joined to `intents` by run_id.
   * A run with no row here is WAITING — the state is derived, not stored.
   */
  answers: StoredAnswer[];
  /** ops_intent_parks rows (017), joined by run_id. */
  parks: StoredPark[];
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
  /**
   * True whenever status is 'parked', regardless of gate. A parked wave with
   * gate 'none' still renders "parked" as its status label (gate !== 'none'
   * ? gate : status falls through to status) and must show this badge too —
   * the badge is separate information from the gate, not conditional on one
   * being shown alongside it (D7 bug, imcoin-d7-affordability-report,
   * 2026-09-24: gate 'none' wrongly suppressed the badge).
   */
  parkedBadge: boolean;
  /** The note's human-readable one-liner. Slug stays visible regardless. */
  scope: string | null;
  scopeTruncated: boolean;
  /** null = the claims directory could not be read (absent, not "unclaimed"). */
  claimed: boolean | null;
  /** Display only — NEVER the staleness test (contract 2026-09-24, f2d746d). null when claimed isn't true, or the age wasn't sent. */
  claimedAgeSeconds: number | null;
  /**
   * null exactly when claimed !== true. Judged against render time vs
   * lease_expires_at, never against age — a `--ttl 12` claim is live at 5h.
   * 'unknown' (never "stale", never "live") when claimed=true but
   * lease_expires_at was not sent.
   */
  leaseStatus: 'live' | 'stale' | 'unknown' | null;
  /** null = not tracked (no MRs, or an MR's state is unknown/uncached). */
  shippable: boolean | null;
  shippableCheckedAgeMin: number | null;
}

/** Scott's answer to one band-3 row, as far as Cortex knows it. */
export interface IntentAnswerView {
  decision: Decision;
  decisionWords: string;
  text: string;
  answeredAgeMin: number;
  /**
   * pending = answered here, not yet delivered; applied = the daemon saw the
   * session record it (write-witness); parked = §4, the session parked first.
   */
  status: IntentStatus;
  appliedAgeMin: number | null;
}

export interface IntentItem {
  /** The intent_request run — what an answer is attached to. */
  runId: string;
  sessionId: string;
  trigger: 'permission_request' | 'notification';
  /**
   * Decided by the hook at emit time (contract §5b, 2026-09-24). A row stored
   * before that amendment carries no wait_state; deriveWaitState below fills
   * it in from trigger/notification_type. This is what splits band 3 into
   * "Blocked — needs your answer" and "Idle — close or feed" — an idle row
   * must never land in the blocked group.
   */
  waitState: WaitState;
  /**
   * permission_request only. The tool name is always present when trigger is
   * permission_request (contract requires it); `action` is null exactly when
   * the hook could not project one for that tool — render the "not
   * projected" copy then, never a blank line.
   */
  toolName: string | null;
  action: string | null;
  /** True when `action` is exactly ACTION_WITHHELD — render as a plain muted notice, never monospace-as-a-command. */
  actionWithheld: boolean;
  /** permission_request only. The model's own words, shown BESIDE the action, never instead of it. */
  description: string | null;
  /** notification only. The type in words — a known mapping, or the raw value, or "not tracked". */
  notificationWords: string | null;
  /** Shown when present, on either trigger. */
  question: string | null;
  repo: string;
  askedAt: string;
  ageMin: number;
  /**
   * Whether this row can take an answer here. A permission prompt cannot: the
   * daemon's only channel is the session's messaging socket, which injects a
   * user turn and does not click a dialog (ops_intent_answer refuses it too).
   */
  answerable: { ok: true } | { ok: false; reason: string };
  /** null = waiting — nobody has answered it on Cortex. */
  answer: IntentAnswerView | null;
  /**
   * 017: minutes since the session was told to park (60 min unanswered, and
   * its transcript shows the message). null = not parked. An answer to a
   * parked question goes to the wave note, not the session.
   */
  parkedAgeMin: number | null;
}

export interface IntentsBand {
  /** BLOCKED = permission_request, or notification with agent_needs_input|elicitation_dialog. */
  blocked: IntentItem[];
  /** IDLE = notification idle_prompt only. Never mixed into `blocked`. */
  idle: IntentItem[];
  /** How many more matched the 24h window beyond the combined cap. 0 when none. */
  moreCount: number;
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
  /**
   * "Blocked sessions" — band 3, adjacent to Waiting on you. A count of real
   * events in a time window, so an empty list here is a measured zero (no
   * session blocked in 24h), not an absent signal.
   */
  intents: IntentsBand;
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
    .map((w) => {
      const claimed = w.claimed ?? null;
      // claimed_age_seconds / lease_expires_at are only ever meaningful when
      // claimed=true — the validator forbids them otherwise, but this stays
      // defensive either way.
      const claimedAgeSeconds = claimed === true ? (w.claimed_age_seconds ?? null) : null;
      const leaseStatus: WaitingItem['leaseStatus'] =
        claimed !== true
          ? null
          : w.lease_expires_at === undefined
            ? 'unknown'
            : now.getTime() >= Date.parse(w.lease_expires_at)
              ? 'stale'
              : 'live';
      const shippable = w.shippable ?? null;
      return {
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
        parkedBadge: w.status === 'parked',
        scope: w.scope ?? null,
        scopeTruncated: w.scope_truncated === true,
        claimed,
        claimedAgeSeconds,
        leaseStatus,
        shippable,
        shippableCheckedAgeMin: shippable === true && w.shippable_checked_at ? ageMinutes(w.shippable_checked_at, now) : null,
      };
    })
    .sort((a, b) => a.started.localeCompare(b.started) || a.slug.localeCompare(b.slug));
}

/**
 * Band 3's "Blocked sessions" list. Newest first (by when the hook fired,
 * `asked_at` — the domain event, not the envelope's own finished_at), over a
 * rolling 24h window, capped at INTENTS_CAP with the overflow counted, not
 * dropped silently.
 */
/**
 * Known Notification matcher values (CORTEX-INTENTS §9.1 delta, aeb9adf) in
 * words. An unknown type must not 422 (contract: "a new Claude Code type
 * must not 422"), so one outside this map renders as its raw value rather
 * than disappearing.
 */
const NOTIFICATION_WORDS: Record<string, string> = {
  idle_prompt: 'idle — waiting for input',
  agent_needs_input: 'needs input',
  elicitation_dialog: 'elicitation',
};

/**
 * Contract 2026-09-24 (f2d746d, Scott): credential-shaped Bash commands and
 * descriptions are withheld WHOLE, never masked — no part of the command is
 * sent. These are the exact producer-side sentinel strings; the board's only
 * job is to not style one as a command.
 */
export const ACTION_WITHHELD = '<command withheld — may contain a credential>';
export const DESCRIPTION_WITHHELD = '<description withheld — may contain a credential>';

/**
 * Rows stored before the 2026-09-24 wait_state amendment carry no wait_state
 * at all: derive it from the fields that did exist then. idle_prompt is the
 * only IDLE trigger; a permission_request, any other notification_type, or
 * no notification_type at all, is BLOCKED (contract §5b: BLOCKED = something
 * waits on an answer; IDLE = notification idle_prompt only, turn finished).
 */
export function deriveWaitState(p: IntentRequestPayload): WaitState {
  if (p.wait_state) return p.wait_state;
  return p.trigger === 'notification' && p.notification_type === 'idle_prompt' ? 'idle' : 'blocked';
}

export const NOT_ANSWERABLE_PERMISSION = 'permission prompt — answer it in the terminal; the socket cannot click a dialog';

function viewAnswer(a: StoredAnswer, now: Date): IntentAnswerView {
  return {
    decision: a.decision,
    decisionWords: DECISIONS.find((d) => d.value === a.decision)?.words ?? a.decision,
    text: a.answer,
    answeredAgeMin: ageMinutes(a.answered_at, now),
    status: a.status,
    appliedAgeMin: a.applied_at ? ageMinutes(a.applied_at, now) : null,
  };
}

export function intentsBand(
  runs: StoredRun<IntentRequestPayload>[],
  now: Date,
  answers: StoredAnswer[] = [],
  parks: StoredPark[] = []
): IntentsBand {
  const byRun = new Map(answers.map((a) => [a.run_id, a]));
  const parkedAt = new Map(parks.map((k) => [k.run_id, k.parked_at]));
  const inWindow = runs.filter((r) => now.getTime() - Date.parse(r.payload.asked_at) <= INTENTS_WINDOW_MS);
  inWindow.sort((a, b) => Date.parse(b.payload.asked_at) - Date.parse(a.payload.asked_at));
  const capped = inWindow.slice(0, INTENTS_CAP);
  const items = capped.map((r) => {
    const p = r.payload;
    const isPermission = p.trigger === 'permission_request';
    const action = isPermission ? (p.action ?? null) : null;
    const stored = byRun.get(r.run_id);
    return {
      runId: r.run_id,
      sessionId: p.session_id,
      trigger: p.trigger,
      waitState: deriveWaitState(p),
      toolName: isPermission ? (p.tool_name ?? null) : null,
      action,
      actionWithheld: action === ACTION_WITHHELD,
      description: isPermission ? (p.description ?? null) : null,
      notificationWords: isPermission ? null : (p.notification_type && (NOTIFICATION_WORDS[p.notification_type] ?? p.notification_type)) || 'not tracked',
      question: p.question ?? null,
      repo: p.repo ?? 'repo not tracked',
      askedAt: p.asked_at,
      ageMin: ageMinutes(p.asked_at, now),
      answerable: isPermission ? { ok: false as const, reason: NOT_ANSWERABLE_PERMISSION } : { ok: true as const },
      answer: stored ? viewAnswer(stored, now) : null,
      parkedAgeMin: parkedAt.has(r.run_id) ? ageMinutes(parkedAt.get(r.run_id)!, now) : null,
    };
  });
  return {
    blocked: items.filter((i) => i.waitState === 'blocked'),
    idle: items.filter((i) => i.waitState === 'idle'),
    moreCount: Math.max(0, inWindow.length - items.length),
  };
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
    intents: intentsBand(input.intents, now, input.answers, input.parks),
  };
}
