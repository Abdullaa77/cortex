import { bearer, callRpc, json } from '@/lib/ops/door';

/**
 * The wait behind a band-3 row is over (018). Append-only: records
 * ops_intent_resolutions, never touches the run. Idempotent — a second call
 * answers duplicate.
 *
 * POST { run_id, reason } → 200 { ok, run_id, duplicate } · 401 · 404 · 422 · 503.
 * reason: moved_on | superseded | session_exited | manual.
 */

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RESOLUTION_REASONS = ['moved_on', 'superseded', 'session_exited', 'manual'] as const;

export async function POST(request: Request) {
  const token = bearer(request);
  if (!token) return json(401, { ok: false, error: 'unauthorized' });
  let body: Record<string, unknown> | null;
  try {
    body = JSON.parse(await request.text());
  } catch {
    return json(400, { ok: false, error: 'not JSON' });
  }
  const errors: string[] = [];
  const runId = body?.run_id;
  const reason = body?.reason;
  if (typeof runId !== 'string' || !UUID.test(runId)) errors.push('$.run_id: must be a uuid');
  if (!RESOLUTION_REASONS.includes(reason as (typeof RESOLUTION_REASONS)[number]))
    errors.push(`$.reason: must be one of ${RESOLUTION_REASONS.join('|')}`);
  if (errors.length) return json(422, { ok: false, errors });

  const r = await callRpc<{ ok: boolean; duplicate?: boolean; error?: string }>('ops_intent_resolve', {
    p_token: token,
    p_run_id: runId,
    p_reason: reason,
  });
  if (!r.ok) return r.response;
  const d = r.data;
  if (d.ok) return json(200, { ok: true, run_id: runId, duplicate: d.duplicate });
  if (d.error === 'unauthorized') return json(401, { ok: false, error: 'unauthorized' });
  if (d.error === 'not_found') return json(404, { ok: false, error: 'not_found' });
  return json(422, { ok: false, errors: [`database: ${d.error}`] });
}
