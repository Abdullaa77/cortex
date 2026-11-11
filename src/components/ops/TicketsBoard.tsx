import type { TicketCard, TicketColumn, TicketsBoard } from '@/lib/ops/tickets';
import { formatAge } from '@/lib/ops/board';
import { TONE_COLOR } from './OpsBoard';

/**
 * The Tickets board (2026-11-11, wave workflow-v2, T-1): every ticket Scott
 * asked for, in its ledger column. View only, like the Jobs above it — the
 * `ticket` CLI moves tickets; this only shows where they are.
 *
 * Laptop (≥ lg): six columns side by side. Tablet: three. Phone: the columns
 * stack, an empty one shrinks to its heading line.
 */

function Card({ card }: { card: TicketCard }) {
  return (
    <div
      className="min-w-0 rounded-md border border-border bg-surface px-2.5 py-1.5"
      style={{ borderColor: card.quiet ? TONE_COLOR.amber : undefined }}
      data-ticket={card.id}
      data-quiet={card.quiet || undefined}
    >
      <div className="flex items-baseline gap-1.5">
        <span className="shrink-0 font-bold text-text-primary">{card.id}</span>
        <span className="min-w-0 flex-1 font-sans text-[12px] leading-snug text-[#C8C8D0]">{card.title}</span>
      </div>
      {card.next && <p className="mt-0.5 line-clamp-2 font-sans text-[11px] leading-snug text-text-muted">→ {card.next}</p>}
      <p className="mt-0.5 truncate text-[10px] text-text-muted/70">
        {formatAge(card.ageMin)}
        {card.quiet && <span style={{ color: TONE_COLOR.amber }}> · quiet</span>}
        {card.reopened > 0 && ` · reopened ${card.reopened}×`}
        {card.refs && ` · ${card.refs}`}
      </p>
    </div>
  );
}

function Column({ col }: { col: TicketColumn }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5" data-column={col.status}>
      <h3 className="flex items-center gap-1.5 text-[10px] uppercase tracking-[2px] text-text-muted">
        <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: TONE_COLOR[col.tone] }} />
        {col.label}
        <span className="text-text-primary">{col.cards.length}</span>
      </h3>
      {col.cards.map((c) => (
        <Card key={c.id} card={c} />
      ))}
    </div>
  );
}

export default function TicketsBoardView({ board }: { board: TicketsBoard }) {
  return (
    <div className="px-2.5 pb-4 font-mono text-xs sm:px-5" data-tickets-board>
      <h2 className="mb-2 mt-2 flex items-baseline gap-2 text-[10px] uppercase tracking-[3px]" style={{ color: '#4A6858' }}>
        Tickets
        {board.state === 'ok' && (
          <span className="normal-case tracking-normal text-text-muted">
            {board.open} open · ledger {formatAge(board.asOfMin)} ago
          </span>
        )}
      </h2>
      {board.state === 'none' ? (
        <p className="text-[11px] italic text-text-muted/60">— no ticket ledger received yet (the `ticket` push is off or has not run)</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {board.columns.map((c) => (
            <Column key={c.status} col={c} />
          ))}
        </div>
      )}
    </div>
  );
}
