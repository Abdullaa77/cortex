-- The cutover adjustment that should never have been written.
--
-- APPLIED 2026-09-01. One row, by id: transaction
-- a029b69b-2acf-4b34-9fa7-edc7f6beb688, Wallet, 3,488,123.87 so'm, direction
-- expense, category `unaccounted`, dated 2026-09-01 07:00Z. Kept as the record
-- of what was removed and why; re-running it now matches nothing.
--
-- ---------------------------------------------------------------------------
-- WHAT HAPPENED
--
-- Scott counted thirteen drawers on 1 September 2026. Twelve were first counts
-- and wrote nothing. The thirteenth, Wallet, already held a checkpoint — the
-- 30 June opening balance migration 009 carried across from
-- finance_opening_balance — so it had a basis, and that basis is a figure
-- derived from two months of notes reconstructed after the fact. The count
-- reconciled against it and filed the difference as spending:
--
--   count 2026-09-01: 2000 counted, 3490123.87 derived
--
-- September then read 3,502,671.87 of spending against a real 14,548, and the
-- everyday floor read 0% of the month.
--
-- ---------------------------------------------------------------------------
-- WHY THE GUARD DID NOT FIRE — and the wrong answer that fitted first
--
-- THE CODE THAT SUPPRESSES A CUTOVER COUNT WAS NEVER DEPLOYED. `reconcileCount`
-- learned the cutover date in e081ff5 and the rollforward learned to seed the
-- month in cd3c0eb, both committed on 1 September and neither pushed.
-- Production was serving 523c732, built 29 August, in which `reconcileCount`
-- takes no cutover date at all and `reconcile.ts` contains no reference to
-- one. The guard did not fail; it was not there.
--
-- THE FIRST DIAGNOSIS WAS `finance_settings.cutover_date IS NULL`, and it was
-- WRONG. It is worth writing down because it fitted every number exactly: an
-- absent guard and a guard whose input is unset produce identical output, so
-- no amount of arithmetic over the ledger could separate them. It was settled
-- by reading the database — cutover_date is 2026-09-01 and always was — and by
-- reading `git show origin/main:src/lib/finance/checkpoints.ts`. Data alone
-- could not have settled it.
--
-- The second symptom has the same cause. 523c732's `rollforward` has no
-- cutover seed, so September opened from August's reconstructed closing rather
-- than from the drawer. One undeployed commit, two wrong figures.
--
-- scripts/check-deployed.mjs and /api/version exist so that this question —
-- what is actually running — is answerable without a day of chasing.
--
-- ---------------------------------------------------------------------------
-- THE COUNT SURVIVED THE ADJUSTMENT
--
-- `balance_checkpoints.adjustment_transaction_id` is ON DELETE SET NULL,
-- deliberately (009, line 172): deleting an adjustment must not delete the
-- record that a count happened. Read after: 13 counts still on 2026-09-01,
-- Wallet's 2,000.00 unchanged, its pointer NULL, 0 rows left under
-- `unaccounted`, 180 transactions. The gap reopens visibly, which is honest.
--
-- Deleting it does NOT move the September panel — once the seed exists the
-- month counts only rows dated after the line, and this row is dated on it.
-- It was removed anyway, because it was still a false 3,488,123.87 in the
-- transactions list, the category breakdown, the waterfall and the beneficiary
-- split. Four wrong surfaces is four too many, and "the number he stares at is
-- fine" is not a reason to leave a fiction in the ledger.
--
-- NOT DELETED, AND CORRECTLY SO: finance_settings.cutover_date. It was already
-- 2026-09-01. The earlier draft of this file set it, on the strength of the
-- diagnosis that turned out to be wrong.


-- ============================================
-- 1. WHAT WAS READ FIRST
-- ============================================
-- Identified by the checkpoint that points at it, never by category and date:
-- an `unaccounted` row Scott typed himself must not be swept up by a pattern
-- match. Returned exactly one row.
SELECT
  a.name                        AS account,
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
JOIN accounts a                 ON a.id  = c.account_id
JOIN transactions t             ON t.id  = c.adjustment_transaction_id
LEFT JOIN finance_categories fc ON fc.id = t.category_id
ORDER BY a.sort_order, a.name;

-- Orphans: any `unaccounted` row NO checkpoint points at — from a superseded
-- recount, or typed by hand. These were to be left alone. Returned 0 rows.
SELECT t.id, t.amount_minor / 100.0 AS amount, t.occurred_at, t.comment
FROM transactions t
JOIN finance_categories fc ON fc.id = t.category_id
WHERE fc.slug = 'unaccounted'
  AND NOT EXISTS (
    SELECT 1 FROM balance_checkpoints c WHERE c.adjustment_transaction_id = t.id
  );


-- ============================================
-- 2. WHAT WAS RUN
-- ============================================
-- By id, not by predicate. The read above is what earned the right to name it.
DELETE FROM transactions
WHERE id = 'a029b69b-2acf-4b34-9fa7-edc7f6beb688'
RETURNING id, direction, amount_minor / 100.0 AS amount, occurred_at, raw_input;


-- ============================================
-- 3. WHAT WAS READ AFTER  — 13 / 2000.00 / NULL / 0
-- ============================================
SELECT
  (SELECT count(*) FROM balance_checkpoints WHERE counted_at = '2026-09-01')
    AS counts_still_here,
  (SELECT counted_minor / 100.0 FROM balance_checkpoints
     WHERE id = '3503769c-0ec9-4635-82c9-430857295d4c')
    AS wallet_count,
  (SELECT adjustment_transaction_id FROM balance_checkpoints
     WHERE id = '3503769c-0ec9-4635-82c9-430857295d4c')
    AS pointer_now,
  (SELECT count(*) FROM transactions t
     JOIN finance_categories fc ON fc.id = t.category_id
    WHERE fc.slug = 'unaccounted')
    AS unaccounted_rows_left;
