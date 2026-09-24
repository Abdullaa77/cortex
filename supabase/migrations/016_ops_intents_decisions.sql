-- @sentinel: column ops_intents.decision
-- ============================================
-- CORTEX — Command Centre: the queue carries DECISIONS, never AUTHORIZATIONS (016)
-- ============================================
-- Spec: Brain/04-Claude/Bus/CORTEX-INTENTS.md §3 (Scott's ruling 2026-09-24).
--
-- 015 made every answer name a stop-list item (1–7). Scott's ruling: the
-- stop-list items are AUTHORIZATIONS — merge to master, money, prod data,
-- permissions, deletes — and an authorization never travels through this
-- queue. He gives those up front as conditions in the prompt, or in person in
-- the session; a session that needs one it was not given parks, with that as
-- the reason. What the queue carries is DECISIONS:
--
--   choose            — pick between options the session laid out
--   park_or_continue  — stop here, or keep going
--   clarify           — say what was meant
--
-- So `stop_item` is replaced by `decision`, and ops_intent_answer refuses
-- anything else by name ('authorization' gets its own refusal so the UI can
-- say "needs you in the session").
--
-- Why not edit 015 in place: 015 is applied to the live project. This file
-- reshapes it. The reshape drops a column, so it FAILS CLOSED if ops_intents
-- holds any row — measured empty on the live project before this was written;
-- if that ever stops being true, this refuses rather than guess a mapping from
-- stop-list items to decision kinds.
--
-- Every other 015 guard is restated, not assumed: SECURITY DEFINER, empty
-- search_path, the append-only trigger (whose column list named stop_item),
-- and the explicit anon REVOKE on the answer function (Supabase's default
-- privileges grant it; REVOKE … FROM PUBLIC does not undo that).

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.ops_intents) THEN
    RAISE EXCEPTION '016 refuses: ops_intents is not empty, and a stop_item → decision mapping is a judgement, not a migration';
  END IF;
END $$;

ALTER TABLE public.ops_intents DROP COLUMN IF EXISTS stop_item;
ALTER TABLE public.ops_intents ADD COLUMN IF NOT EXISTS decision TEXT NOT NULL
  CHECK (decision IN ('choose', 'park_or_continue', 'clarify'));

CREATE OR REPLACE FUNCTION ops_private.ops_intents_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'ops_intents is append-only: a decision Scott made is never deleted'
      USING ERRCODE = 'check_violation';
  END IF;
  IF (NEW.id, NEW.user_id, NEW.run_id, NEW.session_id, NEW.wave_slug, NEW.decision, NEW.question,
      NEW.question_truncated, NEW.options, NEW.asked_at, NEW.answer, NEW.answered_at)
     IS DISTINCT FROM
     (OLD.id, OLD.user_id, OLD.run_id, OLD.session_id, OLD.wave_slug, OLD.decision, OLD.question,
      OLD.question_truncated, OLD.options, OLD.asked_at, OLD.answer, OLD.answered_at) THEN
    RAISE EXCEPTION 'ops_intents is append-only: only status moves, forward'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NOT (OLD.status = 'pending' AND NEW.status IN ('applied', 'parked')) THEN
    RAISE EXCEPTION 'ops_intents: % → % is not a forward step', OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

DROP FUNCTION IF EXISTS public.ops_intent_answer(UUID, INT, TEXT);

CREATE OR REPLACE FUNCTION public.ops_intent_answer(p_run_id UUID, p_decision TEXT, p_answer TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user    UUID := auth.uid();
  v_payload JSONB;
  v_id      UUID;
BEGIN
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
  END IF;
  IF p_decision = 'authorization' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'authorization',
      'detail', 'an authorization is never given through the queue — it needs you in the session');
  END IF;
  IF p_decision IS NULL OR p_decision NOT IN ('choose', 'park_or_continue', 'clarify') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_a_decision',
      'detail', 'decision must be choose | park_or_continue | clarify');
  END IF;
  IF p_answer IS NULL OR char_length(btrim(p_answer)) = 0 OR char_length(p_answer) > 1000 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid', 'detail', 'answer: 1–1000 characters');
  END IF;

  SELECT r.payload INTO v_payload
    FROM public.ops_runs r
   WHERE r.run_id = p_run_id AND r.user_id = v_user AND r.kind = 'intent_request';
  IF v_payload IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;
  IF v_payload ->> 'trigger' = 'permission_request' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_answerable',
      'detail', 'a permission prompt is answered in the terminal; the socket cannot click it');
  END IF;

  BEGIN
    INSERT INTO public.ops_intents
      (user_id, run_id, session_id, wave_slug, decision, question, question_truncated, options, asked_at, answer)
    VALUES (
      v_user, p_run_id,
      v_payload ->> 'session_id',
      v_payload ->> 'wave_slug',
      p_decision,
      v_payload ->> 'question',
      coalesce((v_payload ->> 'question_truncated')::boolean, false),
      CASE WHEN jsonb_typeof(v_payload -> 'options') = 'array' THEN v_payload -> 'options' END,
      (v_payload ->> 'asked_at')::timestamptz,
      p_answer
    )
    RETURNING id INTO v_id;
  EXCEPTION
    WHEN unique_violation THEN
      RETURN jsonb_build_object('ok', false, 'error', 'already_answered');
    WHEN check_violation OR not_null_violation OR invalid_text_representation OR invalid_datetime_format THEN
      RETURN jsonb_build_object('ok', false, 'error', 'invalid', 'detail', SQLERRM);
  END;

  RETURN jsonb_build_object('ok', true, 'id', v_id);
END
$$;

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
             'options', i.options, 'asked_at', i.asked_at, 'answer', i.answer, 'answered_at', i.answered_at)
           ORDER BY i.answered_at)
      FROM (SELECT * FROM public.ops_intents
             WHERE user_id = v_user AND status = 'pending'
             ORDER BY answered_at LIMIT 50) i
  ), '[]'::jsonb));
END
$$;

REVOKE ALL ON FUNCTION public.ops_intent_answer(UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ops_intents_pending(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION ops_private.ops_intents_guard() FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.ops_intent_answer(UUID, TEXT, TEXT) FROM anon';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.ops_intent_answer(UUID, TEXT, TEXT) TO authenticated';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.ops_intents_pending(TEXT) TO anon, authenticated';
  END IF;
END $$;
