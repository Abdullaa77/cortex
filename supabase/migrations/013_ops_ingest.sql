-- @sentinel: table ops_runs
-- ============================================
-- CORTEX — Command Centre: the ops ingest (read-only board, one write door)
-- ============================================
-- Contract: Brain/04-Claude/Handoffs/2026-09-23-command-centre-ingest-contract.md
--
-- The board RENDERS measurements that already exist; the producers
-- (session-check --emit, wave) push them here. Three rules shape this file.
--
-- 1. APPEND-ONLY. A run is stored as it arrived and never rewritten. "Prod SHA
--    at T" is the latest attestation at-or-before T — the same primitive the
--    finance checkpoints use — so history is kept, not reconstructed. The one
--    exception is waves snapshots older than 30 days: a snapshot is a
--    declaration copied out of the Brain repo, whose git history already
--    keeps every version, and at ~40 KB a push it is the only kind that would
--    fill the free tier.
--
-- 2. NO NEW SECRET IN THE APP. No service-role key: it bypasses RLS, and a
--    leak would expose the finance tables too. The producer holds a random
--    token; this database holds only its sha256, in a schema PostgREST does
--    not expose, and `ops_ingest` — SECURITY DEFINER, callable by anon —
--    compares hashes and writes. A leaked anon key can call it, and gets
--    nowhere without the token.
--
-- 3. THE DATABASE ENFORCES THE SECURITY INVARIANTS ITSELF. The route validates
--    the full contract, but a token holder can call the RPC directly and skip
--    the route. So the three things that matter for safety are checked here
--    too: the kind, the size, and the forbidden keys (note bodies and local
--    detail must never enter this security domain under any nesting).
--
-- Setup after applying, by hand, once (plaintext never leaves the dev box):
--   dev box:  head -c 32 /dev/urandom | base64 | tr '+/' '-_' | tr -d '=' \
--               > ~/.config/cortex/ops-ingest-token && chmod 600 $_
--   SQL:      insert into ops_private.ingest_tokens (token_hash, user_id, label)
--             values (sha256(convert_to('<token>', 'UTF8')), '<scott uid>', 'dev box');

CREATE SCHEMA IF NOT EXISTS ops_private;
REVOKE ALL ON SCHEMA ops_private FROM PUBLIC;
DO $$
BEGIN
  -- anon/authenticated exist on Supabase; guarded so the file also runs on a
  -- bare Postgres (the test harness creates them before executing this).
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON SCHEMA ops_private FROM anon, authenticated';
  END IF;
END $$;

CREATE TABLE ops_private.ingest_tokens (
  token_hash BYTEA PRIMARY KEY CHECK (octet_length(token_hash) = 32),
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  label      TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ
);

CREATE TABLE public.ops_runs (
  run_id      UUID PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('session_check', 'waves', 'gitlab')),
  -- live | control, for session_check only. A column rather than a JSON path
  -- so "the latest LIVE run" is an index scan, and so a control run can never
  -- be mistaken for live state by a query that forgot to look inside payload.
  mode        TEXT CHECK (mode IN ('live', 'control')),
  producer    JSONB NOT NULL,
  started_at  TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  payload     JSONB NOT NULL,
  CONSTRAINT ops_runs_mode_iff_session_check
    CHECK ((kind = 'session_check') = (mode IS NOT NULL))
);

CREATE INDEX ops_runs_latest ON public.ops_runs (user_id, kind, mode, finished_at DESC);

ALTER TABLE public.ops_runs ENABLE ROW LEVEL SECURITY;

-- Read-only to its owner. No insert/update/delete policy exists, so no API
-- role can write; the only write path is ops_ingest below.
CREATE POLICY "ops_runs readable by owner" ON public.ops_runs
  FOR SELECT USING (auth.uid() = user_id);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.ops_runs FROM anon, authenticated';
  END IF;
END $$;

-- Keys that must never arrive, at any depth of the payload. Contract §4.
-- Exact key names: `note_mtime` is not `note`.
CREATE FUNCTION ops_private.forbidden_key(p_payload JSONB)
RETURNS TEXT
LANGUAGE sql IMMUTABLE
SET search_path = ''
AS $$
  SELECT k
    FROM unnest(ARRAY['body', 'note', 'content', 'markdown', 'worktree', 'chat', 'source_line']) AS k
   WHERE jsonb_path_exists(p_payload, ('lax $.**.' || k)::jsonpath)
   LIMIT 1
$$;

CREATE FUNCTION public.ops_ingest(p_token TEXT, p_envelope JSONB)
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
  IF v_kind IS NULL OR v_kind NOT IN ('session_check', 'waves', 'gitlab') THEN
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
