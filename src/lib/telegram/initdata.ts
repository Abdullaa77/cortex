/**
 * Telegram Mini App `initData` check (HMAC per Telegram docs): the webview hands
 * the page a signed query string; only the bot token can have signed it. Passing
 * means "this really came from Telegram, from the owner, recently". It is a
 * second lock beside the Supabase login, not a replacement for it.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export const MAX_AGE_SECONDS = 24 * 3600;

export type InitDataResult = { ok: true } | { ok: false; reason: 'malformed' | 'bad_signature' | 'expired' | 'not_owner' | 'not_configured' };

const no = (reason: Exclude<InitDataResult, { ok: true }>['reason']): InitDataResult => ({ ok: false, reason });

export function checkInitData(initData: string, botToken: string, ownerId: number, now: Date): InitDataResult {
  if (!botToken || !Number.isSafeInteger(ownerId)) return no('not_configured');
  if (typeof initData !== 'string' || initData.length === 0 || initData.length > 4096) return no('malformed');

  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash || !/^[0-9a-f]{64}$/.test(hash)) return no('malformed');
  params.delete('hash');

  const check = [...params.keys()].sort().map((k) => `${k}=${params.get(k)}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const expected = createHmac('sha256', secret).update(check).digest();
  if (!timingSafeEqual(expected, Buffer.from(hash, 'hex'))) return no('bad_signature');

  const authDate = Number(params.get('auth_date'));
  const age = Math.floor(now.getTime() / 1000) - authDate;
  if (!Number.isFinite(authDate) || age < -60 || age > MAX_AGE_SECONDS) return no('expired');

  let id: unknown;
  try {
    id = JSON.parse(params.get('user') ?? '').id;
  } catch {
    return no('malformed');
  }
  return id === ownerId ? { ok: true } : no('not_owner');
}
