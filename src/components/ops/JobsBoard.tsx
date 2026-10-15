import type { JobCard, JobsScreen, SoloLine } from '@/lib/ops/jobs';
import { formatAge, type Tone } from '@/lib/ops/board';
import { TONE_COLOR } from './OpsBoard';

/**
 * The Jobs screen (lw-5). View only — nothing on it is a button or a link:
 * Scott manages from the terminal or the Claude mobile app (2026-10-15).
 *
 * Laptop: a 3-column grid that holds ~6 Jobs at 1440×900. Phone (< sm): cards
 * stack and shrink to two lines — name + status + done/total, then the
 * waiting question or the summary, cut to one line.
 */

const PILL_BG: Record<Tone, string> = {
  green: 'rgba(0,255,136,0.10)',
  amber: '#F59E0B',
  red: 'rgba(239,68,68,0.12)',
  grey: '#1A1A24',
};

function Pill({ card }: { card: JobCard }) {
  return (
    <span
      className="shrink-0 rounded-sm px-1.5 py-px text-[10px] uppercase tracking-wider"
      style={{ background: PILL_BG[card.tone], color: card.tone === 'amber' ? '#111' : TONE_COLOR[card.tone] }}
    >
      {card.words}
    </span>
  );
}

function Card({ card }: { card: JobCard }) {
  const total = card.tickets.done + card.tickets.left;
  const pct = total ? Math.round((100 * card.tickets.done) / total) : 0;
  const second = card.waiting ? `⏸ ${card.waiting}` : (card.summary ?? 'no summary yet');
  return (
    <div
      className="flex min-w-0 flex-col gap-1 rounded-lg border border-border bg-surface px-3 py-2 sm:gap-1.5 sm:py-2.5"
      style={{ borderColor: card.state === 'waiting_on_you' ? TONE_COLOR.amber : undefined }}
      data-job={card.job}
      data-state={card.state}
    >
      <div className="flex items-center gap-2">
        <span className="truncate text-sm font-bold text-text-primary">{card.job}</span>
        <Pill card={card} />
        <span className="ml-auto shrink-0 text-[11px] text-text-muted">
          {card.tickets.done}/{total} · {formatAge(card.ageMin)}
        </span>
      </div>

      {/* Phone: the one second line. */}
      <p
        className="truncate font-sans text-xs sm:hidden"
        style={{ color: card.waiting ? TONE_COLOR.amber : '#C8C8D0' }}
      >
        {second}
      </p>

      {/* Laptop: the full card. */}
      <div className="hidden flex-col gap-1.5 sm:flex">
        <div className="h-1 overflow-hidden rounded-sm bg-surface2">
          <div className="h-full bg-accent" style={{ width: `${pct}%` }} />
        </div>
        <p className="text-[11px] text-text-muted">
          {card.tickets.done} done · {card.tickets.left} left
          {card.acceptance && ` · ${card.acceptance.ticked}/${card.acceptance.total} ticks`} · {card.relays} relays
        </p>
        {card.waiting && <p className="text-xs" style={{ color: TONE_COLOR.amber }}>⏸ {card.waiting}</p>}
        {card.summary ? (
          <p className="line-clamp-4 font-sans text-[12.5px] leading-snug text-[#C8C8D0]">{card.summary}</p>
        ) : (
          <p className="text-[11px] italic text-text-muted/60">— no summary yet</p>
        )}
        {card.workers.map((w) => (
          <p key={w.name} className="truncate text-[11px] text-text-muted">
            <span className="text-text-primary">{w.name}</span> · {w.ticket}
            {w.model && ` · ${w.model}`}
            {w.line && ` — ${w.line}`}
          </p>
        ))}
      </div>
    </div>
  );
}

function Solo({ s }: { s: SoloLine }) {
  return (
    <div className="flex gap-2.5 overflow-hidden whitespace-nowrap border-b border-[#16161f] py-1 text-[11px] text-text-muted" data-solo data-blocked={s.blocked || undefined}>
      <span className="shrink-0 text-text-primary">{s.name ?? s.repo ?? 'unnamed'}</span>
      {s.name && s.repo && <span className="hidden shrink-0 sm:inline">{s.repo}</span>}
      <span className="min-w-0 flex-1 truncate" style={s.blocked ? { color: TONE_COLOR.amber } : undefined}>
        {s.blocked && '⏸ '}
        {s.line}
      </span>
      <span className="shrink-0">{formatAge(s.ageMin)}</span>
    </div>
  );
}

function Heading({ title }: { title: string }) {
  return <h2 className="mb-2 mt-4 text-[10px] uppercase tracking-[3px]" style={{ color: '#4A6858' }}>{title}</h2>;
}

export default function JobsBoard({ screen }: { screen: JobsScreen }) {
  const { top, jobs, solo } = screen;
  return (
    <div className="px-2.5 py-2.5 font-mono text-xs sm:px-5 sm:py-4" data-jobs-screen>
      <div
        className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border px-3 py-1.5 text-text-muted"
        data-top-tone={top.tone}
      >
        <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: TONE_COLOR[top.tone] }} />
        <span className="font-semibold" style={{ color: top.tone === 'green' ? '#E0E0E0' : TONE_COLOR[top.tone] }}>
          {top.prod}
        </span>
        {top.measured && <span>{top.measured}</span>}
        <span className="font-semibold text-text-primary">{top.train}</span>
        <span className="ml-auto">{top.waiting ? `${top.waiting} waiting on you` : 'nothing waiting on you'}</span>
      </div>

      <Heading title="Jobs" />
      {jobs.length ? (
        <div className="grid grid-cols-1 gap-1.5 sm:gap-2.5 lg:grid-cols-3 sm:grid-cols-2">
          {jobs.map((c) => (
            <Card key={c.job} card={c} />
          ))}
        </div>
      ) : (
        <p className="text-[11px] italic text-text-muted/60">— no Job has reported (a Job appears once its Lead or a Worker stops)</p>
      )}

      <Heading title="Solo" />
      {solo.length ? solo.map((s) => <Solo key={s.key} s={s} />) : <p className="text-[11px] italic text-text-muted/60">— no Solo session open</p>}
    </div>
  );
}
