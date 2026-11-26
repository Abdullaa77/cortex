import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { handleIncoming, tashkentDay, type Deps } from './handle.ts';
import { encode } from './callbacks.ts';
import type { Reply } from './render.ts';

const ID = '123e4567-e89b-42d3-a456-426614174000';
const NOW = new Date('2026-11-26T20:30:00Z'); // 01:30 on the 27th in Tashkent

type Call = { fn: string; args: Record<string, any> };

function harness(answers: Record<string, any> = {}) {
  const calls: Call[] = [];
  const sent: Reply[] = [];
  const edited: Reply[] = [];
  const answered: string[] = [];
  const base: Record<string, any> = {
    bot_context: { ok: true, learned: {}, categories: [{ slug: 'transport', name: 'Transport' }], owed: [], pendingBalance: null },
    bot_capture: {
      ok: true,
      saved: [{ id: ID, direction: 'expense', amountMinor: 2500000, categorySlug: 'transport', account: 'cash' }],
    },
    ...answers,
  };
  const deps: Deps = {
    async rpc(fn, args = {}) {
      calls.push({ fn, args });
      const a = base[fn];
      return typeof a === 'function' ? a(args) : (a ?? { ok: true });
    },
    async send(_c, r) {
      sent.push(r);
    },
    async edit(_c, _m, r) {
      edited.push(r);
    },
    async answer(id) {
      answered.push(id);
    },
    now: () => NOW,
  };
  return { deps, calls, sent, edited, answered };
}

const msg = (text: string) => ({ kind: 'message' as const, chatId: 1, messageId: 2, text });
const cb = (data: string) => ({ kind: 'callback' as const, callbackId: 'cb1', chatId: 1, messageId: 2, data });

describe('handleIncoming', () => {
  test('a clean line is saved at once and shown with buttons', async () => {
    const h = harness();
    await handleIncoming(h.deps, msg('-25k taxi'));
    const cap = h.calls.find((c) => c.fn === 'bot_capture')!;
    assert.equal(cap.args.p_raw, '-25k taxi');
    assert.equal(cap.args.p_drafts[0].amount_minor, 2500000);
    assert.match(h.sent[0].text, /Transport/);
  });

  test('a database failure says nothing was changed', async () => {
    const h = harness({ bot_capture: { ok: false, error: 'invalid' } });
    await handleIncoming(h.deps, msg('-25k taxi'));
    assert.match(h.sent[0].text, /nothing was changed/);
  });

  test('if the context cannot be loaded, nothing is saved', async () => {
    const h = harness({ bot_context: { ok: false, error: 'unauthorized' } });
    await handleIncoming(h.deps, msg('-25k taxi'));
    assert.equal(h.calls.some((c) => c.fn === 'bot_capture'), false);
    assert.equal(h.sent.length, 1);
  });

  test('undo edits the message; an already-gone row is said plainly', async () => {
    const h = harness({ bot_undo: { ok: false, error: 'not_found' } });
    await handleIncoming(h.deps, cb(encode({ op: 'undo', txn: ID })));
    assert.match(h.edited[0].text, /already done or gone/);
    assert.deepEqual(h.answered, ['cb1']);
  });

  test('the callback spinner is stopped even when the work throws', async () => {
    const h = harness({ bot_undo: () => { throw new Error('boom'); } });
    await assert.rejects(handleIncoming(h.deps, cb(encode({ op: 'undo', txn: ID }))));
    assert.deepEqual(h.answered, ['cb1']);
  });

  test('a small bare amount asks first; "as is" then saves it', async () => {
    const h = harness({
      bot_pending_put: { ok: true, id: ID },
      bot_pending_resolve: { ok: true, id: ID, kind: 'amount', raw: '-250 taxi', payload: {} },
    });
    await handleIncoming(h.deps, msg('-250 taxi'));
    assert.equal(h.calls.some((c) => c.fn === 'bot_capture'), false);
    assert.equal(h.calls.find((c) => c.fn === 'bot_pending_put')!.args.p_kind, 'amount');
    await handleIncoming(h.deps, cb(encode({ op: 'pending', pending: ID, choice: 'asis' })));
    assert.equal(h.calls.filter((c) => c.fn === 'bot_capture').length, 1);
    assert.equal(h.edited.length, 1);
  });

  test('a move takes two taps and moves the money once', async () => {
    const h = harness({
      bot_pending_put: { ok: true, id: ID },
      bot_pending_get: { ok: true, payload: { amountMinor: 25000000, comment: 'card to cash' } },
      bot_pending_resolve: { ok: true, raw: '*250k card to cash', payload: { amountMinor: 25000000, comment: 'card to cash', from: 'humo' } },
      bot_move: { ok: true, saved: [{ id: ID, direction: 'move', amountMinor: 25000000, categorySlug: null, account: 'humo', toAccount: 'cash' }] },
    });
    await handleIncoming(h.deps, msg('*250k card to cash'));
    await handleIncoming(h.deps, cb(encode({ op: 'moveFrom', pending: ID, account: 'humo' })));
    assert.deepEqual(h.calls.find((c) => c.fn === 'bot_pending_patch')!.args.p_patch, { from: 'humo' });
    await handleIncoming(h.deps, cb(encode({ op: 'moveTo', pending: ID, account: 'cash' })));
    const mv = h.calls.find((c) => c.fn === 'bot_move')!;
    assert.deepEqual([mv.args.p_from, mv.args.p_to, mv.args.p_amount_minor], ['humo', 'cash', 25000000]);
  });

  test('a move to the same account it came from is refused', async () => {
    const h = harness({
      bot_pending_resolve: { ok: true, raw: '*1m x', payload: { amountMinor: 1, comment: '', from: 'cash' } },
    });
    await handleIncoming(h.deps, cb(encode({ op: 'moveTo', pending: ID, account: 'cash' })));
    assert.equal(h.calls.some((c) => c.fn === 'bot_move'), false);
  });

  test('an owed payer is asked about; yes reduces what is owed', async () => {
    const h = harness({
      bot_context: { ok: true, learned: {}, categories: [], owed: [{ id: 'o1', person: 'Muxlisa opa', openMinor: 9000000 }], pendingBalance: null },
      bot_capture: { ok: true, saved: [{ id: ID, direction: 'income', amountMinor: 1000000, categorySlug: 'income', account: 'cash' }] },
      bot_pending_put: { ok: true, id: ID },
      bot_pending_resolve: { ok: true, kind: 'owed', raw: '+10k Muxlisa opa', payload: { owedId: 'o1', person: 'Muxlisa opa', amountMinor: 1000000 } },
      bot_owed_reduce: { ok: true, person: 'Muxlisa opa', openMinor: 8000000 },
    });
    await handleIncoming(h.deps, msg('+10k Muxlisa opa'));
    assert.match(h.sent[1].text, /Muxlisa opa paying back/);
    await handleIncoming(h.deps, cb(encode({ op: 'pending', pending: ID, choice: 'yes' })));
    assert.equal(h.calls.find((c) => c.fn === 'bot_owed_reduce')!.args.p_paid_minor, 1000000);
    assert.match(h.edited[0].text, /Still owes/);
  });

  test('a bare number answers the open balance question, and clears it', async () => {
    const h = harness({
      bot_context: { ok: true, learned: {}, categories: [], owed: [], pendingBalance: 'cash' },
      bot_balance_inputs: { ok: true, accountId: 'a1', checkpoints: [], rows: [] },
    });
    await handleIncoming(h.deps, msg('1,200,000'));
    const cp = h.calls.find((c) => c.fn === 'bot_checkpoint')!;
    assert.deepEqual([cp.args.p_account, cp.args.p_day], ['cash', '2026-11-27']);
    const order = h.calls.map((c) => c.fn);
    assert.ok(order.indexOf('bot_balance_inputs') < order.indexOf('bot_checkpoint'), 'reconcile before storing');
    assert.deepEqual(h.calls.find((c) => c.fn === 'bot_state_set')!.args.p_patch, { pendingBalance: null });
    assert.match(h.sent[0].text, /where it starts/);
  });

  test('snooze stores one hour from now', async () => {
    const h = harness();
    await handleIncoming(h.deps, cb('z'));
    assert.equal(h.calls.find((c) => c.fn === 'bot_state_set')!.args.p_patch.snoozeUntil, '2026-11-26T21:30:00.000Z');
  });
});

test('tashkentDay is UTC+5', () => {
  assert.equal(tashkentDay(new Date('2026-11-26T19:00:00Z')), '2026-11-27');
  assert.equal(tashkentDay(new Date('2026-11-26T18:59:00Z')), '2026-11-26');
});
