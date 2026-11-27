import { makeDeps } from '@/lib/telegram/api';
import { isJob, runJob, sameBearer } from '@/lib/telegram/cron';

/**
 * Called by Supabase pg_cron/pg_net (Vercel Hobby cron is hour-imprecise):
 * POST /api/telegram/cron?job=dayclose|due|snooze with the bearer secret.
 * No session (src/middleware.ts exempts it); the secret is the only way in.
 */
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const { TELEGRAM_BOT_TOKEN, TELEGRAM_OWNER_ID, CORTEX_BOT_DB_TOKEN, CORTEX_CRON_SECRET } = process.env;
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_OWNER_ID || !CORTEX_BOT_DB_TOKEN || !CORTEX_CRON_SECRET)
    return Response.json({ ok: false, error: 'not_configured' }, { status: 503 });
  if (!sameBearer(request.headers.get('authorization'), CORTEX_CRON_SECRET))
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 });

  const job = new URL(request.url).searchParams.get('job');
  if (!isJob(job)) return Response.json({ ok: false, error: 'unknown_job' }, { status: 422 });
  const chatId = Number(TELEGRAM_OWNER_ID);
  if (!Number.isSafeInteger(chatId)) return Response.json({ ok: false, error: 'not_configured' }, { status: 503 });

  try {
    const r = await runJob(job, makeDeps({ botToken: TELEGRAM_BOT_TOKEN, dbToken: CORTEX_BOT_DB_TOKEN }), chatId);
    return Response.json({ ok: true, job, ...r });
  } catch (e) {
    // The message is ours (a step name), never a URL or a token.
    return Response.json({ ok: false, error: e instanceof Error ? e.message : 'failed' }, { status: 502 });
  }
}
