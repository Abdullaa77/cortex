/**
 * The Tickets board (/ops, wave workflow-v2, ticket T-1) — a pure view.
 *
 * A ticket is one thing Scott asked for (`T-17`); he tracks tickets, never
 * waves (Scott, 2026-11-11: "i never know what happened to the ticket"). The
 * `ticket` CLI pushes the whole ledger after every write (kind `tickets`,
 * 020); this picks the latest snapshot and lays it out in the ledger's own
 * columns. View only, like the Jobs screen. Same pattern as jobs.ts: the
 * caller fetches, this decides, so every rule is unit tested without a DB.
 */
import type { TicketRow, TicketsPayload, TicketStatus } from './contract.ts';
import { ageMinutes, type StoredRun, type Tone } from './board.ts';

/** A done ticket stays on the board this long after its last update. */
export const DONE_STAYS_MS = 7 * 24 * 60 * 60 * 1000;
/** A building ticket with no update for longer than this is shown as quiet. */
export const QUIET_MIN = 2 * 24 * 60;

export const COLUMNS: readonly { status: TicketStatus; label: string; tone: Tone }[] = [
  { status: 'new', label: 'New', tone: 'grey' },
  { status: 'building', label: 'Building', tone: 'green' },
  { status: 'needs-you', label: 'Needs you', tone: 'amber' },
  { status: 'in-queue', label: 'In queue', tone: 'green' },
  { status: 'live', label: 'Live', tone: 'green' },
  { status: 'done', label: 'Done (7d)', tone: 'grey' },
];

export interface TicketCard {
  id: string;
  title: string;
  next: string | null;
  /** Waves and MRs, joined for one muted line; null when it has neither. */
  refs: string | null;
  ageMin: number;
  /** Building with no update for QUIET_MIN — nobody is moving it. */
  quiet: boolean;
  reopened: number;
}

export interface TicketColumn {
  status: TicketStatus;
  label: string;
  tone: Tone;
  cards: TicketCard[];
}

export type TicketsBoard =
  /** No snapshot was ever received: the producer is off or never ran — never "0 tickets". */
  | { state: 'none' }
  | { state: 'ok'; asOfMin: number; open: number; columns: TicketColumn[] };

const idNum = (id: string) => Number(id.slice(2)) || 0;

function cardOf(t: TicketRow, now: Date): TicketCard {
  const refs = [...t.waves, ...t.mrs].join(' · ');
  const ageMin = ageMinutes(t.updated_at, now);
  return {
    id: t.id,
    title: t.title,
    next: t.next ? (t.next_truncated ? `${t.next}…` : t.next) : null,
    refs: refs || null,
    ageMin,
    quiet: t.status === 'building' && ageMin >= QUIET_MIN,
    reopened: t.reopened,
  };
}

/** `runs` may hold several snapshots; the newest by finished_at wins. */
export function ticketsBoard(runs: StoredRun<TicketsPayload>[], now: Date): TicketsBoard {
  if (!runs.length) return { state: 'none' };
  const latest = runs.reduce((a, b) => (Date.parse(b.finished_at) > Date.parse(a.finished_at) ? b : a));
  const rows = latest.payload.tickets;
  const columns = COLUMNS.map((c) => {
    const inCol = rows.filter((t) => t.status === c.status);
    const kept = c.status === 'done' ? inCol.filter((t) => now.getTime() - Date.parse(t.updated_at) <= DONE_STAYS_MS) : inCol;
    // Done: newest first. Every other column: oldest ticket first (lowest number) — the longest wait on top.
    kept.sort((a, b) => (c.status === 'done' ? Date.parse(b.updated_at) - Date.parse(a.updated_at) : idNum(a.id) - idNum(b.id)));
    return { ...c, cards: kept.map((t) => cardOf(t, now)) };
  });
  return {
    state: 'ok',
    asOfMin: ageMinutes(latest.finished_at, now),
    open: rows.filter((t) => t.status !== 'done').length,
    columns,
  };
}
