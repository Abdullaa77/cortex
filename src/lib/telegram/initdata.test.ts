import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { checkInitData } from './initdata.ts';

const BOT = '123456:TEST-bot-token';
const NOW = new Date('2026-11-26T10:00:00Z');
const authDate = (d: Date) => Math.floor(d.getTime() / 1000);

function sign(fields: Record<string, string>, token = BOT): string {
  const check = Object.keys(fields).sort().map((k) => `${k}=${fields[k]}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  const hash = createHmac('sha256', secret).update(check).digest('hex');
  return new URLSearchParams({ ...fields, hash }).toString();
}
const fields = (id: number, date = NOW) => ({
  auth_date: String(authDate(date)),
  query_id: 'AAH',
  user: JSON.stringify({ id, first_name: 'S' }),
});

describe('checkInitData', () => {
  test('owner with a good signature passes', () => {
    assert.deepEqual(checkInitData(sign(fields(42)), BOT, 42, NOW), { ok: true });
  });
  test('another Telegram user is "not_owner"', () => {
    assert.deepEqual(checkInitData(sign(fields(43)), BOT, 42, NOW), { ok: false, reason: 'not_owner' });
  });
  test('signed with another bot token is "bad_signature"', () => {
    assert.deepEqual(checkInitData(sign(fields(42), 'other'), BOT, 42, NOW), { ok: false, reason: 'bad_signature' });
  });
  test('a tampered field is "bad_signature"', () => {
    const q = sign(fields(42)).replace('AAH', 'AAI');
    assert.deepEqual(checkInitData(q, BOT, 42, NOW), { ok: false, reason: 'bad_signature' });
  });
  test('missing hash, empty and garbage are refused', () => {
    for (const q of ['', 'auth_date=1', 'user=%7B', '%%%'])
      assert.equal(checkInitData(q, BOT, 42, NOW).ok, false);
  });
  test('older than 24 h is "expired"', () => {
    const old = new Date(NOW.getTime() - 25 * 3600 * 1000);
    assert.deepEqual(checkInitData(sign(fields(42, old)), BOT, 42, NOW), { ok: false, reason: 'expired' });
  });
  test('a date in the future is refused', () => {
    const fut = new Date(NOW.getTime() + 3600 * 1000);
    assert.equal(checkInitData(sign(fields(42, fut)), BOT, 42, NOW).ok, false);
  });
  test('unconfigured owner id is refused', () => {
    assert.equal(checkInitData(sign(fields(42)), BOT, NaN, NOW).ok, false);
    assert.equal(checkInitData(sign(fields(42)), '', 42, NOW).ok, false);
  });
});
