-- @sentinel: table ops_intent_parks
-- ============================================
-- CORTEX — Command Centre: the 60-minute park path (017)
-- ============================================
-- Spec: Brain/04-Claude/Bus/CORTEX-INTENTS.md §4, §9 step 5.
--
-- A session blocked on a DECISION for 60 minutes with no answer parks itself:
-- sets its wave's waiting_on_scott to name the question, `wave park`s,
-- releases its claim, stops. The session cannot time itself out while it
-- waits, so the dev-box daemon wakes it with a park message — and records
-- here, only after the session's own transcript shows it received that
-- message (write-witness), that it was told. The wave's parked state itself
-- is the waves push's job; Supabase never becomes a writer to a wave note.
--
-- When Scott answers a parked question the answer is not written to the
-- session (it released its claim); the daemon writes it to the wave note
-- through the wave CLI, reads it back, and only then moves the ops_intents
-- row pending → parked. "No undeliverable state" (§4): an answer is never
-- thrown away, it just changes destination.
--
-- Additive to 013–016 except two replaced functions: ops_intents_pending
-- (carries `parked_at`, so the daemon knows the destination) and
-- ops_intent_applied (refuses a parked question).

CREATE TABLE IF NOT EXISTS public.ops_intent_parks (
  run_id    UUID PRIMARY KEY REFERENCES public.ops_runs(run_id) ON DELETE RESTRICT,
  user_id   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  parked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.ops_intent_parks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ops_intent_parks readable by owner" ON public.ops_intent_parks;
CREATE POLICY "ops_intent_parks readable by owner" ON public.ops_intent_parks
  FOR SELECT USING (auth.uid() = user_id);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.ops_intent_parks FROM anon, authenticated';
  END IF;
END $$;

-- A park record is a fact about the past: written once, never changed.
CREATE OR REPLACE FUNCTION ops_private.ops_intent_parks_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'ops_intent_parks is append-only' USING ERRCODE = 'check_violation';
END
$$;

DROP TRIGGER IF EXISTS ops_intent_parks_append_only ON public.ops_intent_parks;
CREATE TRIGGER ops_intent_parks_append_only
  BEFORE UPDATE OR DELETE ON public.ops_intent_parks
  FOR EACH ROW EXECUTE FUNCTION ops_private.ops_intent_parks_guard();

-- What counts as WAITING on a decision (the only thing that parks): a
-- Notification-sourced intent_request whose wait_state is blocked (rows from
-- before the wait_state amendment derive it — idle_prompt is idle, anything
-- else blocked), with no answer and no park yet. A permission prompt never
-- parks this way (the socket cannot reach a session sitting in a dialog); an
-- idle row finished its turn and is waiting on nothing.
CREATE OR REPLACE FUNCTION ops_private.intent_is_waiting_decision(p_payload JSONB)
RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE
SET search_path = ''
AS $$
  SELECT p_payload ->> 'trigger' = 'notification'
     AND coalesce(p_payload ->> 'wait_state',
                  CASE WHEN p_payload ->> 'notification_type' = 'idle_prompt' THEN 'idle' ELSE 'blocked' END) = 'blocked'
$$;

-- ── The daemon: which waiting questions are past 60 minutes ──────────────────
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
             ORDER BY r.payload ->> 'asked_at'
             LIMIT 50) x
  ), '[]'::jsonb));
END
$$;

-- ── The daemon: the session received the park message ──────────────────────
CREATE OR REPLACE FUNCTION public.ops_intent_park(p_token TEXT, p_run_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user    UUID := ops_private.token_user(p_token);
  v_payload JSONB;
BEGIN
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
  END IF;
  SELECT r.payload INTO v_payload
    FROM public.ops_runs r
   WHERE r.run_id = p_run_id AND r.user_id = v_user AND r.kind = 'intent_request';
  IF v_payload IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;
  IF EXISTS (SELECT 1 FROM public.ops_intent_parks WHERE run_id = p_run_id) THEN
    RETURN jsonb_build_object('ok', true, 'run_id', p_run_id, 'duplicate', true);
  END IF;
  IF NOT ops_private.intent_is_waiting_decision(v_payload) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_parkable', 'detail', 'only a blocked, notification-sourced question parks');
  END IF;
  -- Scott answered in the window between the daemon's read and this write:
  -- the answer wins, the park is not recorded.
  IF EXISTS (SELECT 1 FROM public.ops_intents WHERE run_id = p_run_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'answered');
  END IF;
  IF (v_payload ->> 'asked_at')::timestamptz > now() - interval '60 minutes' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'too_early');
  END IF;
  INSERT INTO public.ops_intent_parks (run_id, user_id) VALUES (p_run_id, v_user);
  RETURN jsonb_build_object('ok', true, 'run_id', p_run_id, 'duplicate', false);
END
$$;

-- ── The daemon: an answer to a parked question reached the wave note ────────
CREATE OR REPLACE FUNCTION public.ops_intent_noted(p_token TEXT, p_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user   UUID := ops_private.token_user(p_token);
  v_status TEXT;
  v_run    UUID;
BEGIN
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
  END IF;
  SELECT status, run_id INTO v_status, v_run FROM public.ops_intents WHERE id = p_id AND user_id = v_user FOR UPDATE;
  IF v_status IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;
  IF v_status = 'parked' THEN
    RETURN jsonb_build_object('ok', true, 'id', p_id, 'duplicate', true);
  END IF;
  IF v_status <> 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_transition', 'detail', v_status || ' → parked');
  END IF;
  -- The note is the destination only for a question whose session parked.
  IF NOT EXISTS (SELECT 1 FROM public.ops_intent_parks WHERE run_id = v_run) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_parked', 'detail', 'the session never parked — the answer goes to the session');
  END IF;
  UPDATE public.ops_intents SET status = 'parked' WHERE id = p_id;
  RETURN jsonb_build_object('ok', true, 'id', p_id, 'duplicate', false);
END
$$;

-- Replaced from 015: once a question parked, its session released its claim,
-- so "applied" (delivered to the session) is refused — the note is the
-- destination (ops_intent_noted). The daemon checks this too; this is the
-- floor under it.
CREATE OR REPLACE FUNCTION public.ops_intent_applied(p_token TEXT, p_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user   UUID := ops_private.token_user(p_token);
  v_status TEXT;
  v_run    UUID;
BEGIN
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
  END IF;
  SELECT status, run_id INTO v_status, v_run FROM public.ops_intents WHERE id = p_id AND user_id = v_user FOR UPDATE;
  IF v_status IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;
  IF v_status = 'applied' THEN
    RETURN jsonb_build_object('ok', true, 'id', p_id, 'duplicate', true);
  END IF;
  IF v_status <> 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_transition', 'detail', v_status || ' → applied');
  END IF;
  IF EXISTS (SELECT 1 FROM public.ops_intent_parks WHERE run_id = v_run) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_transition', 'detail', 'the session parked — deliver to the wave note');
  END IF;
  UPDATE public.ops_intents SET status = 'applied', applied_at = now() WHERE id = p_id;
  RETURN jsonb_build_object('ok', true, 'id', p_id, 'duplicate', false);
END
$$;

-- Replaced from 016 to carry parked_at (null = deliver to the session).
CREATE OR REPLACE FUNCTION public.ops_intents_pending(p_token TEXT)
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
  RETURN jsonb_build_object('ok', true, 'intents', coalesce((
    SELECT jsonb_agg(jsonb_build_object(
             'id', i.id, 'run_id', i.run_id, 'session_id', i.session_id, 'wave_slug', i.wave_slug,
             'decision', i.decision, 'question', i.question, 'question_truncated', i.question_truncated,
             'options', i.options, 'asked_at', i.asked_at, 'answer', i.answer, 'answered_at', i.answered_at,
             'parked_at', k.parked_at)
           ORDER BY i.answered_at)
      FROM (SELECT * FROM public.ops_intents
             WHERE user_id = v_user AND status = 'pending'
             ORDER BY answered_at LIMIT 50) i
      LEFT JOIN public.ops_intent_parks k ON k.run_id = i.run_id
  ), '[]'::jsonb));
END
$$;

REVOKE ALL ON FUNCTION public.ops_intents_overdue(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ops_intent_park(TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ops_intent_noted(TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ops_intents_pending(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ops_intent_applied(TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION ops_private.ops_intent_parks_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION ops_private.intent_is_waiting_decision(JSONB) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    -- Token-checked, like ingest: the daemon holds only the anon key + the ingest token.
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.ops_intents_overdue(TEXT) TO anon, authenticated';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.ops_intent_park(TEXT, UUID) TO anon, authenticated';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.ops_intent_noted(TEXT, UUID) TO anon, authenticated';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.ops_intents_pending(TEXT) TO anon, authenticated';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.ops_intent_applied(TEXT, UUID) TO anon, authenticated';
  END IF;
END $$;
