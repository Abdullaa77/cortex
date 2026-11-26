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
