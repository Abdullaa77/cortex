-- @sentinel: table ops_intents
-- ============================================
-- CORTEX — Command Centre: the return path (ops_intents, 015)
-- ============================================
-- Spec: Brain/04-Claude/Bus/CORTEX-INTENTS.md §3, §5, §9 steps 3–4.
-- Contract: Brain/04-Claude/Handoffs/2026-09-23-command-centre-ingest-contract.md §5c.
--
-- A session blocks → intent_request run (013/014) → band 3. Scott answers →
-- ONE row here, status 'pending'. The dev-box daemon pulls pending rows with
-- the same ingest token, writes the answer to that session's messaging
-- socket, watches the session record it, and marks the row 'applied'.
--
-- Purely additive. 013/014 are not touched: ops_runs, ops_ingest() and
-- forbidden_key() are exactly as they were.
--
-- Shape decisions (each one is load-bearing):
--
-- 1. 'waiting' IS NOT STORED. §5 lists waiting → pending → applied/parked. The
--    waiting state already has a row — the intent_request run itself. A row
--    here exists only once Scott has answered, so "waiting" is derived: an
--    intent_request run with no ops_intents row. Storing it would need
--    ops_ingest() to write here, and 013/014 stay untouched.
--
-- 2. §3 IS ENFORCED WHERE AN ANSWER ENTERS. Only the seven stop-list items may
--    enter the queue. Nothing in the hook payload says which item a question
--    falls under, so the answer must: `stop_item` 1–7 is NOT NULL. A question
--    that fits none of them has no way in — it belongs to a sandbox rule, a
--    hook or a brief's else-branch (§3), and the UI says so.
--
-- 3. A PERMISSION PROMPT IS NOT ANSWERABLE HERE. The daemon's only channel is
--    the session's messaging socket, which injects a user turn; it does not
--    click a permission dialog. ops_intent_answer() refuses trigger =
--    permission_request rather than store an answer that cannot arrive.
--
-- 4. APPEND-ONLY, WITH ONE FORWARD STEP. The answer, the question and the
--    reply-to never change once written. The only mutation is status moving
--    forward — pending → applied (daemon, this migration) or pending → parked
--    (§4, step 5; declared now so step 5 needs no schema change). A trigger
--    enforces it against every role, including the SECURITY DEFINER owner.
--    No DELETE, ever: "a decision Scott made is never thrown away" (§4).
--
-- 5. NO cwd, EVER (§5, contract §5b). The daemon finds the socket from the
--    session_id on the dev box. forbidden_key() is not consulted because
--    nothing here takes free-form JSON from a producer except `options`,
--    which is copied from an already-validated ops_runs payload (and today is
--    always null — producers send no choices yet).
--
-- Idempotent as far as CREATE … IF NOT EXISTS / OR REPLACE allow; the table
-- and trigger are created once. Paste once into the SQL editor.

CREATE TABLE IF NOT EXISTS public.ops_intents (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- The intent_request run this answers. One answer per question.
  run_id             UUID NOT NULL UNIQUE REFERENCES public.ops_runs(run_id) ON DELETE RESTRICT,
  -- The reply-to (§1). Same shape the contract enforces on the run.
  session_id         TEXT NOT NULL CHECK (session_id ~ '^[A-Za-z0-9_-]{1,128}$'),
  wave_slug          TEXT CHECK (char_length(wave_slug) <= 200),
  stop_item          SMALLINT NOT NULL CHECK (stop_item BETWEEN 1 AND 7),
  -- Copied from the run: its question (a Notification's message), capped 240
  -- upstream. Null when the run carried none.
  question           TEXT CHECK (char_length(question) <= 240),
  question_truncated BOOLEAN NOT NULL DEFAULT false,
  options            JSONB CHECK (options IS NULL OR jsonb_typeof(options) = 'array'),
  asked_at           TIMESTAMPTZ NOT NULL,
  answer             TEXT NOT NULL CHECK (char_length(btrim(answer)) >= 1 AND char_length(answer) <= 1000),
  answered_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  status             TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'applied', 'parked')),
  applied_at         TIMESTAMPTZ,
  CONSTRAINT ops_intents_applied_at_iff_applied CHECK ((status = 'applied') = (applied_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS ops_intents_pending ON public.ops_intents (user_id, status, answered_at);

ALTER TABLE public.ops_intents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ops_intents readable by owner" ON public.ops_intents;
CREATE POLICY "ops_intents readable by owner" ON public.ops_intents
  FOR SELECT USING (auth.uid() = user_id);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.ops_intents FROM anon, authenticated';
  END IF;
END $$;

-- Rule 4, enforced below every role. BEFORE UPDATE: only status may change,
-- and only pending → applied (stamping applied_at) or pending → parked.
-- BEFORE DELETE: never.
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
  IF (NEW.id, NEW.user_id, NEW.run_id, NEW.session_id, NEW.wave_slug, NEW.stop_item, NEW.question,
      NEW.question_truncated, NEW.options, NEW.asked_at, NEW.answer, NEW.answered_at)
     IS DISTINCT FROM
     (OLD.id, OLD.user_id, OLD.run_id, OLD.session_id, OLD.wave_slug, OLD.stop_item, OLD.question,
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

DROP TRIGGER IF EXISTS ops_intents_append_only ON public.ops_intents;
CREATE TRIGGER ops_intents_append_only
  BEFORE UPDATE OR DELETE ON public.ops_intents
  FOR EACH ROW EXECUTE FUNCTION ops_private.ops_intents_guard();

-- Same token check as ops_ingest() (013), as its own function so the two
-- daemon RPCs below cannot drift from each other. ops_ingest keeps its own
-- inline copy — 013/014 are not edited.
CREATE OR REPLACE FUNCTION ops_private.token_user(p_token TEXT)
RETURNS UUID
LANGUAGE sql STABLE
SET search_path = ''
AS $$
  SELECT t.user_id
    FROM ops_private.ingest_tokens t
   WHERE p_token IS NOT NULL AND length(p_token) >= 32
     AND t.token_hash = pg_catalog.sha256(convert_to(p_token, 'UTF8'))
     AND t.revoked_at IS NULL
$$;

-- ── Scott answers (browser, signed in) ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ops_intent_answer(p_run_id UUID, p_stop_item INT, p_answer TEXT)
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
  IF p_stop_item IS NULL OR p_stop_item NOT BETWEEN 1 AND 7 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_stop_list',
      'detail', 'name the stop-list item (1–7) this decision falls under — anything else is bounded environmentally, not queued');
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
      (user_id, run_id, session_id, wave_slug, stop_item, question, question_truncated, options, asked_at, answer)
    VALUES (
      v_user, p_run_id,
      v_payload ->> 'session_id',
      v_payload ->> 'wave_slug',
      p_stop_item,
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

-- ── The daemon pulls (dev box, ingest token) ────────────────────────────────
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
             'stop_item', i.stop_item, 'question', i.question, 'question_truncated', i.question_truncated,
             'options', i.options, 'asked_at', i.asked_at, 'answer', i.answer, 'answered_at', i.answered_at)
           ORDER BY i.answered_at)
      FROM (SELECT * FROM public.ops_intents
             WHERE user_id = v_user AND status = 'pending'
             ORDER BY answered_at LIMIT 50) i
  ), '[]'::jsonb));
END
$$;

-- The daemon confirms, AFTER the session recorded the answer (write-witness,
-- §6.5). Idempotent: confirming an applied row again is ok + duplicate.
CREATE OR REPLACE FUNCTION public.ops_intent_applied(p_token TEXT, p_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user   UUID := ops_private.token_user(p_token);
  v_status TEXT;
BEGIN
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
  END IF;
  SELECT status INTO v_status FROM public.ops_intents WHERE id = p_id AND user_id = v_user FOR UPDATE;
  IF v_status IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;
  IF v_status = 'applied' THEN
    RETURN jsonb_build_object('ok', true, 'id', p_id, 'duplicate', true);
  END IF;
  IF v_status <> 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_transition', 'detail', v_status || ' → applied');
  END IF;
  UPDATE public.ops_intents SET status = 'applied', applied_at = now() WHERE id = p_id;
  RETURN jsonb_build_object('ok', true, 'id', p_id, 'duplicate', false);
END
$$;

REVOKE ALL ON FUNCTION public.ops_intent_answer(UUID, INT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ops_intents_pending(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ops_intent_applied(TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION ops_private.token_user(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION ops_private.ops_intents_guard() FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    -- Answering needs a signed-in user (auth.uid()); anon gets nothing.
    -- Explicitly, because REVOKE … FROM PUBLIC does not undo Supabase's
    -- default-privilege grant to anon (measured on the live project: the
    -- first cut of this file left anon holding EXECUTE here).
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.ops_intent_answer(UUID, INT, TEXT) FROM anon';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.ops_intent_answer(UUID, INT, TEXT) TO authenticated';
    -- The daemon holds only the anon key + the ingest token, like the producers.
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.ops_intents_pending(TEXT) TO anon, authenticated';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.ops_intent_applied(TEXT, UUID) TO anon, authenticated';
  END IF;
END $$;
