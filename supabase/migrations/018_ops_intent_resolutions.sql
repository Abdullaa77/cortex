-- @sentinel: table ops_intent_resolutions
-- ============================================
-- CORTEX — Command Centre: band 3 shows only what is true right now (018)
-- ============================================
-- A band-3 row is a session waiting on Scott. Until now nothing ever said the
-- wait was over, so a row stayed for its whole 24h window: last night's test
-- rows sat on the board while real sessions had long moved on.
--
-- The dev-box daemon now watches each open row's session (Claude Code's own
-- session registry + the session's transcript) and records here the moment
-- the wait ended:
--   moved_on        the session took a new turn after the row was raised —
--                   answered at the terminal, the next tool ran, a new prompt
--   superseded      the same session raised a newer row
--   session_exited  the session is no longer running
--   manual          resolved by hand (the 2026-09-24 test rows)
--
-- APPEND-ONLY, like every ops table: a resolution is a fact about the past,
-- written once, never changed or removed; the intent_request run itself is
-- never touched. The board hides a resolved row — unless Scott's answer to it
-- is still pending delivery, which stays visible so it is never lost.
--
-- Additive to 013–017 except one replaced function: ops_intents_overdue
-- (a resolved row is not waiting, so it never parks).

CREATE TABLE IF NOT EXISTS public.ops_intent_resolutions (
  run_id      UUID PRIMARY KEY REFERENCES public.ops_runs(run_id) ON DELETE RESTRICT,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reason      TEXT NOT NULL CHECK (reason IN ('moved_on', 'superseded', 'session_exited', 'manual')),
  resolved_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.ops_intent_resolutions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ops_intent_resolutions readable by owner" ON public.ops_intent_resolutions;
CREATE POLICY "ops_intent_resolutions readable by owner" ON public.ops_intent_resolutions
  FOR SELECT USING (auth.uid() = user_id);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.ops_intent_resolutions FROM anon, authenticated';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION ops_private.ops_intent_resolutions_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'ops_intent_resolutions is append-only' USING ERRCODE = 'check_violation';
END
$$;

DROP TRIGGER IF EXISTS ops_intent_resolutions_append_only ON public.ops_intent_resolutions;
CREATE TRIGGER ops_intent_resolutions_append_only
  BEFORE UPDATE OR DELETE ON public.ops_intent_resolutions
  FOR EACH ROW EXECUTE FUNCTION ops_private.ops_intent_resolutions_guard();

-- ── The daemon: which rows are still open ────────────────────────────────────
-- Same 24h window the board shows. session_id + asked_at + trigger is all the
-- daemon needs to look the session up on the box.
CREATE OR REPLACE FUNCTION public.ops_intents_open(p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user UUID := ops_private.token_user(p_token);
BEGIN
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
  END IF;
  RETURN jsonb_build_object('ok', true, 'open', coalesce((
    SELECT jsonb_agg(jsonb_build_object(
             'run_id', x.run_id, 'session_id', x.payload ->> 'session_id',
             'trigger', x.payload ->> 'trigger', 'asked_at', x.payload ->> 'asked_at')
           ORDER BY x.payload ->> 'asked_at')
      FROM (SELECT r.run_id, r.payload
              FROM public.ops_runs r
             WHERE r.user_id = v_user
               AND r.kind = 'intent_request'
               AND (r.payload ->> 'asked_at')::timestamptz > now() - interval '24 hours'
               AND NOT EXISTS (SELECT 1 FROM public.ops_intent_resolutions z WHERE z.run_id = r.run_id)
             ORDER BY r.payload ->> 'asked_at' DESC
             LIMIT 100) x
  ), '[]'::jsonb));
END
$$;

-- ── The daemon (or Scott, by hand): the wait is over ─────────────────────────
CREATE OR REPLACE FUNCTION public.ops_intent_resolve(p_token TEXT, p_run_id UUID, p_reason TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user UUID := ops_private.token_user(p_token);
BEGIN
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
  END IF;
  IF p_reason IS NULL OR p_reason NOT IN ('moved_on', 'superseded', 'session_exited', 'manual') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid', 'detail', 'reason');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ops_runs r
                  WHERE r.run_id = p_run_id AND r.user_id = v_user AND r.kind = 'intent_request') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;
  INSERT INTO public.ops_intent_resolutions (run_id, user_id, reason)
  VALUES (p_run_id, v_user, p_reason)
  ON CONFLICT (run_id) DO NOTHING;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', true, 'run_id', p_run_id, 'duplicate', true);
  END IF;
  RETURN jsonb_build_object('ok', true, 'run_id', p_run_id, 'duplicate', false);
END
$$;

-- Replaced from 017: a resolved row is waiting on nothing, so it never parks.
CREATE OR REPLACE FUNCTION public.ops_intents_overdue(p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user UUID := ops_private.token_user(p_token);
BEGIN
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
  END IF;
  RETURN jsonb_build_object('ok', true, 'overdue', coalesce((
    SELECT jsonb_agg(jsonb_build_object(
             'run_id', x.run_id, 'session_id', x.payload ->> 'session_id',
             'question', x.payload ->> 'question',
             'question_truncated', coalesce((x.payload ->> 'question_truncated')::boolean, false),
             'asked_at', x.payload ->> 'asked_at')
           ORDER BY x.payload ->> 'asked_at')
      FROM (SELECT r.run_id, r.payload
              FROM public.ops_runs r
             WHERE r.user_id = v_user
               AND r.kind = 'intent_request'
               AND ops_private.intent_is_waiting_decision(r.payload)
               AND (r.payload ->> 'asked_at')::timestamptz <= now() - interval '60 minutes'
               AND (r.payload ->> 'asked_at')::timestamptz >  now() - interval '24 hours'
               AND NOT EXISTS (SELECT 1 FROM public.ops_intents i WHERE i.run_id = r.run_id)
               AND NOT EXISTS (SELECT 1 FROM public.ops_intent_parks k WHERE k.run_id = r.run_id)
               AND NOT EXISTS (SELECT 1 FROM public.ops_intent_resolutions z WHERE z.run_id = r.run_id)
             ORDER BY r.payload ->> 'asked_at'
             LIMIT 50) x
  ), '[]'::jsonb));
END
$$;

REVOKE ALL ON FUNCTION public.ops_intents_open(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ops_intent_resolve(TEXT, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ops_intents_overdue(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION ops_private.ops_intent_resolutions_guard() FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION ops_private.ops_intent_resolutions_guard() FROM anon, authenticated';
    -- Token-checked, like ingest: the daemon holds only the anon key + the ingest token.
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.ops_intents_open(TEXT) TO anon, authenticated';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.ops_intent_resolve(TEXT, UUID, TEXT) TO anon, authenticated';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.ops_intents_overdue(TEXT) TO anon, authenticated';
  END IF;
END $$;
