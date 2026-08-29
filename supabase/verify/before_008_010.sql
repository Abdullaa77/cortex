-- READ ONLY. Run this BEFORE the apply paste. Nothing here writes.
-- One result set; paste it back.
--
-- The question: is the hand-entered opening balance attached to a user who
-- will have an account by the time 009 finishes? 008 only creates 'Main' for
-- users that have transactions, and 009 only migrates opening balances for
-- users that have accounts. No transactions -> no account -> skipped.
-- (009 now RAISEs rather than dropping if that happens, so this is a check,
-- not a gate. It is still worth seeing before the run.)

SELECT
  'opening balance rows'                      AS k,
  count(*)::text                              AS v
FROM finance_opening_balance
UNION ALL SELECT
  'opening amount (som)',
  to_char(o.amount_minor / 100.0, 'FM999,999,999.00')
FROM finance_opening_balance o
UNION ALL SELECT 'opening currency', o.currency FROM finance_opening_balance o
UNION ALL SELECT 'opening as_of',    o.as_of::text FROM finance_opening_balance o
UNION ALL SELECT
  'transactions belonging to that same user',
  (SELECT count(*) FROM transactions t WHERE t.user_id = o.user_id)::text
FROM finance_opening_balance o
UNION ALL SELECT
  'so it will get a Main account, and migrate',
  CASE WHEN EXISTS (SELECT 1 FROM transactions t WHERE t.user_id = o.user_id)
       THEN 'YES' ELSE 'NO — STOP, 009 would raise' END
FROM finance_opening_balance o
UNION ALL SELECT 'transactions, all users',        (SELECT count(*)::text FROM transactions)
UNION ALL SELECT 'distinct users in transactions', (SELECT count(DISTINCT user_id)::text FROM transactions)
UNION ALL SELECT 'month-precision rows',           (SELECT count(*)::text FROM transactions WHERE date_precision = 'month')
UNION ALL SELECT 'categories',                     (SELECT count(*)::text FROM finance_categories);
