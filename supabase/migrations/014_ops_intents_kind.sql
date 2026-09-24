-- @sentinel: unprobeable widens ops_runs.kind and forbidden_key; not visible via PostgREST —
--   no anon INSERT grant on ops_runs, and the RLS SELECT policy scopes to auth.uid(), so there
--   is nothing here a probe with the anon key could tell apart from 013's state.
-- ============================================
-- CORTEX — Command Centre: intents kind + tightened forbidden-key list (014)
-- ============================================
-- Contract: Brain/04-Claude/Handoffs/2026-09-23-command-centre-ingest-contract.md,
-- 2026-09-24 addendum (CORTEX-INTENTS §9.1 rulings). NEVER edit 013 — it is
-- applied to the live database. This widens it in place.
--
-- Two changes, both additive to the door 013 built. Every guard 013 set up
-- (SECURITY DEFINER, SET search_path = '', the REVOKE/GRANT pairs, the
-- append-only insert + 30-day waves retention) is restated unchanged below —
-- CREATE OR REPLACE FUNCTION does not remember SECURITY DEFINER if you omit
-- it, so it is repeated explicitly rather than assumed.
--
--  1. `ops_runs.kind` and `ops_ingest()`'s own kind check both accept the new
--     kind `intent_request` (contract §5b, producer `intent-hook`).
--  2. `ops_private.forbidden_key` gains `cwd`, `transcript_path` and (2026-09-24,
--     aeb9adf) `tool_input`. CORTEX-INTENTS.md §5 lists `cwd` on the `ops_intents`
--     shape, but this contract keeps local-machine detail off this box (a cwd is
--     usually a worktree path) — the hook writes it to a local sidecar instead.
--     `tool_input` carries file contents for Write/Edit and anything at all for
--     MCP tools; only the `action` projection the hook computes from it (contract
--     §5b) ever leaves the box. Neither may reach this security domain, even
--     nested under another key. This file is edited in place, not superseded by
--     a 015, because 014 is not applied anywhere yet.
--
-- Idempotent: safe to paste into the SQL editor more than once. The
-- constraint is dropped and re-added by its default-generated name; the
-- functions are CREATE OR REPLACE. Running this twice leaves the same state
-- as running it once. (013 itself is not wrapped in an explicit transaction,
-- so this isn't either — matching, not improving on, its shape.)

ALTER TABLE public.ops_runs DROP CONSTRAINT IF EXISTS ops_runs_kind_check;
ALTER TABLE public.ops_runs ADD CONSTRAINT ops_runs_kind_check
  CHECK (kind IN ('session_check', 'waves', 'gitlab', 'intent_request'));

CREATE OR REPLACE FUNCTION ops_private.forbidden_key(p_payload JSONB)
RETURNS TEXT
LANGUAGE sql IMMUTABLE
SET search_path = ''
AS $$
  SELECT k
    FROM unnest(ARRAY['body', 'note', 'content', 'markdown', 'worktree', 'chat', 'source_line', 'cwd', 'transcript_path', 'tool_input']) AS k
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
  -- Widened: intent_request joins session_check | waves | gitlab.
  IF v_kind IS NULL OR v_kind NOT IN ('session_check', 'waves', 'gitlab', 'intent_request') THEN
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
