import { MAX_BODY_BYTES, validateEnvelope } from '@/lib/ops/contract';
import { anonClient, isUnreachable, json } from '@/lib/ops/door';

/**
 * The Command Centre's one write door. Contract v1:
 * Brain/04-Claude/Handoffs/2026-09-23-command-centre-ingest-contract.md
 *
 * NO SESSION, AND NO NEW SECRET. src/middleware.ts exempts this path — the
 * producers are scripts on the dev box and have no cookie to offer. The
 * bearer token is passed straight through to `ops_ingest` (migration 013),
 * which compares its sha256 against the one stored row and writes. This
 * route holds no key beyond the public anon key the whole app already ships,
 * so there is nothing here to leak that is not already public.
 *
 * It validates the whole contract and lists every error (422), so a producer
 * fixes everything in one round trip. The database re-checks the security
 * invariants itself, because the RPC is reachable without this route.
 *
 * "COULD NOT ASK" IS ITS OWN ANSWER. When Supabase does not answer — the free
 * tier pauses a project after 7 days idle, and Cortex sat paused for a week
 * with nobody noticing — this returns 503 `database_unreachable`, never a
 * generic 500 and never a success. The producer logs it; the board's
 * heartbeat goes STALE on its own.
 */

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > MAX_BODY_BYTES) return json(413, { ok: false, error: 'too_large' });

  const auth = request.headers.get('authorization') ?? '';
  const token = /^Bearer\s+(\S+)$/.exec(auth)?.[1];
  if (!token) return json(401, { ok: false, error: 'unauthorized' });

  const text = await request.text();
  if (Buffer.byteLength(text, 'utf8') > MAX_BODY_BYTES) return json(413, { ok: false, error: 'too_large' });

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return json(400, { ok: false, error: 'not JSON' });
  }
  if (typeof body !== 'object' || body === null || !('v' in body) || !('kind' in body))
    return json(400, { ok: false, error: 'missing v or kind' });

  const result = validateEnvelope(body, new Date());
  if (!result.ok) return json(422, { ok: false, errors: result.errors });

  const supabase = anonClient();

  let data: unknown;
  let error: { message?: string; code?: string; status?: number } | null;
  try {
    ({ data, error } = await supabase.rpc('ops_ingest', { p_token: token, p_envelope: result.envelope }));
  } catch (e) {
    error = { message: String(e) };
  }

  if (error) {
    if (isUnreachable(error)) return json(503, { ok: false, error: 'database_unreachable' });
    // The message is Postgres's, not ours — it may name internals. The code is enough to act on.
    return json(500, { ok: false, error: 'database_error', code: error.code ?? null });
  }

  const r = data as { ok: boolean; run_id?: string; duplicate?: boolean; error?: string; detail?: string };
  if (r.ok) return json(r.duplicate ? 200 : 202, { ok: true, run_id: r.run_id, duplicate: r.duplicate });

  switch (r.error) {
    case 'unauthorized':
      return json(401, { ok: false, error: 'unauthorized' });
    case 'too_large':
      return json(413, { ok: false, error: 'too_large' });
    default:
      // The route validated first, so reaching here means the two validators
      // disagree — say which one refused, so the drift is visible.
      return json(422, { ok: false, errors: [`database: ${r.error}${r.detail ? ` (${r.detail})` : ''}`] });
  }
}
