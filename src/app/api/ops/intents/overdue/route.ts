import { bearer, callRpc, json } from '@/lib/ops/door';

/**
 * The daemon's read for the 60-minute park path (CORTEX-INTENTS §4, step 5).
 * Blocked decision questions with no answer and no park, asked 60 min – 24 h
 * ago. The threshold lives in the database (ops_intents_overdue, 017), not in
 * the daemon, so it cannot drift per box.
 *
 * GET → 200 { ok, overdue: [{ run_id, session_id, question, question_truncated, asked_at }] } · 401 · 503.
 */

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const token = bearer(request);
  if (!token) return json(401, { ok: false, error: 'unauthorized' });
  const r = await callRpc<{ ok: boolean; error?: string; overdue?: unknown[] }>('ops_intents_overdue', { p_token: token });
  if (!r.ok) return r.response;
  if (!r.data.ok) return json(r.data.error === 'unauthorized' ? 401 : 422, { ok: false, error: r.data.error });
  return json(200, { ok: true, overdue: r.data.overdue ?? [] });
}
