-- The 1 July opening checkpoint, and why it had to move to 30 June.
--
-- APPLIED 2026-09-01, before the cutover count, against checkpoint
-- 029f5696-ad71-4e30-bea7-968623783275 — Main, 6,125,000.00, the only
-- checkpoint that existed. Kept as the record of what was changed and why; it
-- is a one-shot and re-running it now matches nothing.
--
-- Read before: one checkpoint on 1 July; 65 rows stamped 1 July, all of them
-- month-precision, net -6,239,367.74 by the pointers; nothing on 30 June and
-- no transaction dated on or before it, so moving the date swallowed nothing.
--
-- Read after: the two derivations agree to 0.00 at the end of every month.
--
--   2026-07  opening  6,125,000.00  closing   -144,867.74
--   2026-08  opening   -144,867.74  closing  3,504,671.87
--   2026-09  opening  3,490,123.87  closing  3,490,123.87   (seeded at the cutover)
--
-- July closes 144,867.74 below zero and is flagged impossible. That is the
-- panel doing its job on reference data, not a consequence of the move: the
-- same opening produced the same July closing before it. The reconstructed
-- July notes are short about that much income.
--
-- 30 June IS THE CORRECT CLAIM, not a workaround. Scott entered that figure as
-- "the money I had at the beginning of July", which is a fact about the end of
-- 30 June. Migration 009 carried finance_opening_balance.as_of across verbatim
-- and the 1 July stamp was the fiction; this removes it rather than
-- compensating for it.
--
-- THE PROBLEM it was causing, in one sentence: a count is the last word for
-- the day it was taken, and 65 imported rows carry month precision and are stamped 1 July —
-- the same day as the opening checkpoint migration 009 carried across from
-- finance_opening_balance. So `balanceAt` treats the whole of July as already
-- inside the opening figure and drops it, while the month rollforward counts
-- every one of those rows. The two derivations on /finance then disagree by
-- exactly July's net change.
--
-- Dating it 30 June says the true thing instead: this is what was held BEFORE
-- any of these rows happened, which is what an opening balance is. The test
-- corpus has always dated it 30 June for this exact reason — see the note
-- beside OPENING_COUNTED_AT in src/lib/finance/__fixtures__/corpus.ts.
--
-- Nothing is lost. The amount does not change, the account does not change,
-- and the row keeps its id. Only the day it claims to be a fact about moves,
-- by one, onto the day it was always about.

-- ============================================
-- 1. READ THIS FIRST
-- ============================================
SELECT 'checkpoints dated 1 July'          AS k,
       count(*)::text                       AS v
  FROM balance_checkpoints WHERE counted_at = '2026-07-01'
UNION ALL
SELECT '  on account',
       COALESCE((SELECT string_agg(a.name, ', ')
                   FROM balance_checkpoints c JOIN accounts a ON a.id = c.account_id
                  WHERE c.counted_at = '2026-07-01'), '—')
UNION ALL
SELECT '  amount',
       COALESCE((SELECT to_char(sum(counted_minor)/100.0, 'FM999,999,999.00')
                   FROM balance_checkpoints WHERE counted_at = '2026-07-01'), '—')
UNION ALL
SELECT 'rows stamped 1 July (swallowed by it)',
       (SELECT count(*)::text FROM transactions
         WHERE (occurred_at AT TIME ZONE 'Asia/Tashkent')::date = '2026-07-01')
UNION ALL
SELECT '  their net change',
       (SELECT to_char(sum(CASE WHEN t.to_account_id IS NOT NULL THEN t.amount_minor
                                ELSE -t.amount_minor END)/100.0, 'FM999,999,999.00')
          FROM transactions t
         WHERE (t.occurred_at AT TIME ZONE 'Asia/Tashkent')::date = '2026-07-01')
UNION ALL
SELECT 'a checkpoint already on 30 June?',
       CASE WHEN EXISTS (SELECT 1 FROM balance_checkpoints WHERE counted_at = '2026-06-30')
            THEN 'YES — STOP, read below' ELSE 'no, the day is free' END;

-- If that last row says YES, do not run the UPDATE. There is a UNIQUE on
-- (account_id, counted_at), so the move would fail — and two opening figures
-- one day apart is a question about which is real, not something to resolve
-- with a date shuffle.

-- ============================================
-- 2. THE MOVE
-- ============================================
-- Scoped to the migrated opening only. A count Scott took by hand on 1 July
-- would be a real fact about that day and must not be dragged backwards, so
-- the note migration 009 wrote is part of the match.

UPDATE balance_checkpoints
   SET counted_at = '2026-06-30',
       note = COALESCE(note, '') ||
              ' Re-dated from 2026-07-01: the imported July rows carry that same '
              'date, and a count supersedes its own day.'
 WHERE counted_at = '2026-07-01'
   AND note LIKE 'Migrated from the opening balance%';

-- ============================================
-- 3. READ THIS AFTER
-- ============================================
-- Expect: the checkpoint on 30 June, the same amount, and every July row now
-- counted toward Main's position.
SELECT 'checkpoint now dated'  AS k,
       COALESCE((SELECT max(counted_at)::text FROM balance_checkpoints
                  WHERE note LIKE 'Migrated from the opening balance%'), '—') AS v
UNION ALL
SELECT 'its amount',
       COALESCE((SELECT to_char(counted_minor/100.0, 'FM999,999,999.00')
                   FROM balance_checkpoints
                  WHERE note LIKE 'Migrated from the opening balance%' LIMIT 1), '—')
UNION ALL
SELECT 'rows still stranded on the count''s own day',
       (SELECT count(*)::text FROM transactions
         WHERE (occurred_at AT TIME ZONE 'Asia/Tashkent')::date = '2026-06-30');
