/**
 * The Jobs screen (/ops, map lead-and-workers, ticket lw-5) — a pure view.
 *
 * One top line (prod · next train · waiting on you), one card per Job, Solo
 * sessions as one line each. Nothing on it is clickable: Scott manages from
 * the terminal or the Claude mobile app (2026-10-15). Same pattern as
 * board.ts: the caller fetches, this decides, so every rule below is unit
 * tested without a database.
 */
import type { IntentRequestPayload, JobStatus, JobStatusPayload, JobWorker, SessionCheckPayload, StoredResolution, GitlabPayload } from './contract.ts';
import {
  ageMinutes,
  BUDGET_MIN,
  formatAge,
  freshness,
  INTENTS_WINDOW_MS,
  rollup,
  STOP_WORDS,
  type Reach,
  type StoredRun,
  type Tone,
} from './board.ts';

/** A building Job with no update for longer than this is stale — never shown as working. */
export const STALE_MIN = 30;
/** A shipped Job leaves the screen this long after its last update. */
export const SHIPPED_STAYS_MS = 24 * 60 * 60 * 1000;
/** Train departures, UTC "HH:MM" (13:00 and 19:00 Tashkent — release-batch.md). Config, not logic. */
export const TRAIN_TIMES_UTC = ['08:00', '14:00'] as const;
/** Tashkent is UTC+5 all year (no DST). */
const TASHKENT_OFFSET_MIN = 5 * 60;

export interface JobsInput {
  reach: Reach;
  live: StoredRun<SessionCheckPayload> | null;
  gitlab: StoredRun<GitlabPayload> | null;
  /** job_status runs, any number per Job — the latest wins here. */
  jobs: StoredRun<JobStatusPayload>[];
  /** intent_request runs (a superset of the 24 h window is fine). */
  intents: StoredRun<IntentRequestPayload>[];
  resolutions: StoredResolution[];
}

export type CardState = JobStatus | 'stale';

export interface JobCard {
  job: string;
  lead: string;
  state: CardState;
  /** The status in words, as the pill shows it. */
  words: string;
  tone: Tone;
  /** null = no summary yet; the card says so rather than inventing one. */
  summary: string | null;
  summaryBy: 'lead' | 'auto' | null;
  waiting: string | null;
  workers: JobWorker[];
  tickets: { done: number; left: number };
  acceptance: { ticked: number; total: number } | null;
  relays: number;
  ageMin: number;
}

export interface SoloLine {
  /** session_id — a React key, never shown. */
  key: string;
  name: string | null;
  repo: string | null;
  line: string;
  /** Blocked on Scott (a permission prompt, a question) — not merely idle. Counted in the top line. */
  blocked: boolean;
  ageMin: number;
}

export interface JobsScreen {
  top: { tone: Tone; prod: string; measured: string | null; train: string; waiting: number };
  jobs: JobCard[];
  solo: SoloLine[];
}

const ORDER: CardState[] = ['waiting_on_you', 'building', 'stale', 'queued', 'idle', 'shipped'];

const TONE: Record<CardState, Tone> = {
  waiting_on_you: 'amber',
  building: 'green',
  stale: 'red',
  queued: 'green',
  idle: 'grey',
  shipped: 'grey',
};

const WORDS: Record<JobStatus, string> = {
  waiting_on_you: 'waiting on you',
  building: 'building',
  queued: 'queued',
  idle: 'idle',
  shipped: 'shipped',
};

// ---------------------------------------------------------------- top line

/** "13:00", "19:00" or "tomorrow 13:00" — Tashkent wall clock, Tashkent's "today". */
export function nextTrain(now: Date): string {
  const local = new Date(now.getTime() + TASHKENT_OFFSET_MIN * 60_000);
  const nowMin = local.getUTCHours() * 60 + local.getUTCMinutes();
  const times = TRAIN_TIMES_UTC.map((t) => {
    const [h, m] = t.split(':').map(Number);
    return (h * 60 + m + TASHKENT_OFFSET_MIN) % (24 * 60);
  }).sort((a, b) => a - b);
  const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
  const today = times.find((t) => t > nowMin);
  return today !== undefined ? hhmm(today) : `tomorrow ${hhmm(times[0])}`;
}

function queuedCount(gitlab: StoredRun<GitlabPayload> | null): number | null {
  if (!gitlab) return null;
  let n = 0;
  for (const r of gitlab.payload.repos) for (const m of r.open_mrs ?? []) if (m.release_queue === true) n++;
  return n;
}

function topLine(input: JobsInput, jobs: JobCard[], solo: SoloLine[], now: Date): JobsScreen['top'] {
  const fresh = freshness(input.live?.finished_at ?? null, BUDGET_MIN.session_check, now);
  const r = rollup({ checks: input.live?.payload.checks ?? null, fresh, waitingCount: null, reach: input.reach });
  const queued = queuedCount(input.gitlab);
  return {
    tone: r.tone,
    prod: r.tone === 'green' ? 'prod OK' : r.headline,
    measured: fresh.state === 'never' || !input.reach.ok ? null : `measured ${formatAge(fresh.ageMin)} ago`,
    train: `next train ${nextTrain(now)} · ${queued === null ? 'queue not read' : `${queued} queued`}`,
    waiting: jobs.filter((j) => j.state === 'waiting_on_you').length + solo.filter((l) => l.blocked).length,
  };
}

// ---------------------------------------------------------------- Job cards

function card(p: JobStatusPayload, now: Date): JobCard {
  const ageMin = ageMinutes(p.updated_at, now);
  const state: CardState = p.status === 'building' && ageMin > STALE_MIN ? 'stale' : p.status;
  return {
    job: p.job,
    lead: p.lead,
    state,
    words: state === 'stale' ? `stale ${formatAge(ageMin)} — no update` : WORDS[state],
    tone: TONE[state],
    summary: p.summary ?? null,
    summaryBy: p.summary_by ?? null,
    waiting: p.waiting_on_you ?? null,
    workers: p.workers,
    tickets: p.tickets,
    acceptance: p.acceptance ?? null,
    relays: p.relays,
    ageMin,
  };
}

function latestPerJob(runs: StoredRun<JobStatusPayload>[]): JobStatusPayload[] {
  const by = new Map<string, JobStatusPayload>();
  for (const r of runs) {
    const have = by.get(r.payload.job);
    if (!have || Date.parse(r.payload.updated_at) > Date.parse(have.updated_at)) by.set(r.payload.job, r.payload);
  }
  return [...by.values()];
}

// ---------------------------------------------------------------- Solo lines

function soloLine(p: IntentRequestPayload): string {
  if (p.question) return p.question;
  if (p.trigger === 'permission_request') return `permission: ${[p.tool_name, p.action].filter(Boolean).join(' — ') || 'a tool'}`;
  if (p.trigger === 'notification') return p.notification_type ? `needs input: ${p.notification_type}` : 'needs input';
  return STOP_WORDS;
}

function soloLines(input: JobsInput, jobs: JobStatusPayload[], now: Date): SoloLine[] {
  const resolved = new Set(input.resolutions.map((r) => r.run_id));
  // Sessions of a Job, by name: an intent from a producer older than the `job`
  // field still must not show a Lead or Worker as Solo.
  const jobNames = new Set(jobs.flatMap((j) => [j.lead, ...j.workers.map((w) => w.name)]));
  const latest = new Map<string, StoredRun<IntentRequestPayload>>();
  for (const r of input.intents) {
    const at = Date.parse(r.payload.asked_at);
    if (now.getTime() - at > INTENTS_WINDOW_MS) continue;
    const have = latest.get(r.payload.session_id);
    if (!have || at > Date.parse(have.payload.asked_at)) latest.set(r.payload.session_id, r);
  }
  return [...latest.values()]
    .filter((r) => !resolved.has(r.run_id))
    .filter((r) => r.payload.job === undefined && !(r.payload.session_name && jobNames.has(r.payload.session_name)))
    .sort((a, b) => Date.parse(b.payload.asked_at) - Date.parse(a.payload.asked_at))
    .map((r) => ({
      key: r.payload.session_id,
      name: r.payload.session_name ?? null,
      repo: r.payload.repo ?? null,
      line: soloLine(r.payload),
      blocked: r.payload.wait_state === 'blocked',
      ageMin: ageMinutes(r.payload.asked_at, now),
    }));
}

// ---------------------------------------------------------------- the screen

export function jobsScreen(input: JobsInput, now: Date): JobsScreen {
  const all = latestPerJob(input.jobs);
  const jobs = all
    .filter((p) => !(p.status === 'shipped' && now.getTime() - Date.parse(p.updated_at) > SHIPPED_STAYS_MS))
    .map((p) => card(p, now))
    .sort((a, b) => ORDER.indexOf(a.state) - ORDER.indexOf(b.state) || a.ageMin - b.ageMin);
  // Every Job fetched, not only those on screen: a session left open after its
  // Job's card aged out is still that Job's, never Solo.
  const solo = soloLines(input, all, now);
  return { top: topLine(input, jobs, solo, now), jobs, solo };
}
