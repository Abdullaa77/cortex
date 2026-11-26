-- @sentinel: table bot_owed
-- ============================================
-- CORTEX — Telegram expenses bot: the database door
-- ============================================
-- Spec: docs/prompts/CC_PROMPT_CORTEX_V3_01_TELEGRAM_EXPENSES.md
--
-- The webhook has no Supabase session, so it cannot use RLS as the owner. The
-- ops pattern (013) is copied: a random token lives in the route's env, this
-- database holds only its sha256 in a schema PostgREST does not expose, and
-- SECURITY DEFINER functions callable by anon compare hashes, then act ONLY on
-- the token owner's rows. No service-role key. A leaked anon key gets nowhere
-- without the token; a leaked token can only do what the bot can do, for one
-- user, and is revoked by setting revoked_at.
--
-- Every function: `p_token` first, `SET search_path = ''`, returns jsonb
-- {ok:true,...} or {ok:false,error:...}. Row ids are always re-checked against
-- the token owner's user_id, so a guessed UUID of someone else's row is a
-- "not_found".
--
-- Setup after applying, by hand, once (plaintext never leaves the dev box):
--   dev box:  head -c 32 /dev/urandom | base64 | tr '+/' '-_' | tr -d '=' \
--               > ~/.config/cortex/bot-db-token && chmod 600 $_
--   SQL:      insert into ops_private.bot_tokens (token_hash, user_id, label)
--             values (sha256(convert_to('<token>', 'UTF8')), '<scott uid>', 'vercel');
--             insert into ops_private.bot_account_keys (user_id, key, account_id) values
--               ('<uid>', 'cash',  '<accounts.id>'), ('<uid>', 'humo', '<id>'), ... ;

CREATE SCHEMA IF NOT EXISTS ops_private;
REVOKE ALL ON SCHEMA ops_private FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON SCHEMA ops_private FROM anon, authenticated';
  END IF;
END $$;

CREATE TABLE ops_private.bot_tokens (
  token_hash BYTEA PRIMARY KEY CHECK (octet_length(token_hash) = 32),
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  label      TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ
);

-- The five keys the bot names -> real accounts rows. Never by name in the route.
CREATE TABLE ops_private.bot_account_keys (
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  key        TEXT NOT NULL CHECK (key IN ('cash', 'humo', 'uzum', 'ofb', 'c7113')),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, key)
);

-- A question the bot asked and is waiting on. Buttons carry only its id.
-- Deleted when answered (the claim is atomic, so a double tap answers once).
CREATE TABLE ops_private.bot_pending (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('confirm', 'amount', 'move', 'owed')),
  raw        TEXT NOT NULL,
  payload    JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per user: which account the next bare number answers, and the
-- evening-reminder snooze.
CREATE TABLE ops_private.bot_state (
  user_id         UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  pending_balance TEXT CHECK (pending_balance IN ('cash', 'humo', 'uzum', 'ofb', 'c7113')),
  snooze_until    TIMESTAMPTZ,
  last_update_id  BIGINT,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Money other people owe Scott. Public + owner RLS so the mini app reads it
-- with the session; written only through the bot RPCs (and the starting-data
-- script via bot_owed_add).
CREATE TABLE public.bot_owed (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  person         TEXT NOT NULL CHECK (length(btrim(person)) > 0),
  original_minor BIGINT NOT NULL CHECK (original_minor > 0),
  open_minor     BIGINT NOT NULL CHECK (open_minor >= 0 AND open_minor <= original_minor),
  due_on         DATE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX bot_owed_open ON public.bot_owed (user_id, due_on) WHERE open_minor > 0;

ALTER TABLE public.bot_owed ENABLE ROW LEVEL SECURITY;
CREATE POLICY "bot_owed readable by owner" ON public.bot_owed
  FOR SELECT USING (auth.uid() = user_id);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.bot_owed FROM anon, authenticated';
    EXECUTE 'GRANT SELECT ON public.bot_owed TO authenticated';
  END IF;
END $$;

-- ============================================
-- helpers (private)
-- ============================================
CREATE FUNCTION ops_private.bot_user(p_token TEXT) RETURNS UUID
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT t.user_id FROM ops_private.bot_tokens t
   WHERE p_token IS NOT NULL AND length(p_token) >= 32
     AND t.token_hash = pg_catalog.sha256(convert_to(p_token, 'UTF8'))
     AND t.revoked_at IS NULL
$$;

CREATE FUNCTION ops_private.bot_acct(p_user UUID, p_key TEXT) RETURNS UUID
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT account_id FROM ops_private.bot_account_keys WHERE user_id = p_user AND key = p_key
$$;

CREATE FUNCTION ops_private.bot_cat(p_user UUID, p_slug TEXT) RETURNS UUID
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT id FROM public.finance_categories
   WHERE user_id = p_user AND slug = p_slug AND NOT is_archived
$$;

CREATE FUNCTION ops_private.bot_key_of(p_user UUID, p_account UUID) RETURNS TEXT
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT key FROM ops_private.bot_account_keys WHERE user_id = p_user AND account_id = p_account
$$;

-- How one stored row is shown back to the bot (matches render.ts TxnView).
CREATE FUNCTION ops_private.bot_txn_view(p_user UUID, p_id UUID) RETURNS JSONB
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'id', t.id,
    'direction', CASE WHEN t.from_account_id IS NOT NULL AND t.to_account_id IS NOT NULL
                      THEN 'move' ELSE t.direction END,
    'amountMinor', t.amount_minor,
    'categorySlug', c.slug,
    'account', CASE WHEN t.from_account_id IS NOT NULL
                    THEN ops_private.bot_key_of(p_user, t.from_account_id)
                    ELSE ops_private.bot_key_of(p_user, t.to_account_id) END,
    'toAccount', CASE WHEN t.from_account_id IS NOT NULL AND t.to_account_id IS NOT NULL
                      THEN ops_private.bot_key_of(p_user, t.to_account_id) END
  )
  FROM public.transactions t
  LEFT JOIN public.finance_categories c ON c.id = t.category_id
  WHERE t.id = p_id AND t.user_id = p_user
$$;

-- ============================================
-- capture
-- ============================================
-- p_drafts: [{direction:'expense'|'income', amount_minor, comment,
--             category_slug|null, account:'cash'|..., flags?:[text]}]
-- All-or-nothing: one bad draft rolls back the whole message.
CREATE FUNCTION public.bot_capture(p_token TEXT, p_raw TEXT, p_drafts JSONB)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_user UUID := ops_private.bot_user(p_token);
  d      JSONB;
  v_acct UUID;
  v_cat  UUID;
  v_id   UUID;
  v_dir  TEXT;
  v_amt  BIGINT;
  v_out  JSONB := '[]'::jsonb;
BEGIN
  IF v_user IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'unauthorized'); END IF;
  IF jsonb_typeof(p_drafts) IS DISTINCT FROM 'array' OR jsonb_array_length(p_drafts) = 0
     OR jsonb_array_length(p_drafts) > 50 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid', 'detail', 'drafts');
  END IF;

  FOR d IN SELECT * FROM jsonb_array_elements(p_drafts) LOOP
    v_dir := d ->> 'direction';
    IF v_dir IS NULL OR v_dir NOT IN ('expense', 'income')
       OR coalesce(d ->> 'amount_minor', '') !~ '^[1-9][0-9]{0,15}$' THEN
      RAISE EXCEPTION 'invalid draft' USING ERRCODE = 'check_violation';
    END IF;
    v_amt  := (d ->> 'amount_minor')::bigint;
    v_acct := ops_private.bot_acct(v_user, d ->> 'account');
    IF v_acct IS NULL THEN RAISE EXCEPTION 'unknown account' USING ERRCODE = 'check_violation'; END IF;
    v_cat  := ops_private.bot_cat(v_user, d ->> 'category_slug');

    INSERT INTO public.transactions
      (user_id, category_id, direction, amount_minor, comment, raw_input,
       category_source, needs_review, parse_flags, from_account_id, to_account_id)
    VALUES
      (v_user, v_cat, v_dir, v_amt, coalesce(left(d ->> 'comment', 500), ''), left(p_raw, 2000),
       'inferred', false,
       coalesce(ARRAY(SELECT jsonb_array_elements_text(d -> 'flags')), '{}'),
       CASE WHEN v_dir = 'expense' THEN v_acct END,
       CASE WHEN v_dir = 'income'  THEN v_acct END)
    RETURNING id INTO v_id;

    v_out := v_out || jsonb_build_array(ops_private.bot_txn_view(v_user, v_id));
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'saved', v_out);
EXCEPTION
  WHEN invalid_text_representation OR check_violation OR not_null_violation
    OR raise_exception OR invalid_parameter_value THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid', 'detail', SQLERRM);
END
$$;

-- A move between two of Scott's own accounts: ONE row, both pointers set,
-- filed under the transfer category so spend views exclude it.
CREATE FUNCTION public.bot_move(
  p_token TEXT, p_raw TEXT, p_amount_minor BIGINT, p_comment TEXT, p_from TEXT, p_to TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_user UUID := ops_private.bot_user(p_token);
  v_from UUID;
  v_to   UUID;
  v_id   UUID;
BEGIN
  IF v_user IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'unauthorized'); END IF;
  IF p_amount_minor IS NULL OR p_amount_minor <= 0 OR p_from IS NOT DISTINCT FROM p_to THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid');
  END IF;
  v_from := ops_private.bot_acct(v_user, p_from);
  v_to   := ops_private.bot_acct(v_user, p_to);
  IF v_from IS NULL OR v_to IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid', 'detail', 'unknown account');
  END IF;

  INSERT INTO public.transactions
    (user_id, category_id, direction, amount_minor, comment, raw_input,
     category_source, from_account_id, to_account_id)
  VALUES
    (v_user, ops_private.bot_cat(v_user, 'transfer'), 'expense', p_amount_minor,
     coalesce(left(p_comment, 500), ''), left(coalesce(p_raw, ''), 2000),
     'inferred', v_from, v_to)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'saved', jsonb_build_array(ops_private.bot_txn_view(v_user, v_id)));
EXCEPTION
  WHEN check_violation OR raise_exception THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid', 'detail', SQLERRM);
END
$$;

CREATE FUNCTION public.bot_undo(p_token TEXT, p_txn UUID) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_user UUID := ops_private.bot_user(p_token);
  v_n    INT;
BEGIN
  IF v_user IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'unauthorized'); END IF;
  DELETE FROM public.transactions WHERE id = p_txn AND user_id = v_user;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 0 THEN RETURN jsonb_build_object('ok', false, 'error', 'not_found'); END IF;
  RETURN jsonb_build_object('ok', true);
END
$$;

-- Sets the category and remembers it: the comment becomes a learned rule.
CREATE FUNCTION public.bot_set_category(p_token TEXT, p_txn UUID, p_slug TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_user    UUID := ops_private.bot_user(p_token);
  v_cat     UUID;
  v_comment TEXT;
  v_key     TEXT;
BEGIN
  IF v_user IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'unauthorized'); END IF;
  v_cat := ops_private.bot_cat(v_user, p_slug);
  IF v_cat IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'invalid', 'detail', 'category'); END IF;

  UPDATE public.transactions
     SET category_id = v_cat, category_source = 'confirmed', needs_review = false
   WHERE id = p_txn AND user_id = v_user
  RETURNING comment INTO v_comment;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'not_found'); END IF;

  -- Same normalisation as categorize.ts ruleKey().
  v_key := btrim(regexp_replace(lower(coalesce(v_comment, '')), '\s+', ' ', 'g'));
  IF v_key <> '' THEN
    INSERT INTO public.finance_category_rules (user_id, keyword, category_id)
    VALUES (v_user, v_key, v_cat)
    ON CONFLICT (user_id, keyword)
      DO UPDATE SET category_id = EXCLUDED.category_id,
                    hit_count = public.finance_category_rules.hit_count + 1;
  END IF;
  RETURN jsonb_build_object('ok', true, 'txn', ops_private.bot_txn_view(v_user, p_txn));
END
$$;

-- Expense -> from; income -> to. A move has its own two-step flow.
CREATE FUNCTION public.bot_set_account(p_token TEXT, p_txn UUID, p_account TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_user UUID := ops_private.bot_user(p_token);
  v_acct UUID;
  v_n    INT;
BEGIN
  IF v_user IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'unauthorized'); END IF;
  v_acct := ops_private.bot_acct(v_user, p_account);
  IF v_acct IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'invalid', 'detail', 'account'); END IF;

  UPDATE public.transactions
     SET from_account_id = CASE WHEN direction = 'expense' THEN v_acct ELSE from_account_id END,
         to_account_id   = CASE WHEN direction = 'income'  THEN v_acct ELSE to_account_id END
   WHERE id = p_txn AND user_id = v_user
     AND NOT (from_account_id IS NOT NULL AND to_account_id IS NOT NULL);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 0 THEN RETURN jsonb_build_object('ok', false, 'error', 'not_found'); END IF;
  RETURN jsonb_build_object('ok', true, 'txn', ops_private.bot_txn_view(v_user, p_txn));
EXCEPTION
  WHEN check_violation OR raise_exception THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid', 'detail', SQLERRM);
END
$$;

-- ============================================
-- balance counts
-- ============================================
-- One count per account per day (the table's unique constraint): a recount
-- the same day replaces the figure.
CREATE FUNCTION public.bot_checkpoint(p_token TEXT, p_account TEXT, p_counted_minor BIGINT, p_day DATE)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_user UUID := ops_private.bot_user(p_token);
  v_acct UUID;
BEGIN
  IF v_user IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'unauthorized'); END IF;
  v_acct := ops_private.bot_acct(v_user, p_account);
  IF v_acct IS NULL OR p_counted_minor IS NULL OR p_day IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid');
  END IF;
  INSERT INTO public.balance_checkpoints (user_id, account_id, counted_at, counted_minor, note)
  VALUES (v_user, v_acct, p_day, p_counted_minor, 'telegram')
  ON CONFLICT (account_id, counted_at)
    DO UPDATE SET counted_minor = EXCLUDED.counted_minor, note = EXCLUDED.note;
  RETURN jsonb_build_object('ok', true);
END
$$;

-- What the route needs to call reconcileCount() for one account BEFORE the
-- new count is stored: the account id, its checkpoints, and every movement
-- since the earliest checkpoint.
CREATE FUNCTION public.bot_balance_inputs(p_token TEXT, p_account TEXT) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_user UUID := ops_private.bot_user(p_token);
  v_acct UUID;
  v_first DATE;
BEGIN
  IF v_user IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'unauthorized'); END IF;
  v_acct := ops_private.bot_acct(v_user, p_account);
  IF v_acct IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'invalid'); END IF;
  SELECT min(counted_at) INTO v_first FROM public.balance_checkpoints
   WHERE user_id = v_user AND account_id = v_acct;

  RETURN jsonb_build_object(
    'ok', true,
    'accountId', v_acct,
    'checkpoints', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'id', c.id, 'account_id', c.account_id, 'counted_at', c.counted_at,
               'counted_minor', c.counted_minor, 'note', c.note,
               'adjustment_transaction_id', c.adjustment_transaction_id)
             ORDER BY c.counted_at)
        FROM public.balance_checkpoints c
       WHERE c.user_id = v_user AND c.account_id = v_acct), '[]'::jsonb),
    'rows', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'id', t.id, 'amount_minor', t.amount_minor, 'occurred_at', t.occurred_at,
               'from_account_id', t.from_account_id, 'to_account_id', t.to_account_id)
             ORDER BY t.occurred_at)
        FROM public.transactions t
       WHERE t.user_id = v_user
         AND (t.from_account_id = v_acct OR t.to_account_id = v_acct)
         AND v_first IS NOT NULL
         AND t.occurred_at >= (v_first::timestamp AT TIME ZONE 'Asia/Tashkent')), '[]'::jsonb)
  );
END
$$;

-- ============================================
-- context, summary, state, pending, owed
-- ============================================
-- One call per update: learned rules, categories, open owed, bot state.
CREATE FUNCTION public.bot_context(p_token TEXT) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_user UUID := ops_private.bot_user(p_token);
BEGIN
  IF v_user IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'unauthorized'); END IF;
  RETURN jsonb_build_object(
    'ok', true,
    'learned', coalesce((SELECT jsonb_object_agg(r.keyword, c.slug)
                           FROM public.finance_category_rules r
                           JOIN public.finance_categories c ON c.id = r.category_id
                          WHERE r.user_id = v_user), '{}'::jsonb),
    'categories', coalesce((SELECT jsonb_agg(jsonb_build_object('slug', slug, 'name', name) ORDER BY sort_order)
                              FROM public.finance_categories
                             WHERE user_id = v_user AND NOT is_archived AND kind = 'expense'), '[]'::jsonb),
    'owed', coalesce((SELECT jsonb_agg(jsonb_build_object('id', id, 'person', person, 'openMinor', open_minor))
                        FROM public.bot_owed WHERE user_id = v_user AND open_minor > 0), '[]'::jsonb),
    'pendingBalance', (SELECT pending_balance FROM ops_private.bot_state WHERE user_id = v_user),
    'snoozeUntil', (SELECT snooze_until FROM ops_private.bot_state WHERE user_id = v_user)
  );
END
$$;

-- Spending for one Tashkent day (transfers excluded), top three categories.
CREATE FUNCTION public.bot_day_summary(p_token TEXT, p_day DATE) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_user UUID := ops_private.bot_user(p_token);
BEGIN
  IF v_user IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'unauthorized'); END IF;
  RETURN (
    WITH spent AS (
      SELECT coalesce(c.name, 'Uncategorised') AS name, sum(t.amount_minor)::bigint AS minor
        FROM public.transactions t
        LEFT JOIN public.finance_categories c ON c.id = t.category_id
       WHERE t.user_id = v_user AND t.direction = 'expense'
         AND coalesce(c.kind, 'expense') = 'expense'
         AND (t.occurred_at AT TIME ZONE 'Asia/Tashkent')::date = p_day
       GROUP BY 1
    )
    SELECT jsonb_build_object(
      'ok', true,
      'totalMinor', coalesce((SELECT sum(minor) FROM spent), 0),
      'top', coalesce((SELECT jsonb_agg(jsonb_build_object('name', name, 'minor', minor) ORDER BY minor DESC)
                         FROM (SELECT * FROM spent ORDER BY minor DESC LIMIT 3) s), '[]'::jsonb))
  );
END
$$;

-- patch keys present are applied; absent keys untouched. null clears.
CREATE FUNCTION public.bot_state_set(p_token TEXT, p_patch JSONB) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_user UUID := ops_private.bot_user(p_token);
BEGIN
  IF v_user IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'unauthorized'); END IF;
  IF jsonb_typeof(p_patch) IS DISTINCT FROM 'object' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid');
  END IF;
  INSERT INTO ops_private.bot_state (user_id) VALUES (v_user) ON CONFLICT (user_id) DO NOTHING;
  UPDATE ops_private.bot_state SET
    pending_balance = CASE WHEN p_patch ? 'pendingBalance' THEN p_patch ->> 'pendingBalance' ELSE pending_balance END,
    snooze_until    = CASE WHEN p_patch ? 'snoozeUntil' THEN (p_patch ->> 'snoozeUntil')::timestamptz ELSE snooze_until END,
    updated_at = now()
  WHERE user_id = v_user;
  RETURN jsonb_build_object('ok', true);
EXCEPTION
  WHEN check_violation OR invalid_datetime_format OR invalid_text_representation THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid', 'detail', SQLERRM);
END
$$;

-- Telegram redelivers an update when we answer slowly: only the first delivery
-- of an update_id may act. Atomic, so two parallel deliveries cannot both pass.
CREATE FUNCTION public.bot_seen_update(p_token TEXT, p_id BIGINT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_user UUID := ops_private.bot_user(p_token);
  v_hit  INT;
BEGIN
  IF v_user IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'unauthorized'); END IF;
  INSERT INTO ops_private.bot_state (user_id) VALUES (v_user) ON CONFLICT (user_id) DO NOTHING;
  UPDATE ops_private.bot_state SET last_update_id = p_id, updated_at = now()
   WHERE user_id = v_user AND (last_update_id IS NULL OR last_update_id < p_id);
  GET DIAGNOSTICS v_hit = ROW_COUNT;
  RETURN jsonb_build_object('ok', true, 'fresh', v_hit = 1);
END
$$;

CREATE FUNCTION public.bot_pending_put(p_token TEXT, p_kind TEXT, p_raw TEXT, p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_user UUID := ops_private.bot_user(p_token);
  v_id   UUID;
BEGIN
  IF v_user IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'unauthorized'); END IF;
  -- Housekeeping: unanswered questions die after a day.
  DELETE FROM ops_private.bot_pending WHERE user_id = v_user AND created_at < now() - interval '1 day';
  INSERT INTO ops_private.bot_pending (user_id, kind, raw, payload)
  VALUES (v_user, p_kind, left(coalesce(p_raw, ''), 2000), coalesce(p_payload, '{}'::jsonb))
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
EXCEPTION
  WHEN check_violation THEN RETURN jsonb_build_object('ok', false, 'error', 'invalid');
END
$$;

CREATE FUNCTION public.bot_pending_get(p_token TEXT, p_id UUID) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_user UUID := ops_private.bot_user(p_token);
  r      ops_private.bot_pending;
BEGIN
  IF v_user IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'unauthorized'); END IF;
  SELECT * INTO r FROM ops_private.bot_pending WHERE id = p_id AND user_id = v_user;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'not_found'); END IF;
  RETURN jsonb_build_object('ok', true, 'id', r.id, 'kind', r.kind, 'raw', r.raw, 'payload', r.payload);
END
$$;

-- Atomic claim: returns the row once, then it is gone (double tap = not_found).
CREATE FUNCTION public.bot_pending_resolve(p_token TEXT, p_id UUID) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_user UUID := ops_private.bot_user(p_token);
  r      ops_private.bot_pending;
BEGIN
  IF v_user IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'unauthorized'); END IF;
  DELETE FROM ops_private.bot_pending WHERE id = p_id AND user_id = v_user RETURNING * INTO r;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'not_found'); END IF;
  RETURN jsonb_build_object('ok', true, 'id', r.id, 'kind', r.kind, 'raw', r.raw, 'payload', r.payload);
END
$$;

-- A move question is answered in two taps; this stores the first tap without
-- consuming the pending row.
CREATE FUNCTION public.bot_pending_patch(p_token TEXT, p_id UUID, p_patch JSONB) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_user UUID := ops_private.bot_user(p_token);
BEGIN
  IF v_user IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'unauthorized'); END IF;
  IF jsonb_typeof(p_patch) IS DISTINCT FROM 'object' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid');
  END IF;
  UPDATE ops_private.bot_pending SET payload = payload || p_patch WHERE id = p_id AND user_id = v_user;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'not_found'); END IF;
  RETURN jsonb_build_object('ok', true);
END
$$;

CREATE FUNCTION public.bot_owed_add(p_token TEXT, p_person TEXT, p_minor BIGINT, p_due DATE)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_user UUID := ops_private.bot_user(p_token);
  v_id   UUID;
BEGIN
  IF v_user IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'unauthorized'); END IF;
  INSERT INTO public.bot_owed (user_id, person, original_minor, open_minor, due_on)
  VALUES (v_user, btrim(p_person), p_minor, p_minor, p_due)
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
EXCEPTION
  WHEN check_violation OR not_null_violation THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid');
END
$$;

-- Reduces what is open by what was paid (never below zero).
CREATE FUNCTION public.bot_owed_reduce(p_token TEXT, p_id UUID, p_paid_minor BIGINT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_user UUID := ops_private.bot_user(p_token);
  r      public.bot_owed;
BEGIN
  IF v_user IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'unauthorized'); END IF;
  IF p_paid_minor IS NULL OR p_paid_minor <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid');
  END IF;
  UPDATE public.bot_owed
     SET open_minor = greatest(open_minor - p_paid_minor, 0), updated_at = now()
   WHERE id = p_id AND user_id = v_user
  RETURNING * INTO r;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'not_found'); END IF;
  RETURN jsonb_build_object('ok', true, 'person', r.person, 'openMinor', r.open_minor);
END
$$;

-- Debts due on a Tashkent day (and overdue ones still open).
CREATE FUNCTION public.bot_owed_due(p_token TEXT, p_day DATE) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_user UUID := ops_private.bot_user(p_token);
BEGIN
  IF v_user IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'unauthorized'); END IF;
  RETURN jsonb_build_object('ok', true, 'due', coalesce((
    SELECT jsonb_agg(jsonb_build_object('id', id, 'person', person, 'openMinor', open_minor) ORDER BY due_on)
      FROM public.bot_owed
     WHERE user_id = v_user AND open_minor > 0 AND due_on IS NOT NULL AND due_on <= p_day), '[]'::jsonb));
END
$$;

-- ============================================
-- grants: nothing by default, anon/authenticated execute the public doors only
-- ============================================
REVOKE ALL ON FUNCTION
  ops_private.bot_user(TEXT), ops_private.bot_acct(UUID, TEXT), ops_private.bot_cat(UUID, TEXT),
  ops_private.bot_key_of(UUID, UUID), ops_private.bot_txn_view(UUID, UUID)
  FROM PUBLIC;

REVOKE ALL ON FUNCTION
  public.bot_capture(TEXT, TEXT, JSONB),
  public.bot_move(TEXT, TEXT, BIGINT, TEXT, TEXT, TEXT),
  public.bot_undo(TEXT, UUID),
  public.bot_set_category(TEXT, UUID, TEXT),
  public.bot_set_account(TEXT, UUID, TEXT),
  public.bot_checkpoint(TEXT, TEXT, BIGINT, DATE),
  public.bot_balance_inputs(TEXT, TEXT),
  public.bot_context(TEXT),
  public.bot_day_summary(TEXT, DATE),
  public.bot_state_set(TEXT, JSONB),
  public.bot_seen_update(TEXT, BIGINT),
  public.bot_pending_put(TEXT, TEXT, TEXT, JSONB),
  public.bot_pending_get(TEXT, UUID),
  public.bot_pending_resolve(TEXT, UUID),
  public.bot_pending_patch(TEXT, UUID, JSONB),
  public.bot_owed_add(TEXT, TEXT, BIGINT, DATE),
  public.bot_owed_reduce(TEXT, UUID, BIGINT),
  public.bot_owed_due(TEXT, DATE)
  FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION
      public.bot_capture(TEXT, TEXT, JSONB),
      public.bot_move(TEXT, TEXT, BIGINT, TEXT, TEXT, TEXT),
      public.bot_undo(TEXT, UUID),
      public.bot_set_category(TEXT, UUID, TEXT),
      public.bot_set_account(TEXT, UUID, TEXT),
      public.bot_checkpoint(TEXT, TEXT, BIGINT, DATE),
      public.bot_balance_inputs(TEXT, TEXT),
      public.bot_context(TEXT),
      public.bot_day_summary(TEXT, DATE),
      public.bot_state_set(TEXT, JSONB),
      public.bot_seen_update(TEXT, BIGINT),
      public.bot_pending_put(TEXT, TEXT, TEXT, JSONB),
      public.bot_pending_get(TEXT, UUID),
      public.bot_pending_resolve(TEXT, UUID),
      public.bot_pending_patch(TEXT, UUID, JSONB),
      public.bot_owed_add(TEXT, TEXT, BIGINT, DATE),
      public.bot_owed_reduce(TEXT, UUID, BIGINT),
      public.bot_owed_due(TEXT, DATE)
      TO anon, authenticated';
  END IF;
END $$;
