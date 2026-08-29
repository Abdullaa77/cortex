-- READ ONLY. Run this AFTER the apply paste. One result set; paste it back.
--
-- The month figures here are a SECOND DERIVATION, computed in SQL rather than
-- read out of the app: same rules as src/lib/finance/summarize.ts, written
-- again from the schema. A green test suite that reads one source field cannot
-- catch a ledger that is consistent and false; two independent derivations
-- landing on the same four numbers can.
--
-- Pinned from the golden snapshot, and expected UNCHANGED:
--   July    3,451,961.38   floor 1,419,349.17
--   August  5,996,954.15   floor 1,438,873.00
--   153 rows, 153 month-precision

WITH r AS (
  SELECT t.id,
         t.amount_minor,
         t.direction,
         t.occurred_at,
         t.currency,
         t.reimburses_transaction_id,
         COALESCE(c.kind, 'expense')       AS kind,
         COALESCE(c.slug, 'uncategorised') AS slug
  FROM transactions t
  LEFT JOIN finance_categories c ON c.id = t.category_id
  -- countsTowardLedger: anything not so'm belongs to no figure on that page.
  WHERE t.currency = 'UZS'
),
-- reimbursementsByTarget: a pointer to a row that is not in the set is a
-- dangling link and is ignored, so the join to r matters.
back AS (
  SELECT x.reimburses_transaction_id AS target, sum(x.amount_minor) AS minor
  FROM r x
  JOIN r tgt ON tgt.id = x.reimburses_transaction_id
  GROUP BY 1
),
-- effectiveMinor: a repayment contributes nothing, a repaid expense
-- contributes its remainder, clamped at zero.
eff AS (
  SELECT r.*,
         CASE
           WHEN r.reimburses_transaction_id IS NOT NULL
                AND EXISTS (SELECT 1 FROM back b WHERE b.target = r.reimburses_transaction_id)
             THEN 0
           ELSE GREATEST(0, r.amount_minor
                            - COALESCE((SELECT b.minor FROM back b WHERE b.target = r.id), 0))
         END AS eff_minor
  FROM r
),
-- classifyRow, exactly as the app answers it.
cls AS (
  -- Asia/Tashkent, matching monthKey() running in Scott's browser. UTC would
  -- put a row captured just after midnight into the previous month.
  SELECT to_char(occurred_at AT TIME ZONE 'Asia/Tashkent', 'YYYY-MM') AS mkey,
         eff_minor,
         slug,
         CASE
           WHEN kind = 'transfer' THEN
             CASE WHEN direction = 'income' THEN 'transfer-in' ELSE 'transfer-out' END
           WHEN kind = 'income' OR direction = 'income' THEN 'income'
           ELSE 'spend'
         END AS klass
  FROM eff
),
months AS (
  SELECT mkey,
         sum(eff_minor) FILTER (WHERE klass = 'spend') AS spend,
         sum(eff_minor) FILTER (
           WHERE klass = 'spend'
             AND slug IN ('groceries', 'transport', 'eating-out')
         ) AS core
  FROM cls
  GROUP BY 1
)
SELECT 'THE FOUR NUMBERS' AS k, '' AS v
UNION ALL SELECT
  m.mkey || ' spend',
  to_char(m.spend / 100.0, 'FM999,999,999.00')
FROM months m
UNION ALL SELECT
  m.mkey || ' floor',
  to_char(m.core / 100.0, 'FM999,999,999.00')
FROM months m
UNION ALL SELECT 'total rows',      (SELECT count(*)::text FROM transactions)
UNION ALL SELECT 'month-precision', (SELECT count(*)::text FROM transactions WHERE date_precision = 'month')

UNION ALL SELECT '', ''
UNION ALL SELECT 'THE OPENING BALANCE', ''
UNION ALL SELECT 'still alive (011 deferred)', (SELECT count(*)::text FROM finance_opening_balance)
UNION ALL SELECT
  'landed as a checkpoint',
  CASE WHEN EXISTS (
    SELECT 1 FROM finance_opening_balance o
    JOIN balance_checkpoints c
      ON c.user_id = o.user_id
     AND c.counted_at = o.as_of
     AND c.counted_minor = o.amount_minor
  ) THEN 'YES' ELSE 'NO' END
UNION ALL SELECT
  'on account',
  COALESCE((
    SELECT a.name || ' (' || a.currency || ')'
    FROM finance_opening_balance o
    JOIN balance_checkpoints c
      ON c.user_id = o.user_id AND c.counted_at = o.as_of AND c.counted_minor = o.amount_minor
    JOIN accounts a ON a.id = c.account_id
    LIMIT 1
  ), '—')
UNION ALL SELECT
  'currency matches that account',
  COALESCE((
    SELECT CASE WHEN a.currency = o.currency THEN 'YES' ELSE 'NO — ' || o.currency || ' onto ' || a.currency END
    FROM finance_opening_balance o
    JOIN balance_checkpoints c
      ON c.user_id = o.user_id AND c.counted_at = o.as_of AND c.counted_minor = o.amount_minor
    JOIN accounts a ON a.id = c.account_id
    LIMIT 1
  ), '—')

UNION ALL SELECT '', ''
UNION ALL SELECT 'THE NEW OBJECTS', ''
UNION ALL SELECT 'accounts',    (SELECT count(*)::text FROM accounts)
UNION ALL SELECT 'account names', (SELECT string_agg(name, ', ' ORDER BY sort_order, name) FROM accounts)
UNION ALL SELECT 'checkpoints', (SELECT count(*)::text FROM balance_checkpoints)
UNION ALL SELECT 'finance_settings rows', (SELECT count(*)::text FROM finance_settings)
UNION ALL SELECT
  'default account set',
  COALESCE((SELECT a.name FROM finance_settings s JOIN accounts a ON a.id = s.default_account_id LIMIT 1), 'NONE')
UNION ALL SELECT
  'rows still touching no account',
  (SELECT count(*)::text FROM transactions WHERE from_account_id IS NULL AND to_account_id IS NULL)
UNION ALL SELECT
  'rows backfilled to household (0 until a cutover date exists)',
  (SELECT count(*)::text FROM transactions WHERE beneficiary IS NOT NULL);
