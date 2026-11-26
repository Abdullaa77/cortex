import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { runJob, dayLabel, sameBearer, isJob } from './cron.ts';
import { handleIncoming, type Deps } from './handle.ts';

function setup(now: string, answers: Record<string, any> = {}) {
  const calls: { fn: string; args: any }[] = [];
  const sent: string[] = [];
  const deps: Deps = {
    async rpc(fn, args = {}) {
      calls.push({ fn, args });
      return answers[fn] ?? { ok: true };
    },
    async send(_c, r) {
      sent.push(r.text);
    },
    async edit() {},
    async answer() {},
    now: () => new Date(now),
  };
  return { deps, calls, sent };
}

describe('cron jobs', () => {
  test('day-close on a weekday: summary, opens the cash question, no card line', async () => {
    const s = setup('2026-11-25T16:00:00Z', { bot_day_summary: { ok: true, totalMinor: 5_000_000, top: [{ name: 'Transport', minor: 5_000_000 }] } });
    await runJob('dayclose', s.deps, 1);
    assert.match(s.sent[0], /Wed 25 Nov — spent 50,000/);
    assert.doesNotMatch(s.sent[0], /Sunday/);
    assert.deepEqual(s.calls.find((c) => c.fn === 'bot_state_set')!.args.p_patch, { pendingBalance: 'cash', snoozeUntil: null });
    assert.equal(s.calls.find((c) => c.fn === 'bot_day_summary')!.args.p_day, '2026-11-25');
  });

  test('day-close: if the question cannot be sent, the open question is cleared again', async () => {
    const s = setup('2026-11-25T16:00:00Z', { bot_day_summary: { ok: true, totalMinor: 0, top: [] } });
    s.deps.send = async () => {
      throw new Error('502');
    };
    await assert.rejects(runJob('dayclose', s.deps, 1));
    const sets = s.calls.filter((c) => c.fn === 'bot_state_set');
    assert.deepEqual(sets[sets.length - 1].args.p_patch, { pendingBalance: null });
  });

  test('day-close on Sunday mentions the cards', async () => {
    const s = setup('2026-11-29T16:00:00Z', { bot_day_summary: { ok: true, totalMinor: 0, top: [] } });
    await runJob('dayclose', s.deps, 1);
    assert.match(s.sent[0], /Sun 29 Nov/);
    assert.match(s.sent[0], /Sunday: I will also ask/);
  });

  test('due pings use the Tashkent date: 04:00Z on 30 Nov asks for 2026-11-30', async () => {
    const s = setup('2026-11-30T04:00:00Z', { bot_owed_due: { ok: true, due: [{ person: 'Dior', openMinor: 5_000_000 }] } });
    const r = await runJob('due', s.deps, 1);
    assert.equal(s.calls[0].args.p_day, '2026-11-30');
    assert.equal(r.sent, 1);
    assert.match(s.sent[0], /Dior owes you 50,000/);
  });

  test('snooze: asks again only once the time has passed, and clears it first', async () => {
    const ctx = (until: string) => ({ bot_context: { ok: true, pendingBalance: 'cash', snoozeUntil: until } });
    const early = setup('2026-11-25T16:30:00Z', ctx('2026-11-25T17:00:00Z'));
    assert.equal((await runJob('snooze', early.deps, 1)).sent, 0);
    const due = setup('2026-11-25T17:05:00Z', ctx('2026-11-25T17:00:00Z'));
    assert.equal((await runJob('snooze', due.deps, 1)).sent, 1);
    assert.deepEqual(due.calls.find((c) => c.fn === 'bot_state_set')!.args.p_patch, { snoozeUntil: null });
    const none = setup('2026-11-25T17:05:00Z', { bot_context: { ok: true, pendingBalance: null, snoozeUntil: null } });
    assert.equal((await runJob('snooze', none.deps, 1)).sent, 0);
  });

  test('a failing database makes the job fail loudly, never send half a message', async () => {
    const s = setup('2026-11-25T16:00:00Z', { bot_day_summary: { ok: false, error: 'database_error' } });
    await assert.rejects(runJob('dayclose', s.deps, 1), /day_summary_failed/);
    assert.deepEqual(s.sent, []);
  });

  test('Sunday: answering cash asks humo next; weekday does not chain', async () => {
    const ctx = { bot_context: { ok: true, learned: {}, categories: [], owed: [], pendingBalance: 'cash' }, bot_balance_inputs: { ok: true, accountId: 'a', checkpoints: [], rows: [] } };
    const msg = { kind: 'message' as const, chatId: 1, messageId: 1, text: '500000' };
    const sun = setup('2026-11-29T16:30:00Z', ctx);
    await handleIncoming(sun.deps, msg);
    assert.deepEqual(sun.calls.filter((c) => c.fn === 'bot_state_set').at(-1)!.args.p_patch, { pendingBalance: 'humo' });
    assert.match(sun.sent.at(-1)!, /Humo now/i);
    const wed = setup('2026-11-25T16:30:00Z', ctx);
    await handleIncoming(wed.deps, msg);
    assert.deepEqual(wed.calls.filter((c) => c.fn === 'bot_state_set').at(-1)!.args.p_patch, { pendingBalance: null });
  });
});

test('helpers', () => {
  assert.equal(dayLabel('2026-11-29').sunday, true);
  assert.equal(sameBearer('Bearer ' + 'a'.repeat(20), 'a'.repeat(20)), true);
  assert.equal(sameBearer('Bearer ' + 'b'.repeat(20), 'a'.repeat(20)), false);
  assert.equal(sameBearer(null, 'a'.repeat(20)), false);
  assert.equal(sameBearer('Bearer short', 'short'), false);
  assert.equal(isJob('dayclose') && !isJob('x'), true);
});
