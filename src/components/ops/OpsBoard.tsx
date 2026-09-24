'use client';

import { useState } from 'react';
import { AlertCircle, Lock, RefreshCw } from 'lucide-react';
import type { Board, CheckView, Freshness, IntentAnswerView, IntentItem, Tone, Tracked } from '@/lib/ops/board';
import { formatAge } from '@/lib/ops/board';
import { ANSWER_CAP, AUTHORIZATIONS, DECISIONS, type Decision } from '@/lib/ops/contract';
import type { AnswerResult } from '@/hooks/useOps';

/**
 * The Command Centre. One write, and only one: Scott's answer to a session
 * that is waiting on him (band 3, CORTEX-INTENTS §5c). No approve-anything,
 * no retries of anything but this page's own read, no gate toggles (§8).
 *
 * Everything shown is a value + when it was measured + how. Three states,
 * visibly different: a value · "—" with the reason it is not tracked · "—"
 * with a lock (restricted). STALE replaces a value; it never sits beside one.
 */

export const TONE_COLOR: Record<Tone, string> = {
  red: '#EF4444',
  amber: '#F59E0B',
  green: '#00FF88',
  grey: '#6B7280',
};

function SectionHeader({ title, note }: { title: string; note?: string }) {
  return (
    <div
      className="mb-2 mt-7 flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-[3px]"
      style={{ color: '#4A6858' }}
    >
      <span>--</span>
      <span>{title}</span>
      {note && <span className="font-normal normal-case tracking-normal text-text-muted">{note}</span>}
      <span className="flex-1 section-line" />
    </div>
  );
}

/** "—" + reason. Restricted reasons (prefixed "restricted:") get a lock. */
function NotTracked({ reason }: { reason: string }) {
  const restricted = reason.startsWith('restricted:');
  const stale = reason.startsWith('STALE');
  return (
    <p
      className="flex items-start gap-1.5 px-3 py-2 font-mono text-[11px] leading-relaxed"
      style={{ color: stale ? TONE_COLOR.amber : undefined }}
    >
      <span className={stale ? '' : 'text-text-muted/60'}>—</span>
      {restricted && <Lock size={11} className="mt-0.5 shrink-0 text-text-muted/60" />}
      <span className={stale ? '' : 'italic text-text-muted/60'}>
        {restricted ? reason.slice('restricted:'.length).trim() : reason}
      </span>
    </p>
  );
}

function Dot({ tone }: { tone: Tone }) {
  return <span className="mt-1 inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: TONE_COLOR[tone] }} />;
}

/**
 * One check, exactly as session-check printed it. The SAME component draws
 * the live repo band and the negative-control strip — that is what makes the
 * strip a proof that this renders red, not a picture of red.
 */
export function CheckRow({ c }: { c: CheckView }) {
  const untracked = Object.entries(c.untracked);
  return (
    <div className="px-3 py-1.5" data-check={c.id} data-tone={c.tone}>
      <div className="flex items-start gap-2">
        <Dot tone={c.tone} />
        <span className="min-w-0 flex-1 font-mono text-xs text-text-primary">
          {c.id}
          <span className="ml-1.5 text-[10px] uppercase" style={{ color: TONE_COLOR[c.tone] }}>
            {c.state}
          </span>
          {c.methodNote && (
            <span className="ml-1.5 text-[10px] text-text-muted/70">
              {c.methodNote === 'exact' ? 'exact' : 'inferred, not measured'}
            </span>
          )}
        </span>
      </div>
      <p className="ml-4 mt-0.5 break-words font-mono text-[10px] leading-relaxed text-text-muted/80">{c.line}</p>
      {untracked.map(([k, why]) => (
        <p key={k} className="ml-4 font-mono text-[10px] text-text-muted/50">
          {k}: — {why}
        </p>
      ))}
    </div>
  );
}

function FreshLine({ label, f }: { label: string; f: Freshness }) {
  if (f.state === 'never')
    return (
      <Row tone="red" label={label}>
        never reported
      </Row>
    );
  return (
    <Row tone={f.state === 'stale' ? 'amber' : 'green'} label={label}>
      last ran {formatAge(f.ageMin)} ago · budget {f.budgetMin}m
      {f.state === 'stale' && <span className="ml-1 font-semibold">· STALE</span>}
    </Row>
  );
}

function Row({ tone, label, children }: { tone: Tone; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 px-3 py-1.5 font-mono text-xs">
      <Dot tone={tone} />
      <span className="w-28 shrink-0 text-text-primary">{label}</span>
      <span className="min-w-0 flex-1 text-[11px]" style={{ color: tone === 'green' ? undefined : TONE_COLOR[tone] }}>
        {children}
      </span>
    </div>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return <div className="divide-y divide-border/20 rounded-lg border border-border/60 bg-surface/30">{children}</div>;
}

function Band<T>({ data, children }: { data: Tracked<T>; children: (v: T) => React.ReactNode }) {
  return <Panel>{data.tracked ? children(data.value) : <NotTracked reason={data.reason} />}</Panel>;
}

export type OnAnswer = (runId: string, decision: Decision, text: string) => Promise<AnswerResult>;

/**
 * Where an answer stands, from the database's own record. "pending" means
 * Cortex holds it and the dev-box daemon has not yet seen the session record
 * it — the board never claims delivery the writer did not confirm (§6.5).
 */
function AnswerLine({ a }: { a: IntentAnswerView }) {
  const where =
    a.status === 'applied'
      ? `delivered — session recorded it ${formatAge(a.appliedAgeMin ?? 0)} ago`
      : a.status === 'parked'
        ? 'session parked before delivery — the answer goes to the wave note'
        : 'answered — waiting for delivery';
  const tone: Tone = a.status === 'applied' ? 'green' : 'amber';
  return (
    <div className="mt-1 border-l-2 pl-2" style={{ borderColor: TONE_COLOR[tone] }}>
      <p className="font-mono text-[11px] text-text-primary whitespace-pre-wrap">{a.text}</p>
      <p className="font-mono text-[10px] text-text-muted">
        <span style={{ color: TONE_COLOR[tone] }}>{where}</span> · answered {formatAge(a.answeredAgeMin)} ago · {a.decisionWords.toLowerCase()}
      </p>
    </div>
  );
}

/**
 * The answer box. It carries DECISIONS, never AUTHORIZATIONS (CORTEX-INTENTS
 * §3, Scott 2026-09-24). The kind comes first and is required; the
 * authorization kinds are listed only as disabled options reading "needs you
 * in the session" — shown so the line is visible, never answerable. The
 * database refuses them too (ops_intent_answer, 016).
 */
function AnswerForm({ runId, onAnswer }: { runId: string; onAnswer: OnAnswer }) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<Decision | ''>('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open)
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-1 rounded border border-accent/40 bg-accent/10 px-2 py-0.5 font-mono text-[11px] text-accent transition-colors hover:bg-accent/20"
      >
        answer
      </button>
    );

  const submit = async () => {
    setBusy(true);
    setError(null);
    if (kind === '') return;
    const r = await onAnswer(runId, kind, text);
    setBusy(false);
    if (!r.ok) setError(r.reason);
  };

  return (
    <div className="mt-1.5 space-y-1.5">
      <select
        value={kind}
        onChange={(e) => {
          setKind(e.target.value as Decision | '');
          setError(null);
        }}
        aria-label="Kind of decision"
        className="w-full rounded border border-border bg-surface2 px-2 py-1 font-mono text-xs text-text-primary focus:border-accent/40 focus:outline-none"
      >
        <option value="">what kind of decision is this?</option>
        {DECISIONS.map((d) => (
          <option key={d.value} value={d.value}>
            {d.words}
          </option>
        ))}
        <optgroup label="Authorizations — needs you in the session">
          {AUTHORIZATIONS.map((w) => (
            <option key={w} disabled>
              {w} — needs you in the session
            </option>
          ))}
        </optgroup>
      </select>
      <textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setError(null);
        }}
        rows={3}
        maxLength={ANSWER_CAP}
        aria-label="Your answer"
        placeholder="your answer — delivered to the session verbatim"
        className="w-full resize-none rounded border border-border bg-surface2 px-2 py-1 font-mono text-xs text-text-primary placeholder:text-text-muted/50 focus:border-accent/40 focus:outline-none"
      />
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={busy || kind === '' || !text.trim()}
          className="rounded border border-accent/40 bg-accent/10 px-2.5 py-1 font-mono text-xs text-accent transition-colors hover:bg-accent/20 disabled:opacity-40"
        >
          {busy ? 'sending…' : 'send answer'}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="font-mono text-[11px] text-text-muted hover:text-text-primary"
        >
          cancel
        </button>
        <span className="font-mono text-[10px] text-text-muted/60">
          {text.length}/{ANSWER_CAP} · one answer per question, final
        </span>
      </div>
      <p className="font-mono text-[10px] italic text-text-muted/60">
        An authorization (merge, money, prod data, permissions, deletes) is never answered here — it needs you in the
        session. A session that needs one it wasn&apos;t given parks.
      </p>
      {error && <p className="font-mono text-[10px] text-[#F59E0B]">{error}</p>}
    </div>
  );
}

/** One blocked-sessions row — same shape for both the Blocked and Idle groups. */
function IntentRow({ it, onAnswer }: { it: IntentItem; onAnswer: OnAnswer }) {
  return (
    <div className="px-3 py-2">
      {it.trigger === 'permission_request' ? (
        <>
          <p className="font-mono text-xs text-text-primary">
            {it.action === null ? (
              <>
                {it.toolName} — <span className="italic text-text-muted">action not projected for this tool</span>
              </>
            ) : it.actionWithheld ? (
              <>
                {it.toolName}: <span className="italic text-text-muted">{it.action}</span>
              </>
            ) : (
              <>
                {it.toolName}: <span className="font-mono">{it.action}</span>
              </>
            )}
          </p>
          {it.description && (
            <p className="font-mono text-[11px] italic text-text-muted">model says: &quot;{it.description}&quot;</p>
          )}
        </>
      ) : (
        <>
          <p className="font-mono text-xs text-text-primary">{it.notificationWords}</p>
          {it.question && <p className="font-mono text-[11px] text-text-muted">{it.question}</p>}
        </>
      )}
      <p className="font-mono text-[10px] text-text-muted/60">
        {it.repo} · {formatAge(it.ageMin)} ago
      </p>
      {it.answer ? (
        <AnswerLine a={it.answer} />
      ) : it.answerable.ok ? (
        <AnswerForm runId={it.runId} onAnswer={onAnswer} />
      ) : (
        <p className="font-mono text-[10px] italic text-text-muted/60">{it.answerable.reason}</p>
      )}
    </div>
  );
}

/**
 * A sub-heading inside the "Blocked sessions" panel, splitting band 3 into
 * "Blocked — needs your answer" and "Idle — close or feed" (contract §5b,
 * 2026-09-24 wait_state amendment). An idle row must never render under the
 * Blocked heading — board.ts's intentsBand() already partitions items by
 * waitState, so this component only ever sees the group it was given.
 */
function IntentGroup({
  title,
  items,
  emptyCopy,
  onAnswer,
}: {
  title: string;
  items: IntentItem[];
  emptyCopy: string;
  onAnswer: OnAnswer;
}) {
  return (
    <div>
      <p className="px-3 pt-2 font-mono text-[10px] font-semibold uppercase tracking-[2px] text-text-muted/70">
        {title} {items.length > 0 && `(${items.length})`}
      </p>
      {items.length === 0 ? (
        <p className="px-3 py-1.5 font-mono text-[11px] italic text-text-muted/50">{emptyCopy}</p>
      ) : (
        items.map((it) => <IntentRow key={it.runId} it={it} onAnswer={onAnswer} />)
      )}
    </div>
  );
}

export default function OpsBoard({
  board,
  onRefresh,
  onAnswer,
}: {
  board: Board;
  onRefresh: () => void;
  onAnswer: OnAnswer;
}) {
  const hb = board.heartbeat;
  return (
    <div className="mx-auto max-w-3xl p-4 pb-10 lg:px-10 lg:py-6 page-enter" data-board-tone={board.tone}>
      {/* The headline: the board's own verdict, first. */}
      <div
        className="flex items-start gap-2 rounded-lg border px-3 py-2.5 font-mono"
        style={{ borderColor: `${TONE_COLOR[board.tone]}66`, background: `${TONE_COLOR[board.tone]}14` }}
      >
        <AlertCircle size={14} className="mt-0.5 shrink-0" style={{ color: TONE_COLOR[board.tone] }} />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold tracking-wide" style={{ color: TONE_COLOR[board.tone] }}>
            {board.headline}
          </p>
          <p className="mt-0.5 text-[10px] text-text-muted">{board.summary}</p>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          title="Re-read the board (reads only)"
          className="shrink-0 text-text-muted hover:text-accent"
        >
          <RefreshCw size={12} />
        </button>
      </div>

      <SectionHeader title="Heartbeat" />
      <Panel>
        {!board.reach.ok && (
          <Row tone="red" label="database">
            {board.reach.reason} · measured {board.reach.at}
          </Row>
        )}
        <FreshLine label="session-check" f={hb.sessionCheck} />
        {hb.control.state === 'never' ? (
          <Row tone="red" label="neg. control">
            never run — the board has not been seen failing
          </Row>
        ) : (
          <Row tone={hb.control.state === 'proven' ? 'green' : 'red'} label="neg. control">
            {hb.control.state === 'proven'
              ? `last proved ${formatAge(hb.control.ageMin)} ago — every check went red`
              : `FAILED ${formatAge(hb.control.ageMin)} ago — did not go red: ${hb.control.notRed.join(', ') || 'no control block'}`}
          </Row>
        )}
        <FreshLine label="gitlab" f={hb.gitlab} />
        {hb.waves.at === null ? (
          <Row tone="red" label="waves">
            no snapshot has ever arrived
          </Row>
        ) : (
          <Row tone="green" label="waves">
            {hb.waves.rows} rows · pushed {formatAge(hb.waves.ageMin!)} ago · no budget (each row shows its age)
          </Row>
        )}
      </Panel>

      <SectionHeader title="API" note="is prod serving?" />
      <Band data={board.api}>
        {(api) => (
          <>
            {api.health ? <CheckRow c={api.health} /> : <NotTracked reason="api.health: not probed" />}
            {api.errors ? <CheckRow c={api.errors} /> : <NotTracked reason="api.errors: not read" />}
            <p className="px-3 py-1.5 font-mono text-[10px] text-text-muted/70">
              {api.samples.total === 0
                ? '— no probes in 7 days'
                : `${api.samples.ok}/${api.samples.total} probes ok over 7 days · sampled at session-check runs, not continuous`}
            </p>
          </>
        )}
      </Band>

      <SectionHeader title="Waiting on you" note={board.waiting.tracked ? `(${board.waiting.value.length})` : undefined} />
      <Band data={board.waiting}>
        {(items) =>
          items.length === 0 ? (
            <p className="px-3 py-2 font-mono text-[11px] text-text-muted">nothing gated, blocked or waiting</p>
          ) : (
            items.map((w) => (
              <div key={w.slug} className="px-3 py-2">
                <div className="flex flex-wrap items-baseline gap-x-2 font-mono text-xs">
                  <span className="text-text-primary">{w.title}</span>
                  <span className="text-[10px]" style={{ color: TONE_COLOR.amber }}>
                    {w.gate !== 'none' ? w.gate : w.status}
                  </span>
                  {/* A parked wave stays visible as parked even when a gate string is already
                      shown above (a shown gate is what kept it in the set; "parked" is separate
                      information from the gate). Driven by w.parkedBadge (board.ts), not
                      recomputed here — gate 'none' used to suppress this badge wrongly (D7,
                      imcoin-d7-affordability-report, 2026-09-24). */}
                  {w.parkedBadge && (
                    <span className="rounded border border-border/60 px-1 text-[10px] uppercase tracking-wide text-text-muted">
                      parked
                    </span>
                  )}
                  {w.claimed === true && (
                    <span className="text-[10px]" style={{ color: w.leaseStatus === 'stale' ? TONE_COLOR.amber : undefined }}>
                      {w.leaseStatus === 'unknown' ? (
                        'claimed · lease unknown'
                      ) : (
                        <>
                          claimed{w.claimedAgeSeconds !== null ? ` · ${formatAge(Math.floor(w.claimedAgeSeconds / 60))} ago` : ''}
                          {w.leaseStatus === 'stale' && <span className="ml-1 font-semibold">lease stale</span>}
                        </>
                      )}
                    </span>
                  )}
                  {w.shippable === true && (
                    <span className="text-[10px]" style={{ color: TONE_COLOR.green }}>
                      shippable{w.shippableCheckedAgeMin !== null ? ` (checked ${formatAge(w.shippableCheckedAgeMin)} ago)` : ''}
                    </span>
                  )}
                  <span className="ml-auto text-[10px] text-text-muted/70">
                    {w.ageDays}d old · note {formatAge(w.noteAgeMin)} ago
                  </span>
                </div>
                <p className="font-mono text-[10px] text-text-muted/60">
                  {w.slug} · {w.repos.join(', ')}
                  {!w.inRegistry && ` · ${w.status}, not in the registry`}
                </p>
                {w.scope && (
                  <p className="font-mono text-[10px] text-text-muted/70">
                    {w.scope}
                    {w.scopeTruncated && <span className="ml-1 italic text-text-muted/50">… truncated, open the note</span>}
                  </p>
                )}
                {w.waiting && (
                  <p className="mt-0.5 font-mono text-[11px] leading-relaxed text-text-muted">
                    {w.waiting}
                    {w.truncated && <span className="ml-1 italic text-text-muted/60">… truncated, open the note</span>}
                  </p>
                )}
              </div>
            ))
          )
        }
      </Band>

      {(() => {
        const { blocked, idle, moreCount } = board.intents;
        const total = blocked.length + idle.length;
        return (
          <>
            <SectionHeader
              title="Blocked sessions"
              note={`(${total}${moreCount > 0 ? ` +${moreCount} more` : ''})`}
            />
            <Panel>
              {total === 0 ? (
                <p className="px-3 py-2 font-mono text-[11px] text-text-muted">no session blocked on you in the last 24h</p>
              ) : (
                <>
                  <IntentGroup title="Blocked — needs your answer" items={blocked} emptyCopy="none blocked" onAnswer={onAnswer} />
                  <IntentGroup title="Idle — close or feed" items={idle} emptyCopy="none idle" onAnswer={onAnswer} />
                </>
              )}
              {moreCount > 0 && <p className="px-3 py-1.5 font-mono text-[10px] text-text-muted/60">{moreCount} more</p>}
              <p className="px-3 py-1.5 font-mono text-[10px] italic text-text-muted/50">
                Cortex knows only answers given here — an unanswered row may already have been answered at the terminal
              </p>
            </Panel>
          </>
        );
      })()}

      <SectionHeader title="Ready to merge" />
      <Band data={board.ready}>
        {(r) => (
          <>
            {r.mrs.length === 0 ? (
              <p className="px-3 py-2 font-mono text-[11px] text-text-muted">no green draft MRs</p>
            ) : (
              r.mrs.map((m) => (
                <div key={m.ref} className="flex flex-wrap items-baseline gap-x-2 px-3 py-1.5 font-mono text-xs">
                  <span className="text-text-primary">{m.ref}</span>
                  <span className="text-[10px] text-text-muted">{m.title}</span>
                  <span className="text-[10px] text-text-muted/60">{m.wave ?? 'no wave'}</span>
                  <span className="ml-auto text-[10px]" style={{ color: m.needsRefresh ? TONE_COLOR.amber : undefined }}>
                    {m.ageDays}d green ·{' '}
                    {m.behind === null
                      ? 'behind: —'
                      : m.needsRefresh
                        ? `${m.behind} behind — merge origin/master + fresh run`
                        : 'up to date'}
                  </span>
                </div>
              ))
            )}
            <p className="px-3 pt-2 font-mono text-[10px] uppercase tracking-[2px] text-text-muted/60">prod → head</p>
            {r.commits.map((c) => (
              <p key={`${c.repo}${c.sha}`} className="px-3 py-0.5 font-mono text-[10px] text-text-muted">
                <span className="text-text-primary">{c.repo}</span> {c.sha.slice(0, 8)} {c.title} ·{' '}
                <span style={{ color: c.wave ? undefined : TONE_COLOR.amber }}>{c.wave ?? 'no wave'}</span>
              </p>
            ))}
            {r.commitsUntracked.map((u) => (
              <NotTracked key={u.repo} reason={`${u.repo}: commit list not tracked — ${u.reason}`} />
            ))}
          </>
        )}
      </Band>

      <SectionHeader title="Repo state" note="live runs only" />
      <Band data={board.repos}>{(checks) => checks.map((c) => <CheckRow key={c.id} c={c} />)}</Band>

      {board.controlStrip && hb.control.state !== 'never' && (
        <>
          <SectionHeader
            title="Last negative control"
            note={`session-check --simulate-stale, ${formatAge(hb.control.ageMin)} ago — never live state`}
          />
          <div className="rounded-lg border border-dashed border-border/60 opacity-80">
            {board.controlStrip.map((c) => (
              <CheckRow key={c.id} c={c} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
