import { bearer, callRpc, json } from '@/lib/ops/door';

/**
 * The daemon's read for resolution (018): unresolved intent_request rows in
 * the board's 24h window. The daemon checks each one's session on the box —
 * moved on, superseded, or exited — and reports back through /resolved.
 *
 * GET → 200 { ok, open: [{ run_id, session_id, trigger, asked_at }] } · 401 · 503.
 */

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const token = bearer(request);
  if (!token) return json(401, { ok: false, error: 'unauthorized' });
  const r = await callRpc<{ ok: boolean; error?: string; open?: unknown[] }>('ops_intents_open', { p_token: token });
  if (!r.ok) return r.response;
  if (!r.data.ok) return json(r.data.error === 'unauthorized' ? 401 : 422, { ok: false, error: r.data.error });
  return json(200, { ok: true, open: r.data.open ?? [] });
}
