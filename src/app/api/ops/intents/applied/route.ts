import { confirmRoute } from '@/lib/ops/door';

/**
 * The daemon's confirm (CORTEX-INTENTS §6.5 — write-witness, not state-diff).
 *
 * Called only AFTER the daemon has seen the session record the answer in its
 * own transcript. Writing to the socket is not enough: a write that nobody
 * read must leave the row pending, visibly, on the board. A question whose
 * session parked is refused (409) — its destination is the wave note.
 *
 * POST { id } → 200 { ok, id, duplicate } · 401 · 404 · 409 · 422 · 503.
 */

export const dynamic = 'force-dynamic';

export const POST = (request: Request) => confirmRoute(request, 'ops_intent_applied', 'id', 'p_id');
