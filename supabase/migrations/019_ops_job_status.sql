-- @sentinel: unprobeable widens ops_runs.kind and forbidden_key; not visible via PostgREST —
--   no anon INSERT grant on ops_runs, and the RLS SELECT policy scopes to auth.uid(), so there
--   is nothing here a probe with the anon key could tell apart from 014's state.
-- ============================================
-- CORTEX — Command Centre: job_status kind (019)
-- ============================================
-- Contract: Brain/04-Claude/Handoffs/2026-09-23-command-centre-ingest-contract.md
-- §5d (2026-10-15, map lead-and-workers, ticket lw-4-job-card-feed). NEVER
-- edit 013 or 014 — they are applied to the live database. This widens them
-- in place, restating every guard 014 set (SECURITY DEFINER, SET search_path
-- = '', the REVOKE/GRANT pairs, append-only insert, 30-day waves retention).
--
--  1. `ops_runs.kind` and `ops_ingest()`'s own kind check accept `job_status`
--     (producer `job-card`): one Job card — status, a few sentences of
--     summary, Workers, tickets done/left — for the view-only Jobs screen.
--  2. `ops_private.forbidden_key` gains `transcript`, `tool_output` and
--     `tool_response`. A Job card's summary is made FROM a session transcript;
--     the transcript itself, and any tool's output, never reach this box.
--  3. job_status runs older than 7 days are deleted on each new one — the
--     card is pushed on every Stop, and only the latest per Job is shown.
--
-- Idempotent: safe to paste into the SQL editor more than once.

ALTER TABLE public.ops_runs DROP CONSTRAINT IF EXISTS ops_runs_kind_check;
ALTER TABLE public.ops_runs ADD CONSTRAINT ops_runs_kind_check
  CHECK (kind IN ('session_check', 'waves', 'gitlab', 'intent_request', 'job_status'));

CREATE OR REPLACE FUNCTION ops_private.forbidden_key(p_payload JSONB)
RETURNS TEXT
LANGUAGE sql IMMUTABLE
SET search_path = ''
AS $$
  SELECT k
    FROM unnest(ARRAY['body', 'note', 'content', 'markdown', 'worktree', 'chat', 'source_line', 'cwd', 'transcript_path', 'tool_input',
                 'transcript', 'tool_output', 'tool_response']) AS k
   WHERE jsonb_path_exists(p_payload, ('lax $.**.' || k)::jsonpath)
   LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.ops_ingest(p_token TEXT, p_envelope JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user      UUID;
  v_run       UUID;
  v_kind      TEXT;
  v_mode      TEXT;
  v_forbidden TEXT;
  v_inserted  INT;
BEGIN
  IF p_token IS NULL OR length(p_token) < 32 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
  END IF;

  SELECT t.user_id INTO v_user
    FROM ops_private.ingest_tokens t
   WHERE t.token_hash = pg_catalog.sha256(convert_to(p_token, 'UTF8'))
     AND t.revoked_at IS NULL;
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
  END IF;

  IF p_envelope IS NULL OR jsonb_typeof(p_envelope) <> 'object'
     OR jsonb_typeof(p_envelope -> 'payload') IS DISTINCT FROM 'object' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid', 'detail', 'envelope/payload not an object');
  END IF;

  IF octet_length(p_envelope::text) > 262144 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'too_large');
  END IF;

  v_kind := p_envelope ->> 'kind';
  -- Widened (019): job_status joins session_check | waves | gitlab | intent_request.
  IF v_kind IS NULL OR v_kind NOT IN ('session_check', 'waves', 'gitlab', 'intent_request', 'job_status') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid', 'detail', 'kind');
  END IF;

  v_forbidden := ops_private.forbidden_key(p_envelope -> 'payload');
  IF v_forbidden IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden_key', 'detail', v_forbidden);
  END IF;

  v_mode := CASE WHEN v_kind = 'session_check' THEN p_envelope -> 'payload' ->> 'mode' END;
  IF v_kind = 'session_check' AND (v_mode IS NULL OR v_mode NOT IN ('live', 'control')) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid', 'detail', 'payload.mode');
  END IF;

  -- Timestamps: the contract's exact shape, and never in the future. Postgres
  -- would otherwise accept 'yesterday', 'now' and 'infinity' — and a run
  -- finished at 'infinity' (or next week) stays the freshest run forever, so a
  -- dead collector would keep a green board. Freshness is the one thing this
  -- board cannot be allowed to be wrong about.
  IF coalesce(p_envelope ->> 'started_at', '') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$'
     OR coalesce(p_envelope ->> 'finished_at', '') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid', 'detail', 'started_at/finished_at');
  END IF;

  BEGIN
    IF (p_envelope ->> 'finished_at')::timestamptz < (p_envelope ->> 'started_at')::timestamptz
       OR (p_envelope ->> 'finished_at')::timestamptz > now() + interval '5 minutes' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'invalid', 'detail', 'finished_at');
    END IF;
    v_run := (p_envelope ->> 'run_id')::uuid;
    INSERT INTO public.ops_runs (run_id, user_id, kind, mode, producer, started_at, finished_at, payload)
    VALUES (
      v_run, v_user, v_kind, v_mode,
      p_envelope -> 'producer',
      (p_envelope ->> 'started_at')::timestamptz,
      (p_envelope ->> 'finished_at')::timestamptz,
      p_envelope -> 'payload'
    )
    ON CONFLICT (run_id) DO NOTHING;
    GET DIAGNOSTICS v_inserted = ROW_COUNT;
  EXCEPTION
    WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow
      OR not_null_violation OR check_violation THEN
      RETURN jsonb_build_object('ok', false, 'error', 'invalid', 'detail', SQLERRM);
  END;

  IF v_kind = 'waves' AND v_inserted = 1 THEN
    DELETE FROM public.ops_runs
     WHERE user_id = v_user AND kind = 'waves'
       AND received_at < now() - interval '30 days';
  END IF;

  -- 019: a Job card is pushed on every Stop of every session in a Job; only
  -- the latest per Job is ever shown, and a shipped Job leaves the screen
  -- after a day. A week of history is plenty.
  IF v_kind = 'job_status' AND v_inserted = 1 THEN
    DELETE FROM public.ops_runs
     WHERE user_id = v_user AND kind = 'job_status'
       AND received_at < now() - interval '7 days';
  END IF;

  RETURN jsonb_build_object('ok', true, 'run_id', v_run, 'duplicate', v_inserted = 0);
END
$$;

REVOKE ALL ON FUNCTION public.ops_ingest(TEXT, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION ops_private.forbidden_key(JSONB) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.ops_ingest(TEXT, JSONB) TO anon, authenticated';
  END IF;
END $$;
