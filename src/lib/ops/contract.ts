/**
 * The ingest contract, v1, as code.
 *
 * Source of truth: Brain/04-Claude/Handoffs/2026-09-23-command-centre-ingest-contract.md.
 * Session B's producers are built against that file; this validator is built
 * against it too, and a disagreement between the two is a bug in whichever
 * side drifted from the document.
 *
 * STRICT, AND IT LISTS EVERY PROBLEM. An unknown key is an error, not ignored:
 * that is the security boundary — a note body cannot slip in under a new name.
 * And a 422 that names only the first problem costs the producer one round
 * trip per mistake, so every path that is wrong is reported at once.
 *
 * THE THREE-STATE RULE. A value is present, or its key is absent (not
 * tracked; the reason goes in `untracked`). `null` is refused everywhere,
 * because null-for-unknown is how a missing measurement turns into a 0 on a
 * screen.
 *
 * The database re-checks the security invariants itself (013), because a
 * token holder can call the RPC without coming through here.
 */

export const CONTRACT_VERSION = 1;
export const MAX_BODY_BYTES = 256 * 1024;
export const WAITING_CAP = 240;

export type Kind = 'session_check' | 'waves' | 'gitlab' | 'intent_request';
export type CheckState = 'ok' | 'drift' | 'pending' | 'red' | 'unknown' | 'not_deployed';
export type CheckMethod = 'exact' | 'timing_proxy' | 'query' | 'heartbeat' | 'probe';
/**
 * §5b, 2026-09-24 amendment. Decided by the hook at emit time, never
 * recomputed here: BLOCKED = trigger permission_request, or notification
 * with notification_type agent_needs_input|elicitation_dialog (something
 * waits on an answer). IDLE = notification idle_prompt only (turn finished,
 * nothing waiting). Required on every new intent_request — rows stored
 * before this amendment have no wait_state; the board derives it from the
 * stored trigger/notification_type for those (see board.ts).
 */
export type WaitState = 'blocked' | 'idle';

export interface CheckValues {
  head_sha?: string;
  head_merged_at?: string;
  live_sha?: string;
  live_deployed_at?: string;
  behind_minutes?: number;
  pipeline?: string;
  count?: number;
  http_status?: number;
  latency_ms?: number;
  window_minutes?: number;
  requests?: number;
  errors_5xx?: number;
  /** Control runs only: the 4xx count --simulate-stale substitutes, under its own name. */
  errors_4xx?: number;
}

export interface Check {
  id: string;
  section: string;
  state: CheckState;
  method: CheckMethod;
  method_label?: 'exact' | 'timing';
  line: string;
  measured_at: string;
  values?: CheckValues;
  untracked?: Record<string, string>;
}

export interface SessionCheckPayload {
  mode: 'live' | 'control';
  exit_code: 0 | 1 | 2;
  verdict: string;
  checks: Check[];
  control?: { expected: 'all_red'; observed_all_red: boolean; not_red: string[] };
}

export interface Wave {
  slug: string;
  title: string;
  /** Omitted when the note records none (older notes). */
  family?: string;
  repos: string[];
  /** Omitted when the note records none — absent, not "". */
  branch?: string;
  status: 'planned' | 'in-flight' | 'blocked' | 'shipped' | 'parked';
  /** The note's frontmatter `scope`, ≤ 240 chars. Omitted when the note has none — never "". */
  scope?: string;
  scope_truncated?: true;
  gate: 'none' | 'awaiting-confirm' | 'do-not-run' | 'idle-no-writes';
  blocked_by: string[];
  waiting_on_scott?: string;
  waiting_on_scott_truncated?: true;
  started: string;
  shipped_on?: string;
  reviewed_on?: string;
  mrs: string[];
  shas: string[];
  issues: string[];
  note_mtime: string;
  in_registry: boolean;
  /**
   * A claim file exists (live OR lapsed lease). Omitted only when the claims
   * directory could not be read — never the holder's name.
   */
  claimed?: boolean;
  /**
   * Contract prose: "REQUIRED when claimed=true and the claim is readable;
   * FORBIDDEN otherwise." The envelope carries no separate "readable" flag,
   * so this validator checks the half it can actually observe: FORBIDDEN
   * when claimed is not true, and merely OPTIONAL (not required) when
   * claimed=true — a producer that read claimed=true but failed to read the
   * claim's timestamp is not a schema violation.
   */
  claimed_age_seconds?: number;
  /**
   * Same observable-half rule as claimed_age_seconds: FORBIDDEN when claimed
   * is not true, optional when claimed=true. The claim's own `expiresAt`,
   * verbatim. THIS is the staleness test — age alone cannot judge it, since a
   * `--ttl 12` claim is still live at 5h. claimed_age_seconds stays display-only.
   */
  lease_expires_at?: string;
  /** Registry rows with ≥1 MR only. Omitted when there are no MRs, or any MR's state is unknown/uncached. */
  shippable?: boolean;
  /** REQUIRED iff `shippable` is present (whatever its value). */
  shippable_checked_at?: string;
}

export interface WavesPayload {
  registry_commit?: string;
  waves: Wave[];
}

export interface GitlabCommit {
  sha: string;
  title: string;
  authored_at: string;
  mr?: string;
}

export interface GitlabMr {
  ref: string;
  title: string;
  draft: boolean;
  source_branch: string;
  sha: string;
  /** Omitted when the MR's current sha has no pipeline. */
  pipeline_status?: 'success' | 'failed' | 'running' | 'pending' | 'canceled' | 'skipped' | 'manual';
  behind_default_by?: number;
  updated_at: string;
  untracked?: Record<string, string>;
}

export interface GitlabRepo {
  repo: string;
  project_path: string;
  default_branch: string;
  head_sha: string;
  head_committed_at: string;
  head_pipeline?: { id: number; status: string; jobs: Record<string, string> };
  prod_sha?: string;
  commits_prod_to_head?: GitlabCommit[];
  open_mrs: GitlabMr[];
  untracked?: Record<string, string>;
}

export interface GitlabPayload {
  repos: GitlabRepo[];
}

/**
 * §5b. One per blocked session, from two hooks: `PermissionRequest` (the
 * permission-prompt source — carries tool_name/tool_input) and `Notification`
 * (every other way a session waits — matcher excludes `permission_prompt`,
 * which PermissionRequest already covers). Producer: intent-hook.
 */
export interface IntentRequestPayload {
  /** Hook payload session_id, verbatim; [A-Za-z0-9_-], ≤ 128. The reply-to address for the daemon. */
  session_id: string;
  /** Which hook fired. REQUIRED. Gates which of the fields below are valid. */
  trigger: 'permission_request' | 'notification';
  /**
   * §5b, 2026-09-24 amendment. REQUIRED on every new intent_request — the
   * validator enforces that at ingest (see intentRequest() below). Optional
   * here in the TS shape only because a row stored before the amendment has
   * no such key at all; that is exactly the case the board's
   * legacy-derivation path (board.ts, deriveWaitState) exists to handle.
   */
  wait_state?: WaitState;
  /** permission_request only. Hook tool_name verbatim; [A-Za-z0-9_.:-], ≤ 80 (e.g. "Bash"). */
  tool_name?: string;
  /**
   * permission_request only. WHAT the tool wants to do, projected from
   * tool_input field by field — NEVER tool_input itself (that key is
   * forbidden, see FORBIDDEN_KEYS). Cut at 240, NO content filter. Omitted
   * with a reason in `untracked` when nothing could be projected for the tool.
   */
  action?: string;
  action_truncated?: true;
  /** permission_request only. tool_input.description when present — the model's own
   *  one-line summary, shown BESIDE the action, never instead of it. ≤ 240. */
  description?: string;
  description_truncated?: true;
  /** notification only. Hook payload notification_type, verbatim; [a-z_], ≤ 40. Free string
   *  on purpose — a new Claude Code type must not 422. Omit + `untracked` when absent. */
  notification_type?: string;
  /** Hook payload `message`, VERBATIM, cut at 240 chars. NO content filter. Omit + `untracked`
   *  when the payload carries no message. */
  question?: string;
  question_truncated?: true;
  asked_at: string;
  /** Tail of the cwd's git `origin` URL, e.g. "main-backend". [A-Za-z0-9._-], ≤ 80. Never a
   *  path. Omit + `untracked` when cwd is not a git checkout or has no origin. */
  repo?: string;
  /** Omitted in v1 (not derivable yet) with `untracked`. */
  wave_slug?: string;
  untracked?: Record<string, string>;
}

/**
 * §5c — the return path (migrations 015 + 016, CORTEX-INTENTS §3).
 *
 * The queue carries DECISIONS, never AUTHORIZATIONS (Scott, 2026-09-24). An
 * answer names which kind of decision it is; the DB refuses anything else.
 * Authorizations are given up front in the prompt or in person in the
 * session — a session that needs one it was not given parks. The UI lists
 * them only to say so ("needs you in the session"); they are never answerable.
 */
export type Decision = 'choose' | 'park_or_continue' | 'clarify';
export const DECISIONS: readonly { value: Decision; words: string }[] = [
  { value: 'choose', words: 'Choose between the options it gave' },
  { value: 'park_or_continue', words: 'Park or continue' },
  { value: 'clarify', words: 'Clarify what was meant' },
];
export const AUTHORIZATIONS = [
  'Merging to main-backend master',
  'Money',
  'Writing or bulk-changing production data',
  'Deleting anything',
  'Permissions, roles, RBAC',
  'Anything staff or students will see change',
  'Creating a production account',
] as const;
export const ANSWER_CAP = 1000;

export type IntentStatus = 'pending' | 'applied' | 'parked';

/** An ops_intents row as the board reads it (RLS: owner only). */
export interface StoredAnswer {
  id: string;
  run_id: string;
  decision: Decision;
  answer: string;
  answered_at: string;
  status: IntentStatus;
  applied_at: string | null;
}

/**
 * One row of `GET /api/ops/intents` — what the dev-box daemon delivers.
 * session_id is the reply-to; there is no cwd (contract §5b): the daemon
 * finds the socket from session_id on the box itself.
 */
export interface PendingIntent {
  id: string;
  run_id: string;
  session_id: string;
  wave_slug: string | null;
  decision: Decision;
  question: string | null;
  question_truncated: boolean;
  options: string[] | null;
  asked_at: string;
  answer: string;
  answered_at: string;
}

export interface Envelope<K extends Kind = Kind> {
  v: 1;
  kind: K;
  run_id: string;
  producer: { name: 'session-check' | 'wave' | 'gitlab-poll' | 'intent-hook'; host: string; version: string };
  started_at: string;
  finished_at: string;
  payload: K extends 'session_check'
    ? SessionCheckPayload
    : K extends 'waves'
      ? WavesPayload
      : K extends 'gitlab'
        ? GitlabPayload
        : IntentRequestPayload;
}

export type Validation = { ok: true; envelope: Envelope } | { ok: false; errors: string[] };

/**
 * Keys refused by name anywhere in a payload. Mirrors ops_private.forbidden_key
 * (013, widened by 014). `cwd` and `transcript_path` are local-machine detail —
 * CORTEX-INTENTS.md §5 lists `cwd` on the intent shape, but the contract keeps
 * local paths off this box; the hook writes it to a local sidecar instead.
 * `tool_input` carries file contents for Write/Edit and anything at all for
 * MCP tools — only the `action` projection (contract §5b) ever leaves the box.
 */
export const FORBIDDEN_KEYS = ['body', 'note', 'content', 'markdown', 'worktree', 'chat', 'source_line', 'cwd', 'transcript_path', 'tool_input'];

// ---------------------------------------------------------------- primitives

const ISO_Z = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA40 = /^[0-9a-f]{40}$/;
const MR_REF = /^[\w.-]+![0-9]+$/;
const ISSUE_REF = /^[\w.-]+#[0-9]+$/;
const REPO_SHA = /^[\w.-]+@[0-9a-f]{7,40}$/;

type Obj = Record<string, unknown>;

class Collector {
  errors: string[] = [];
  add(path: string, reason: string) {
    this.errors.push(`${path}: ${reason}`);
  }
}

const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x);

/**
 * Object with exactly these keys: `required` must be present, `optional` may
 * be, anything else is an error. Returns the object when it is one.
 */
function shape(c: Collector, path: string, x: unknown, required: string[], optional: string[] = []): Obj | null {
  if (!isObj(x)) {
    c.add(path, x === null ? 'null is not accepted' : 'must be an object');
    return null;
  }
  for (const k of required) if (!(k in x)) c.add(`${path}.${k}`, 'required');
  const known = new Set([...required, ...optional]);
  for (const k of Object.keys(x)) {
    if (FORBIDDEN_KEYS.includes(k)) c.add(`${path}.${k}`, 'forbidden key');
    else if (!known.has(k)) c.add(`${path}.${k}`, 'unknown key');
  }
  return x;
}

function str(c: Collector, path: string, x: unknown, opts: { re?: RegExp; max?: number; nonEmpty?: boolean } = {}) {
  if (x === undefined) return;
  if (x === null) return c.add(path, 'null is not accepted');
  if (typeof x !== 'string') return c.add(path, 'must be a string');
  if (opts.nonEmpty !== false && x === '') c.add(path, 'empty string is not accepted — omit the key');
  if (opts.max !== undefined && x.length > opts.max) c.add(path, `longer than ${opts.max}`);
  if (opts.re && x !== '' && !opts.re.test(x)) c.add(path, `does not match ${opts.re}`);
}

function oneOf(c: Collector, path: string, x: unknown, values: readonly unknown[]) {
  if (x === undefined) return;
  if (x === null) return c.add(path, 'null is not accepted');
  if (!values.includes(x)) c.add(path, `must be one of ${values.join('|')}`);
}

function int(c: Collector, path: string, x: unknown, min = 0) {
  if (x === undefined) return;
  if (x === null) return c.add(path, 'null is not accepted');
  if (typeof x !== 'number' || !Number.isInteger(x) || x < min) c.add(path, `must be an integer ≥ ${min}`);
}

function bool(c: Collector, path: string, x: unknown) {
  if (x === undefined) return;
  if (typeof x !== 'boolean') c.add(path, x === null ? 'null is not accepted' : 'must be a boolean');
}

function list(c: Collector, path: string, x: unknown, each: (p: string, v: unknown) => void) {
  if (x === undefined) return;
  if (!Array.isArray(x)) return c.add(path, x === null ? 'null is not accepted' : 'must be a list');
  x.forEach((v, i) => each(`${path}[${i}]`, v));
}

function untracked(c: Collector, path: string, x: unknown) {
  if (x === undefined) return;
  if (!isObj(x)) return c.add(path, 'must be an object of field → reason');
  for (const [k, v] of Object.entries(x)) str(c, `${path}.${k}`, v, { max: 500 });
}

// ---------------------------------------------------------------- kinds

const CHECK_STATES = ['ok', 'drift', 'pending', 'red', 'unknown', 'not_deployed'] as const;
const CHECK_METHODS = ['exact', 'timing_proxy', 'query', 'heartbeat', 'probe'] as const;
const VALUE_KEYS: Record<keyof CheckValues, 'sha' | 'iso' | 'int' | 'text'> = {
  head_sha: 'sha',
  head_merged_at: 'iso',
  live_sha: 'sha',
  live_deployed_at: 'iso',
  behind_minutes: 'int',
  pipeline: 'text',
  count: 'int',
  http_status: 'int',
  latency_ms: 'int',
  window_minutes: 'int',
  requests: 'int',
  errors_5xx: 'int',
  errors_4xx: 'int',
};

function check(c: Collector, p: string, x: unknown) {
  const o = shape(c, p, x, ['id', 'section', 'state', 'method', 'line', 'measured_at'], ['method_label', 'values', 'untracked']);
  if (!o) return;
  str(c, `${p}.id`, o.id, { max: 80 });
  str(c, `${p}.section`, o.section, { max: 80 });
  oneOf(c, `${p}.state`, o.state, CHECK_STATES);
  oneOf(c, `${p}.method`, o.method, CHECK_METHODS);
  // Required exactly when the printed line carries a method word (ruling 2026-09-23).
  const labelled = o.method === 'exact' || o.method === 'timing_proxy';
  if (labelled && o.method_label === undefined) c.add(`${p}.method_label`, `required when method=${o.method}`);
  if (!labelled && o.method_label !== undefined) c.add(`${p}.method_label`, `forbidden when method=${String(o.method)}`);
  oneOf(c, `${p}.method_label`, o.method_label, ['exact', 'timing']);
  str(c, `${p}.line`, o.line, { max: 1000 });
  str(c, `${p}.measured_at`, o.measured_at, { re: ISO_Z });
  if (o.values !== undefined) {
    const v = shape(c, `${p}.values`, o.values, [], Object.keys(VALUE_KEYS));
    if (v)
      for (const [k, kind] of Object.entries(VALUE_KEYS)) {
        const path = `${p}.values.${k}`;
        if (kind === 'sha') str(c, path, v[k], { re: SHA40 });
        else if (kind === 'iso') str(c, path, v[k], { re: ISO_Z });
        else if (kind === 'int') int(c, path, v[k]);
        else str(c, path, v[k], { max: 1000 });
      }
  }
  untracked(c, `${p}.untracked`, o.untracked);
}

function sessionCheck(c: Collector, p: string, x: unknown) {
  const o = shape(c, p, x, ['mode', 'exit_code', 'verdict', 'checks'], ['control']);
  if (!o) return;
  oneOf(c, `${p}.mode`, o.mode, ['live', 'control']);
  oneOf(c, `${p}.exit_code`, o.exit_code, [0, 1, 2]);
  str(c, `${p}.verdict`, o.verdict, { max: 200 });
  list(c, `${p}.checks`, o.checks, (q, v) => check(c, q, v));
  if (o.mode === 'control' && o.control === undefined) c.add(`${p}.control`, 'required when mode=control');
  if (o.mode === 'live' && o.control !== undefined) c.add(`${p}.control`, 'forbidden when mode=live');
  if (o.control !== undefined) {
    const ctl = shape(c, `${p}.control`, o.control, ['expected', 'observed_all_red', 'not_red']);
    if (ctl) {
      oneOf(c, `${p}.control.expected`, ctl.expected, ['all_red']);
      bool(c, `${p}.control.observed_all_red`, ctl.observed_all_red);
      list(c, `${p}.control.not_red`, ctl.not_red, (q, v) => str(c, q, v, { max: 80 }));
    }
  }
}

function wave(c: Collector, p: string, x: unknown) {
  const o = shape(
    c,
    p,
    x,
    ['slug', 'title', 'repos', 'status', 'gate', 'blocked_by', 'started', 'mrs', 'shas', 'issues', 'note_mtime', 'in_registry'],
    [
      'family',
      'branch',
      'scope',
      'scope_truncated',
      'waiting_on_scott',
      'waiting_on_scott_truncated',
      'shipped_on',
      'reviewed_on',
      'claimed',
      'claimed_age_seconds',
      'lease_expires_at',
      'shippable',
      'shippable_checked_at',
    ]
  );
  if (!o) return;
  str(c, `${p}.slug`, o.slug, { max: 200 });
  str(c, `${p}.title`, o.title, { max: 200 });
  // Older notes record no family or branch: the key is omitted (three-state rule), never "".
  str(c, `${p}.family`, o.family, { max: 80 });
  str(c, `${p}.branch`, o.branch, { max: 200 });
  list(c, `${p}.repos`, o.repos, (q, v) => str(c, q, v, { max: 80 }));
  oneOf(c, `${p}.status`, o.status, ['planned', 'in-flight', 'blocked', 'shipped', 'parked']);
  str(c, `${p}.scope`, o.scope, { max: WAITING_CAP });
  if (o.scope_truncated !== undefined && o.scope_truncated !== true) c.add(`${p}.scope_truncated`, 'must be true, or omitted');
  if (o.scope_truncated === true && o.scope === undefined) c.add(`${p}.scope_truncated`, 'set without scope');
  oneOf(c, `${p}.gate`, o.gate, ['none', 'awaiting-confirm', 'do-not-run', 'idle-no-writes']);
  list(c, `${p}.blocked_by`, o.blocked_by, (q, v) => str(c, q, v, { max: 200 }));
  str(c, `${p}.waiting_on_scott`, o.waiting_on_scott, { max: WAITING_CAP });
  if (o.waiting_on_scott_truncated !== undefined && o.waiting_on_scott_truncated !== true)
    c.add(`${p}.waiting_on_scott_truncated`, 'must be true, or omitted');
  if (o.waiting_on_scott_truncated === true && o.waiting_on_scott === undefined)
    c.add(`${p}.waiting_on_scott_truncated`, 'set without waiting_on_scott');
  str(c, `${p}.started`, o.started, { re: DAY });
  str(c, `${p}.shipped_on`, o.shipped_on, { re: DAY });
  str(c, `${p}.reviewed_on`, o.reviewed_on, { re: DAY });
  list(c, `${p}.mrs`, o.mrs, (q, v) => str(c, q, v, { re: MR_REF }));
  list(c, `${p}.shas`, o.shas, (q, v) => str(c, q, v, { re: REPO_SHA }));
  list(c, `${p}.issues`, o.issues, (q, v) => str(c, q, v, { re: ISSUE_REF }));
  str(c, `${p}.note_mtime`, o.note_mtime, { re: ISO_Z });
  bool(c, `${p}.in_registry`, o.in_registry);

  // claimed_age_seconds / lease_expires_at: see the field comments on Wave in
  // contract.ts for why this checks only the observable half of the prose rule.
  bool(c, `${p}.claimed`, o.claimed);
  int(c, `${p}.claimed_age_seconds`, o.claimed_age_seconds);
  if (o.claimed !== true && o.claimed_age_seconds !== undefined)
    c.add(`${p}.claimed_age_seconds`, 'forbidden unless claimed=true');
  str(c, `${p}.lease_expires_at`, o.lease_expires_at, { re: ISO_Z });
  if (o.claimed !== true && o.lease_expires_at !== undefined)
    c.add(`${p}.lease_expires_at`, 'forbidden unless claimed=true');

  bool(c, `${p}.shippable`, o.shippable);
  str(c, `${p}.shippable_checked_at`, o.shippable_checked_at, { re: ISO_Z });
  if (o.shippable !== undefined && o.shippable_checked_at === undefined)
    c.add(`${p}.shippable_checked_at`, 'required when shippable is present');
  if (o.shippable === undefined && o.shippable_checked_at !== undefined)
    c.add(`${p}.shippable_checked_at`, 'forbidden without shippable');
}

function intentRequest(c: Collector, p: string, x: unknown) {
  const o = shape(
    c,
    p,
    x,
    ['session_id', 'trigger', 'wait_state', 'asked_at'],
    [
      'tool_name',
      'action',
      'action_truncated',
      'description',
      'description_truncated',
      'notification_type',
      'question',
      'question_truncated',
      'repo',
      'wave_slug',
      'untracked',
    ]
  );
  if (!o) return;
  str(c, `${p}.session_id`, o.session_id, { re: /^[A-Za-z0-9_-]+$/, max: 128 });
  oneOf(c, `${p}.trigger`, o.trigger, ['permission_request', 'notification']);
  oneOf(c, `${p}.wait_state`, o.wait_state, ['blocked', 'idle']);

  str(c, `${p}.tool_name`, o.tool_name, { re: /^[A-Za-z0-9_.:-]+$/, max: 80 });
  str(c, `${p}.action`, o.action, { max: WAITING_CAP });
  if (o.action_truncated !== undefined && o.action_truncated !== true)
    c.add(`${p}.action_truncated`, 'must be true, or omitted');
  if (o.action_truncated === true && o.action === undefined) c.add(`${p}.action_truncated`, 'set without action');
  str(c, `${p}.description`, o.description, { max: WAITING_CAP });
  if (o.description_truncated !== undefined && o.description_truncated !== true)
    c.add(`${p}.description_truncated`, 'must be true, or omitted');
  if (o.description_truncated === true && o.description === undefined)
    c.add(`${p}.description_truncated`, 'set without description');
  str(c, `${p}.notification_type`, o.notification_type, { re: /^[a-z_]+$/, max: 40 });

  // Cross-combination, contract 2026-09-24 (aeb9adf): permission_request-only
  // fields are forbidden when trigger=notification and vice versa. Checked
  // against `=== true`/`=== false` rather than truthiness so an invalid
  // trigger value (already reported by oneOf above) forbids BOTH sides —
  // there is no trigger under which these fields would be valid.
  const isPermission = o.trigger === 'permission_request';
  const isNotification = o.trigger === 'notification';
  if (!isPermission)
    for (const k of ['tool_name', 'action', 'action_truncated', 'description', 'description_truncated'] as const)
      if (o[k] !== undefined) c.add(`${p}.${k}`, 'forbidden unless trigger=permission_request');
  if (!isNotification && o.notification_type !== undefined)
    c.add(`${p}.notification_type`, 'forbidden unless trigger=notification');

  str(c, `${p}.question`, o.question, { max: WAITING_CAP });
  if (o.question_truncated !== undefined && o.question_truncated !== true)
    c.add(`${p}.question_truncated`, 'must be true, or omitted');
  if (o.question_truncated === true && o.question === undefined)
    c.add(`${p}.question_truncated`, 'set without question');
  str(c, `${p}.asked_at`, o.asked_at, { re: ISO_Z });
  str(c, `${p}.repo`, o.repo, { re: /^[A-Za-z0-9._-]+$/, max: 80 });
  str(c, `${p}.wave_slug`, o.wave_slug, { max: 200 });
  untracked(c, `${p}.untracked`, o.untracked);
}

function waves(c: Collector, p: string, x: unknown) {
  const o = shape(c, p, x, ['waves'], ['registry_commit']);
  if (!o) return;
  str(c, `${p}.registry_commit`, o.registry_commit, { re: /^[0-9a-f]{7,40}$/ });
  list(c, `${p}.waves`, o.waves, (q, v) => wave(c, q, v));
  if (Array.isArray(o.waves)) {
    const seen = new Set<unknown>();
    o.waves.forEach((w, i) => {
      const slug = isObj(w) ? w.slug : undefined;
      if (seen.has(slug)) c.add(`${p}.waves[${i}].slug`, 'duplicate slug');
      seen.add(slug);
    });
  }
}

function gitlab(c: Collector, p: string, x: unknown) {
  const o = shape(c, p, x, ['repos']);
  if (!o) return;
  list(c, `${p}.repos`, o.repos, (q, v) => {
    const r = shape(c, q, v, ['repo', 'project_path', 'default_branch', 'head_sha', 'head_committed_at', 'open_mrs'], ['head_pipeline', 'prod_sha', 'commits_prod_to_head', 'untracked']);
    if (!r) return;
    str(c, `${q}.repo`, r.repo, { max: 80 });
    str(c, `${q}.project_path`, r.project_path, { max: 200 });
    str(c, `${q}.default_branch`, r.default_branch, { max: 80 });
    str(c, `${q}.head_sha`, r.head_sha, { re: SHA40 });
    str(c, `${q}.head_committed_at`, r.head_committed_at, { re: ISO_Z });
    str(c, `${q}.prod_sha`, r.prod_sha, { re: SHA40 });
    if (r.commits_prod_to_head !== undefined && r.prod_sha === undefined)
      c.add(`${q}.commits_prod_to_head`, 'forbidden without prod_sha');
    if (r.head_pipeline !== undefined) {
      const hp = shape(c, `${q}.head_pipeline`, r.head_pipeline, ['id', 'status', 'jobs']);
      if (hp) {
        int(c, `${q}.head_pipeline.id`, hp.id);
        str(c, `${q}.head_pipeline.status`, hp.status, { max: 40 });
        if (!isObj(hp.jobs)) c.add(`${q}.head_pipeline.jobs`, 'must be an object');
        else for (const [k, s] of Object.entries(hp.jobs)) str(c, `${q}.head_pipeline.jobs.${k}`, s, { max: 40 });
      }
    }
    untracked(c, `${q}.untracked`, r.untracked);
    list(c, `${q}.commits_prod_to_head`, r.commits_prod_to_head, (cq, cv) => {
      const cm = shape(c, cq, cv, ['sha', 'title', 'authored_at'], ['mr']);
      if (!cm) return;
      str(c, `${cq}.sha`, cm.sha, { re: SHA40 });
      str(c, `${cq}.title`, cm.title, { max: 300 });
      str(c, `${cq}.authored_at`, cm.authored_at, { re: ISO_Z });
      str(c, `${cq}.mr`, cm.mr, { re: MR_REF });
    });
    list(c, `${q}.open_mrs`, r.open_mrs, (mq, mv) => {
      const m = shape(c, mq, mv, ['ref', 'title', 'draft', 'source_branch', 'sha', 'updated_at'], ['pipeline_status', 'behind_default_by', 'untracked']);
      if (!m) return;
      str(c, `${mq}.ref`, m.ref, { re: MR_REF });
      str(c, `${mq}.title`, m.title, { max: 300 });
      bool(c, `${mq}.draft`, m.draft);
      str(c, `${mq}.source_branch`, m.source_branch, { max: 200 });
      str(c, `${mq}.sha`, m.sha, { re: SHA40 });
      oneOf(c, `${mq}.pipeline_status`, m.pipeline_status, ['success', 'failed', 'running', 'pending', 'canceled', 'skipped', 'manual']);
      int(c, `${mq}.behind_default_by`, m.behind_default_by);
      str(c, `${mq}.updated_at`, m.updated_at, { re: ISO_Z });
      untracked(c, `${mq}.untracked`, m.untracked);
    });
  });
}

// ---------------------------------------------------------------- envelope

/**
 * `now` is passed in (tests never read the wall clock). A run finished more
 * than five minutes in the future is refused: it would stay "fresh" forever.
 */
export function validateEnvelope(x: unknown, now: Date): Validation {
  const c = new Collector();
  const o = shape(c, '$', x, ['v', 'kind', 'run_id', 'producer', 'started_at', 'finished_at', 'payload']);
  if (!o) return { ok: false, errors: c.errors };

  if (o.v !== CONTRACT_VERSION) c.add('$.v', `must be ${CONTRACT_VERSION}`);
  oneOf(c, '$.kind', o.kind, ['session_check', 'waves', 'gitlab', 'intent_request']);
  str(c, '$.run_id', o.run_id, { re: UUID });
  const pr = shape(c, '$.producer', o.producer, ['name', 'host', 'version']);
  if (pr) {
    oneOf(c, '$.producer.name', pr.name, ['session-check', 'wave', 'gitlab-poll', 'intent-hook']);
    str(c, '$.producer.host', pr.host, { max: 100 });
    str(c, '$.producer.version', pr.version, { max: 64 });
  }
  str(c, '$.started_at', o.started_at, { re: ISO_Z });
  str(c, '$.finished_at', o.finished_at, { re: ISO_Z });
  if (typeof o.started_at === 'string' && typeof o.finished_at === 'string' && ISO_Z.test(o.started_at) && ISO_Z.test(o.finished_at)) {
    const s = Date.parse(o.started_at);
    const f = Date.parse(o.finished_at);
    if (f < s) c.add('$.finished_at', 'before started_at');
    if (f > now.getTime() + 5 * 60_000) c.add('$.finished_at', 'more than 5 minutes in the future');
  }

  if (o.kind === 'session_check') sessionCheck(c, '$.payload', o.payload);
  else if (o.kind === 'waves') waves(c, '$.payload', o.payload);
  else if (o.kind === 'gitlab') gitlab(c, '$.payload', o.payload);
  else if (o.kind === 'intent_request') intentRequest(c, '$.payload', o.payload);

  return c.errors.length ? { ok: false, errors: c.errors } : { ok: true, envelope: o as unknown as Envelope };
}
