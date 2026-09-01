-- The thirteen adjustments the cutover count should never have written.
--
-- NOT APPLIED. Run section 1, read it, and only then run section 2.
--
-- WHAT HAPPENED. Scott counted 13 drawers on 1 September 2026. Every count
-- reconciled against Main's migrated opening balance — a figure derived from
-- two months of notes reconstructed after the fact — and filed the difference
-- as `unaccounted` spend. September read 3,502,671.87 of spending against a
-- real 14,548, and the everyday floor read "0% of the month".
--
-- WHY THE GUARD DID NOT FIRE. `reconcileCount` suppresses a count taken ON the
-- cutover date, and it is tested to death. The test could not see this: the
-- guard reads `if (cutoverDate && countedAt === cutoverDate)`, and
-- `finance_settings.cutover_date` IS NULL. Migration 009 creates the settings
-- row with `default_account_id` only; the ONLY code that ever writes
-- cutover_date is step 0 of /finance/cutover, and the `count` button on
-- PositionsCard never goes near it. An unset setting did not fail — it made
-- the guard inert and the reconciliation proceed exactly as designed.
--
-- The same NULL caused the second symptom. `rollforward` seeds the cutover
-- month from the count only when the date is set, so September opened from
-- August's reconstructed closing (6,463,295.30) instead of from the drawer
-- (2,960,623.43). One missing setting, two wrong figures.
--
-- THE CODE IS FIXED SEPARATELY, and this file is still needed. A count taken
-- with no line set now DRAWS the line at its own day and writes nothing, and
-- says so on screen before saving (see `cutoverLineFor`). That prevents the
-- next occurrence; it does not undo the thirteen rows already written, and it
-- will never fire for Scott again because 2b sets the date below.
--
-- THE CHECKPOINTS SURVIVE. `balance_checkpoints.adjustment_transaction_id` is
-- ON DELETE SET NULL, deliberately (009, line 172): deleting an adjustment must
-- not delete the record that a count happened. The pointer goes null and the
-- gap reopens, visibly, which is honest. Nothing about the 13 counts is lost.


-- ============================================
-- 1. READ FIRST
-- ============================================

-- 1a. The cause, stated. Expect cutover_date = NULL.
--     If it is a DATE other than 2026-09-01, stop — the fix below is still
--     right but the reason above is not, and it should be written down.
SELECT cutover_date, default_account_id, uzs_per_usd, fx_rate_set_at
FROM finance_settings;

-- 1b. EXACTLY WHAT SECTION 2 DELETES. Identified by the checkpoint that points
--     at it, never by category or date: only these rows were written by a
--     count, and a category-and-date match could sweep up a real Unaccounted
--     row Scott typed himself.
--
--     Expect 13 rows, all on 2026-09-01, all `unaccounted`, summing to
--     3,488,123.87.
SELECT
  a.name                        AS account,
  a.currency,
  c.id                          AS checkpoint_id,
  c.counted_at,
  c.counted_minor / 100.0       AS counted,
  t.id                          AS adjustment_id,
  t.direction,
  t.amount_minor / 100.0        AS adjustment,
  t.occurred_at,
  fc.slug                       AS category,
  t.raw_input
FROM balance_checkpoints c
JOIN accounts a            ON a.id  = c.account_id
JOIN transactions t        ON t.id  = c.adjustment_transaction_id
LEFT JOIN finance_categories fc ON fc.id = t.category_id
WHERE c.counted_at = '2026-09-01'
ORDER BY a.sort_order, a.name;

-- 1c. The same set, totalled. Expect 13 and 3488123.87.
SELECT count(*) AS rows_to_delete,
       sum(t.amount_minor) / 100.0 AS total
FROM balance_checkpoints c
JOIN transactions t ON t.id = c.adjustment_transaction_id
WHERE c.counted_at = '2026-09-01';

-- 1d. SAFETY. Any `unaccounted` row dated 1 September that NO checkpoint points
--     at — an orphan from a superseded recount, or one Scott typed by hand.
--     Section 2 leaves these alone. Expect 0 rows; if not, decide on them
--     one at a time before continuing.
SELECT t.id, t.amount_minor / 100.0 AS amount, t.occurred_at, t.comment, t.raw_input
FROM transactions t
JOIN finance_categories fc ON fc.id = t.category_id
WHERE fc.slug = 'unaccounted'
  AND (t.occurred_at AT TIME ZONE 'Asia/Tashkent')::date = '2026-09-01'
  AND NOT EXISTS (
    SELECT 1 FROM balance_checkpoints c WHERE c.adjustment_transaction_id = t.id
  );


-- ============================================
-- 2. THE FIX  — run only after reading section 1
-- ============================================
-- Both halves, in one transaction. Deleting the adjustments without setting
-- the date would leave September opening at 6,463,295.30 and would let the
-- next count on the line write the whole thing again.

BEGIN;

-- 2a. Remove the adjustments. The FK sets each checkpoint's pointer to NULL;
--     the counts themselves are untouched.
DELETE FROM transactions t
USING balance_checkpoints c
WHERE t.id = c.adjustment_transaction_id
  AND c.counted_at = '2026-09-01';

-- 2b. Declare the line. Scoped to the user who owns the counts rather than
--     applied to every row, because the SQL editor runs without RLS.
UPDATE finance_settings s
SET cutover_date = '2026-09-01'
WHERE s.user_id = (
  SELECT user_id FROM balance_checkpoints WHERE counted_at = '2026-09-01' LIMIT 1
);

-- 2c. Read before committing. Expect 13 / 0 / 2026-09-01.
SELECT
  (SELECT count(*) FROM balance_checkpoints WHERE counted_at = '2026-09-01')
    AS counts_still_here,
  (SELECT count(adjustment_transaction_id) FROM balance_checkpoints WHERE counted_at = '2026-09-01')
    AS still_pointing_at_an_adjustment,
  (SELECT cutover_date FROM finance_settings LIMIT 1)
    AS cutover_date;

COMMIT;
-- ROLLBACK;  -- if 2c did not say 13 / 0 / 2026-09-01
