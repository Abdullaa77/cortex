import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { webhook, type WebhookConfig } from './webhook.ts';
import type { Deps } from './handle.ts';

const CFG: WebhookConfig = { secret: 's'.repeat(32), ownerId: 4242 };
const SECRET_HEADER = 'x-telegram-bot-api-secret-token';

function setup() {
  const rpcs: string[] = [];
  const sent: string[] = [];
  const deps: Deps = {
    async rpc(fn) {
      rpcs.push(fn);
      if (fn === 'bot_context') return { ok: true, learned: {}, categories: [], owed: [], pendingBalance: null };
      return { ok: true, saved: [{ id: 'x', direction: 'expense', amountMinor: 1, categorySlug: null, account: 'cash' }] };
    },
    async send(_c, r) {
      sent.push(r.text);
    },
    async edit() {},
    async answer() {},
    now: () => new Date(),
  };
  return { deps, rpcs, sent };
}

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request('http://x/api/telegram/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
const update = (fromId: number) => ({
  message: { message_id: 1, from: { id: fromId, is_bot: false }, chat: { id: fromId }, text: '-25k taxi' },
});

describe('webhook', () => {
  test('no secret header, wrong secret, or no config: refused, database untouched', async () => {
    const s = setup();
    assert.equal((await webhook(post(update(4242)), CFG, s.deps)).status, 401);
    assert.equal((await webhook(post(update(4242), { [SECRET_HEADER]: 'x'.repeat(32) }), CFG, s.deps)).status, 401);
    assert.equal((await webhook(post(update(4242), { [SECRET_HEADER]: CFG.secret }), null, s.deps)).status, 503);
    const weak = { secret: 'short', ownerId: 4242 };
    assert.equal((await webhook(post(update(4242), { [SECRET_HEADER]: 'short' }), weak, s.deps)).status, 503);
    assert.deepEqual(s.rpcs, []);
  });

  test('a stranger with the right secret is acknowledged and ignored', async () => {
    const s = setup();
    const r = await webhook(post(update(999), { [SECRET_HEADER]: CFG.secret }), CFG, s.deps);
    assert.equal(r.status, 200);
    assert.deepEqual(s.rpcs, []);
  });

  test('the owner with the right secret is handled', async () => {
    const s = setup();
    const r = await webhook(post(update(4242), { [SECRET_HEADER]: CFG.secret }), CFG, s.deps);
    assert.equal(r.status, 200);
    assert.ok(s.rpcs.includes('bot_capture'));
  });

  test('a redelivered update_id is acknowledged and not handled twice', async () => {
    const s = setup();
    const base = s.deps.rpc;
    s.deps.rpc = async (fn, args) => (fn === 'bot_seen_update' ? { ok: true, fresh: false } : base(fn, args));
    const r = await webhook(post({ update_id: 7, ...update(4242) }, { [SECRET_HEADER]: CFG.secret }), CFG, s.deps);
    assert.equal(r.status, 200);
    assert.equal(s.rpcs.includes('bot_capture'), false);
  });

  test('garbage and oversize bodies are 200 and untouched (no Telegram retry loop)', async () => {
    const s = setup();
    const h = { [SECRET_HEADER]: CFG.secret };
    assert.equal((await webhook(post('{not json', h), CFG, s.deps)).status, 200);
    assert.equal((await webhook(post('x'.repeat(70_000), h), CFG, s.deps)).status, 200);
    assert.deepEqual(s.rpcs, []);
  });

  test('a handler crash still answers 200 and tells Scott', async () => {
    const s = setup();
    s.deps.rpc = async () => {
      throw new Error('boom');
    };
    const r = await webhook(post(update(4242), { [SECRET_HEADER]: CFG.secret }), CFG, s.deps);
    assert.equal(r.status, 200);
    assert.match(s.sent[0], /went wrong/);
  });
});
