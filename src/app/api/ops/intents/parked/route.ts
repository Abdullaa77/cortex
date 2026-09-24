import { confirmRoute } from '@/lib/ops/door';

/**
 * The daemon: the session's transcript shows it received the park message
 * (write-witness). Records ops_intent_parks (017). Refused (409) when Scott
 * answered in the meantime, when it is under 60 minutes, or when the
 * question is not a blocked decision.
 *
 * POST { run_id } → 200 { ok, run_id, duplicate } · 401 · 404 · 409 · 422 · 503.
 */

export const dynamic = 'force-dynamic';

export const POST = (request: Request) => confirmRoute(request, 'ops_intent_park', 'run_id', 'p_run_id');
