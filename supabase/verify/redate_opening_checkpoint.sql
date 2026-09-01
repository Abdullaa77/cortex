-- The 1 July opening checkpoint, and why it has to move to 30 June.
--
-- Run the SELECT first, read it, then run the UPDATE if the numbers say what
-- this file says they will.
--
-- THE PROBLEM, in one sentence: a count is the last word for the day it was
-- taken, and 65 imported rows carry month precision and are stamped 1 July —
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
