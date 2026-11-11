-- @sentinel: unprobeable widens ops_runs.kind; not visible via PostgREST —
--   no anon INSERT grant on ops_runs, and the RLS SELECT policy scopes to auth.uid(), so there
--   is nothing here a probe with the anon key could tell apart from 019's state.
-- ============================================
-- CORTEX — Command Centre: tickets kind (020)
-- ============================================
-- Contract: Brain/04-Claude/Handoffs/2026-09-23-command-centre-ingest-contract.md
-- §5e (2026-11-11, wave workflow-v2, ticket T-1). NEVER edit 013, 014 or 019 —
-- they are applied to the live database. This restates 019's ops_ingest() whole,
-- with every guard it set (SECURITY DEFINER, SET search_path = '', the
-- REVOKE/GRANT pairs, append-only insert, the waves and job_status retention).
--
--  1. `ops_runs.kind` and `ops_ingest()`'s own kind check accept `tickets`
--     (producer `ticket`): the whole ticket ledger — id, title, status, next
--     step, waves, MRs — for the read-only Tickets board on /ops. Scott's
--     verbatim words never leave the laptop; only the title is sent.
--  2. tickets runs older than 7 days are deleted on each new one.
--  3. forbidden_key is unchanged (019's list).
--
-- Idempotent: safe to paste into the SQL editor more than once.

ALTER TABLE public.ops_runs DROP CONSTRAINT IF EXISTS ops_runs_kind_check;
ALTER TABLE public.ops_runs ADD CONSTRAINT ops_runs_kind_check
  CHECK (kind IN ('session_check', 'waves', 'gitlab', 'intent_request', 'job_status', 'tickets'));

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
  -- Widened (020): tickets — the ticket ledger snapshot.
  IF v_kind IS NULL OR v_kind NOT IN ('session_check', 'waves', 'gitlab', 'intent_request', 'job_status', 'tickets') THEN
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

  -- 020: the ticket ledger is pushed whole on every `ticket` write; only the
  -- latest snapshot is shown. A week of history is plenty.
  IF v_kind = 'tickets' AND v_inserted = 1 THEN
    DELETE FROM public.ops_runs
     WHERE user_id = v_user AND kind = 'tickets'
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
