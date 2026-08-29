-- @deferred-until: the September cutover has put a real checkpoint on every real account
-- ============================================
-- 011 — retire finance_opening_balance, once its figure demonstrably landed
-- ============================================
-- DEFERRED ON PURPOSE. It lives in supabase/deferred/, NOT supabase/migrations/,
-- because `supabase db push` reads the directory and not the comments: a file
-- sitting in migrations/ gets applied by the next push whatever it says about
-- waiting. To run it, move it into migrations/ and push — a deliberate act,
-- visible in a diff.
--
-- Why it is its own migration rather than the last statement of 009:
--
-- 009 migrates finance_opening_balance into balance_checkpoints inside a loop
-- over users that have accounts, and 008 only creates an account for users
-- that have transactions. A user with an opening balance and no transactions
-- is skipped — silently, with a clean exit code — and the DROP that used to
-- follow took the only record of what they started with. The failure mode is
-- not that it errors; it is that nothing errors.
--
-- Two changes come out of that, and only the second is a guard:
--
--   1. The drop waits. Between 009 landing and the September cutover, this
--      table is the only copy of a figure that was entered by hand. Nothing
--      needs it gone during that window, so it stays. Deferring removes the
--      risk; guarding would only detect it.
--
--   2. The drop refuses. The assertion below is a count equality, not a
--      per-row skip: every opening balance must be present as a checkpoint,
--      or nothing is dropped. A migration that can drop a source it failed to
--      copy must say so loudly, because the alternative is a green run and a
--      missing number that surfaces months later as an unexplained gap.
--
-- 009 carries the same assertion at the point it would have dropped. This one
-- runs it again rather than trusting that it ran before: the table has been
-- writable in between, so the only count that matters is the one taken now.

DO $$
DECLARE
  v_openings  INT;
  v_landed    INT;
  v_stranded  INT;
BEGIN
  SELECT count(*) INTO v_openings FROM finance_opening_balance;

  SELECT count(*) INTO v_landed
  FROM finance_opening_balance o
  WHERE EXISTS (
    SELECT 1 FROM balance_checkpoints c
     WHERE c.user_id       = o.user_id
       AND c.counted_at    = o.as_of
       AND c.counted_minor = o.amount_minor
  );

  v_stranded := v_openings - v_landed;

  IF v_stranded > 0 THEN
    RAISE EXCEPTION
      'refusing to drop finance_opening_balance: % of % row(s) are not present '
      'in balance_checkpoints. Place them on an account first — a checkpoint '
      'with nowhere to land is data loss with a clean exit code.',
      v_stranded, v_openings;
  END IF;

  RAISE NOTICE 'finance_opening_balance: % row(s), all present as checkpoints. Dropping.',
    v_openings;
END $$;

DROP TABLE finance_opening_balance;
