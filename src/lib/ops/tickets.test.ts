import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ticketsBoard, QUIET_MIN } from './tickets.ts';
import type { TicketRow, TicketsPayload } from './contract.ts';
import type { StoredRun } from './board.ts';

const NOW = new Date('2026-11-11T18:00:00Z');
const at = (min: number) => new Date(NOW.getTime() - min * 60_000).toISOString().replace(/\.\d{3}Z$/, 'Z');

const row = (over: Partial<TicketRow> = {}): TicketRow => ({
  id: 'T-1',
  title: 'Workflow v2',
  status: 'building',
  waves: [],
  mrs: [],
  heard_at: at(600),
  updated_at: at(30),
  reopened: 0,
  ...over,
});
const run = (tickets: TicketRow[], finishedMin = 5): StoredRun<TicketsPayload> => ({
  run_id: `r-${finishedMin}`,
  finished_at: at(finishedMin),
  received_at: at(finishedMin),
  payload: { tickets },
});
const col = (b: ReturnType<typeof ticketsBoard>, status: string) => {
  assert.equal(b.state, 'ok');
  if (b.state !== 'ok') throw new Error('unreachable');
  return b.columns.find((c) => c.status === status)!;
};

describe('tickets board', () => {
  test('no snapshot is "none" — never an empty board that reads as zero tickets', () => {
    assert.deepEqual(ticketsBoard([], NOW), { state: 'none' });
  });

  test('the newest snapshot wins, whatever order the runs arrive in', () => {
    const b = ticketsBoard([run([row({ status: 'needs-you' })], 3), run([row({ status: 'building' })], 60)], NOW);
    assert.equal(col(b, 'needs-you').cards.length, 1);
    assert.equal(col(b, 'building').cards.length, 0);
    assert.equal(b.state === 'ok' && b.asOfMin, 3);
  });

  test('six columns in ledger order; each ticket in its own', () => {
    const b = ticketsBoard([run([row({ id: 'T-1', status: 'in-queue' }), row({ id: 'T-2', status: 'live' }), row({ id: 'T-3', status: 'new' })])], NOW);
    assert.equal(b.state, 'ok');
    if (b.state !== 'ok') return;
    assert.deepEqual(b.columns.map((c) => c.status), ['new', 'building', 'needs-you', 'in-queue', 'live', 'done']);
    assert.deepEqual(b.columns.map((c) => c.cards.map((x) => x.id)), [['T-3'], [], [], ['T-1'], ['T-2'], []]);
    assert.equal(b.open, 3);
  });

  test('open columns list the oldest ticket first, by number not by string (T-2 before T-10)', () => {
    const b = ticketsBoard([run([row({ id: 'T-10' }), row({ id: 'T-2' }), row({ id: 'T-9' })])], NOW);
    assert.deepEqual(col(b, 'building').cards.map((c) => c.id), ['T-2', 'T-9', 'T-10']);
  });

  test('done stays 7 days after its last update, newest first, and is not counted open', () => {
    const day = 24 * 60;
    const b = ticketsBoard(
      [run([row({ id: 'T-1', status: 'done', updated_at: at(8 * day) }), row({ id: 'T-2', status: 'done', updated_at: at(2 * day) }), row({ id: 'T-3', status: 'done', updated_at: at(60) })])],
      NOW
    );
    assert.deepEqual(col(b, 'done').cards.map((c) => c.id), ['T-3', 'T-2']);
    assert.equal(b.state === 'ok' && b.open, 0);
  });

  test('a building ticket untouched for 2 days is quiet; a needs-you one never is (it waits on Scott, by design)', () => {
    const b = ticketsBoard(
      [run([row({ id: 'T-1', updated_at: at(QUIET_MIN) }), row({ id: 'T-2', updated_at: at(QUIET_MIN - 1) }), row({ id: 'T-3', status: 'needs-you', updated_at: at(QUIET_MIN * 3) })])],
      NOW
    );
    assert.deepEqual(col(b, 'building').cards.map((c) => [c.id, c.quiet]), [['T-1', true], ['T-2', false]]);
    assert.equal(col(b, 'needs-you').cards[0].quiet, false);
  });

  test('next, its truncation mark, and waves + MRs as one refs line', () => {
    const b = ticketsBoard([run([row({ next: 'run the trials', next_truncated: true, waves: ['workflow-v2'], mrs: ['main-backend!918'] }), row({ id: 'T-2' })])], NOW);
    const [a, z] = col(b, 'building').cards;
    assert.equal(a.next, 'run the trials…');
    assert.equal(a.refs, 'workflow-v2 · main-backend!918');
    assert.equal(z.next, null);
    assert.equal(z.refs, null);
  });
});
