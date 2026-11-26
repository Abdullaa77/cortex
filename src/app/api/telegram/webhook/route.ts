import { makeDeps } from '@/lib/telegram/api';
import { webhook } from '@/lib/telegram/webhook';

/**
 * Telegram's door. NO SESSION: src/middleware.ts exempts this path because
 * Telegram has no cookie. It is protected by the secret header set with
 * setWebhook, the owner-id check, and the database token (migration 021).
 * Env: TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, TELEGRAM_OWNER_ID, BOT_DB_TOKEN.
 */
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const { TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, TELEGRAM_OWNER_ID, BOT_DB_TOKEN } = process.env;
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_WEBHOOK_SECRET || !TELEGRAM_OWNER_ID || !BOT_DB_TOKEN)
    return Response.json({ ok: false, error: 'not_configured' }, { status: 503 });
  return webhook(
    request,
    { secret: TELEGRAM_WEBHOOK_SECRET, ownerId: Number(TELEGRAM_OWNER_ID) },
    makeDeps({ botToken: TELEGRAM_BOT_TOKEN, dbToken: BOT_DB_TOKEN })
  );
}
