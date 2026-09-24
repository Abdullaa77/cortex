import { bearer, callRpc, json } from '@/lib/ops/door';

/**
 * The daemon's confirm (CORTEX-INTENTS §6.5 — write-witness, not state-diff).
 *
 * Called only AFTER the daemon has seen the session record the answer in its
 * own transcript. Writing to the socket is not enough: a write that nobody
 * read must leave the row pending, visibly, on the board.
 *
 * POST { id } → 200 { ok, id, duplicate } · 401 · 404 not_found ·
 * 409 invalid_transition (e.g. parked) · 422 bad body · 503.
 */

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  const token = bearer(request);
  if (!token) return json(401, { ok: false, error: 'unauthorized' });

  let body: unknown;
  try {
    body = JSON.parse(await request.text());
  } catch {
    return json(400, { ok: false, error: 'not JSON' });
  }
  const id = (body as { id?: unknown } | null)?.id;
  if (typeof id !== 'string' || !UUID.test(id)) return json(422, { ok: false, errors: ['$.id: must be a uuid'] });

  const r = await callRpc<{ ok: boolean; id?: string; duplicate?: boolean; error?: string; detail?: string }>(
    'ops_intent_applied',
    { p_token: token, p_id: id }
  );
  if (!r.ok) return r.response;
  const d = r.data;
  if (d.ok) return json(200, { ok: true, id: d.id, duplicate: d.duplicate });
  switch (d.error) {
    case 'unauthorized':
      return json(401, { ok: false, error: 'unauthorized' });
    case 'not_found':
      return json(404, { ok: false, error: 'not_found' });
    case 'invalid_transition':
      return json(409, { ok: false, error: 'invalid_transition', detail: d.detail });
    default:
      return json(422, { ok: false, errors: [`database: ${d.error}`] });
  }
}
