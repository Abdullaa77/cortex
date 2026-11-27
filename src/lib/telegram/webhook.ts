/**
 * POST /api/telegram/webhook, as a function. The request is believed only if
 * Telegram's secret header matches (constant-time); even then only the owner's
 * messages are listened to (parseUpdate). After that the answer is always 200:
 * a non-200 makes Telegram retry, and a retried save would be a double save.
 */
import { timingSafeEqual } from 'node:crypto';
import { handleIncoming, type Deps } from './handle.ts';
import { parseUpdate } from './update.ts';

export const MAX_UPDATE_BYTES = 64 * 1024;

export interface WebhookConfig {
  secret: string;
  ownerId: number;
  /**
   * Fingerprint of the database token (sha256 hex, as ops_private.bot_tokens
   * stores it) and its length. Never the token itself. When the database does
   * not know the token yet, the owner is sent this so it can be registered:
   * Vercel keeps the value locked, so this is the only way to read its hash.
   */
  dbToken?: { sha256Hex: string; length: number };
}

/** 021's bot_user() refuses any token shorter than this. */
const MIN_DB_TOKEN_LENGTH = 32;

function notRegisteredText(t: { sha256Hex: string; length: number }): string {
  if (t.length < MIN_DB_TOKEN_LENGTH)
    return `Bot not connected: CORTEX_BOT_DB_TOKEN is too short (${t.length} characters, needs ${MIN_DB_TOKEN_LENGTH}+). Set a longer value in Vercel and redeploy.`;
  return `Bot not connected yet. Send this fingerprint to Claude (safe to share):\n${t.sha256Hex}`;
}

function sameSecret(given: string | null, expected: string): boolean {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

const reply = (status: number, body: unknown) => Response.json(body, { status });

export async function webhook(request: Request, cfg: WebhookConfig | null, deps: Deps): Promise<Response> {
  // Not configured is not "open": every request is refused.
  if (!cfg || cfg.secret.length < 16 || !Number.isSafeInteger(cfg.ownerId))
    return reply(503, { ok: false, error: 'not_configured' });
  if (!sameSecret(request.headers.get('x-telegram-bot-api-secret-token'), cfg.secret))
    return reply(401, { ok: false, error: 'unauthorized' });

  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > MAX_UPDATE_BYTES) return reply(200, { ok: true });
  const text = await request.text();
  if (Buffer.byteLength(text, 'utf8') > MAX_UPDATE_BYTES) return reply(200, { ok: true });

  let update: unknown;
  try {
    update = JSON.parse(text);
  } catch {
    return reply(200, { ok: true });
  }

  const incoming = parseUpdate(update, cfg.ownerId);
  if (incoming.kind === 'ignore') return reply(200, { ok: true });
  // A redelivered update must not act twice (a retried save would be a double save).
  const updateId = (update as { update_id?: unknown }).update_id;
  if (typeof updateId === 'number' && Number.isSafeInteger(updateId)) {
    const seen: Record<string, unknown> = await deps
      .rpc('bot_seen_update', { p_id: updateId })
      .catch(() => ({ ok: false, fresh: true }));
    if (seen.ok && seen.fresh === false) return reply(200, { ok: true });
    if (seen.error === 'unauthorized' && cfg.dbToken) {
      await deps.send(incoming.chatId, { text: notRegisteredText(cfg.dbToken), buttons: [] }).catch(() => undefined);
      return reply(200, { ok: true });
    }
  }
  try {
    await handleIncoming(deps, incoming);
  } catch {
    // Already acknowledged to Telegram below; say so to Scott if we can.
    const chatId = incoming.chatId;
    await deps
      .send(chatId, { text: 'Something went wrong — check what was saved.', buttons: [] })
      .catch(() => undefined);
  }
  return reply(200, { ok: true });
}
