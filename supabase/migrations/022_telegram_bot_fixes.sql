-- 022 — fixes to the Telegram bot doors (021), from the PR #22 review.
--
-- 1. bot_seen_update deduped on "id greater than the last one". Two messages
--    handled at once can commit out of order, and the lower id — a real
--    message — was dropped silently. Now: exact ids, kept for 2 days.
-- 2. An unanswered "Cash now?" stayed open forever, so any bare number typed
--    days later was taken as a cash count. Now the question expires after 6 h.
-- 3. bot_day_summary counted a move as spending when its category was missing.
--    A row with both accounts set is a move, whatever its category.
--
-- CREATE OR REPLACE keeps 021's grants (anon EXECUTE on the public doors).

CREATE TABLE IF NOT EXISTS ops_private.bot_seen_updates (
  user_id   UUID   NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  update_id BIGINT NOT NULL,
  seen_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, update_id)
);
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON ops_private.bot_seen_updates FROM anon, authenticated';
  END IF;
END
$$;

ALTER TABLE ops_private.bot_state ADD COLUMN IF NOT EXISTS pending_balance_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.bot_seen_update(p_token TEXT, p_id BIGINT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_user UUID := ops_private.bot_user(p_token);
  v_hit  INT;
BEGIN
  IF v_user IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'unauthorized'); END IF;
  INSERT INTO ops_private.bot_seen_updates (user_id, update_id) VALUES (v_user, p_id)
    ON CONFLICT (user_id, update_id) DO NOTHING;
  GET DIAGNOSTICS v_hit = ROW_COUNT;
  -- Telegram redelivers for at most a day; keep two.
  DELETE FROM ops_private.bot_seen_updates
   WHERE user_id = v_user AND seen_at < now() - interval '2 days';
  RETURN jsonb_build_object('ok', true, 'fresh', v_hit = 1);
END
$$;

-- Same as 021, plus: setting pendingBalance stamps pending_balance_at.
CREATE OR REPLACE FUNCTION public.bot_state_set(p_token TEXT, p_patch JSONB) RETURNS JSONB
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
    pending_balance    = CASE WHEN p_patch ? 'pendingBalance' THEN p_patch ->> 'pendingBalance' ELSE pending_balance END,
    pending_balance_at = CASE WHEN p_patch ? 'pendingBalance' THEN now() ELSE pending_balance_at END,
    snooze_until       = CASE WHEN p_patch ? 'snoozeUntil' THEN (p_patch ->> 'snoozeUntil')::timestamptz ELSE snooze_until END,
    updated_at = now()
  WHERE user_id = v_user;
  RETURN jsonb_build_object('ok', true);
EXCEPTION
  WHEN check_violation OR invalid_datetime_format OR invalid_text_representation THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid', 'detail', SQLERRM);
END
$$;

-- Same as 021, plus: pendingBalance older than 6 hours reads as none.
CREATE OR REPLACE FUNCTION public.bot_context(p_token TEXT) RETURNS JSONB
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
    'pendingBalance', (SELECT pending_balance FROM ops_private.bot_state
                        WHERE user_id = v_user
                          AND pending_balance_at > now() - interval '6 hours'),
    'snoozeUntil', (SELECT snooze_until FROM ops_private.bot_state WHERE user_id = v_user)
  );
END
$$;

-- Same as 021, plus: a row with both accounts set (a move) is never spending.
CREATE OR REPLACE FUNCTION public.bot_day_summary(p_token TEXT, p_day DATE) RETURNS JSONB
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
         AND NOT (t.from_account_id IS NOT NULL AND t.to_account_id IS NOT NULL)
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
