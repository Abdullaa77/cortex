import type { PendingIntent } from '@/lib/ops/contract';
import { bearer, callRpc, json } from '@/lib/ops/door';

/**
 * The daemon's read (CORTEX-INTENTS §2, §9 step 4; contract §5c).
 *
 * THE DAEMON PULLS; CORTEX NEVER REACHES IN. The dev-box daemon polls this
 * with the same ingest token the producers hold — no new secret, nothing new
 * in Vercel. `ops_intents_pending` (015) checks the token and returns the
 * owner's pending answers, oldest first, capped at 50. No cwd, ever: the
 * daemon finds each session's socket from session_id on the box itself.
 *
 * 200 { ok, intents } · 401 unauthorized · 503 database_unreachable.
 */

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const token = bearer(request);
  if (!token) return json(401, { ok: false, error: 'unauthorized' });

  const r = await callRpc<{ ok: boolean; error?: string; intents?: PendingIntent[] }>('ops_intents_pending', {
    p_token: token,
  });
  if (!r.ok) return r.response;
  if (!r.data.ok) return json(r.data.error === 'unauthorized' ? 401 : 422, { ok: false, error: r.data.error });
  return json(200, { ok: true, intents: r.data.intents ?? [] });
}
