-- @sentinel: table finance_opening_balance
-- ============================================
-- CORTEX — Finance: opening balance
-- ============================================
-- Why this exists:
--
-- July shows income 2,427,911.64, spend 3,451,961.38, moved out 5,392,000 and
-- moved in 160,000 — a net change of −6,256,049.74. That is only possible if
-- the month started holding at least that much, and nothing in the app said
-- so. Every month's totals were true and the page as a whole was not.
--
-- One row per user. One amount, one as-of date, entered once. Every later
-- month derives its opening from the previous month's closing rather than
-- being entered again — a second entered figure would be a second source of
-- truth, and the two would drift.
--
-- amount_minor has no CHECK (> 0), unlike transactions.amount_minor. A
-- balance of zero is a real answer, and someone starting a month owing more
-- than they hold is a real answer too. The constraint belongs on money that
-- moved, not on money held.

CREATE TABLE finance_opening_balance (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,

  amount_minor BIGINT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'UZS' CHECK (currency IN ('UZS', 'USD')),

  -- The instant the amount was held. Stored as a date, not a timestamp: a
  -- balance is a fact about a day, and pretending to know the minute would be
  -- the same invention that date_precision exists to prevent on transactions.
  as_of DATE NOT NULL,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  -- One per user. Editing means updating this row, never inserting a second.
  CONSTRAINT unique_opening_balance_per_user UNIQUE (user_id)
);

ALTER TABLE finance_opening_balance ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users own finance_opening_balance" ON finance_opening_balance
  FOR ALL USING (auth.uid() = user_id);

CREATE TRIGGER finance_opening_balance_updated_at
  BEFORE UPDATE ON finance_opening_balance
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
