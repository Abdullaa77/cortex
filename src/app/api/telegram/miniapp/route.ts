import { checkInitData } from '@/lib/telegram/initdata';

/**
 * POST /api/telegram/miniapp {initData} — "is this webview really Telegram, and
 * really the owner?". Behind the normal Supabase session (middleware does NOT
 * exempt it): the login is the first lock, this signature check the second.
 */
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const { TELEGRAM_BOT_TOKEN, TELEGRAM_OWNER_ID } = process.env;
  let initData: unknown;
  try {
    initData = (await request.json())?.initData;
  } catch {
    return Response.json({ ok: false, reason: 'malformed' }, { status: 400 });
  }
  const r = checkInitData(
    typeof initData === 'string' ? initData : '',
    TELEGRAM_BOT_TOKEN ?? '',
    Number(TELEGRAM_OWNER_ID),
    new Date()
  );
  if (r.ok) return Response.json({ ok: true });
  return Response.json({ ok: false, reason: r.reason }, { status: r.reason === 'not_configured' ? 503 : 403 });
}
