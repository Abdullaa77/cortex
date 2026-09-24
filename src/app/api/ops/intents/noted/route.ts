import { confirmRoute } from '@/lib/ops/door';

/**
 * The daemon: an answer to a PARKED question is in the wave note — written
 * through the wave CLI and read back. Moves ops_intents pending → parked
 * (017). Refused (409) when the session never parked.
 *
 * POST { id } → 200 { ok, id, duplicate } · 401 · 404 · 409 · 422 · 503.
 */

export const dynamic = 'force-dynamic';

export const POST = (request: Request) => confirmRoute(request, 'ops_intent_noted', 'id', 'p_id');
