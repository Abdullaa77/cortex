-- ============================================
-- CORTEX — Finance: linked transactions (reimbursements)
-- ============================================
-- The case this exists for:
--
--   -166,100  lunch
--   +113,000  two people paid him back
--
-- The lunch cost 53,100. The app showed a 166,100 expense and an unrelated
-- 113,000 transfer in, and no screen said those were the same event.
--
-- The link is a pointer, not an edit. Both rows keep their original amounts
-- forever — raw_input and amount_minor are what actually happened, and a
-- feature that rewrote them would destroy the record to improve a total. The
-- netting happens in the read path, where it can be undone by removing the
-- link.
--
-- The column lives on the incoming row and points at the expense it repays.
-- That direction is what allows several repayments against one expense — two
-- people paying separately is the original case — without a join table.
--
-- ON DELETE SET NULL, not CASCADE: deleting the lunch must not delete the
-- money that came back. It un-links, and the repayment returns to standing on
-- its own.

ALTER TABLE transactions
  ADD COLUMN reimburses_transaction_id UUID
    REFERENCES transactions(id) ON DELETE SET NULL;

-- A row cannot repay itself.
ALTER TABLE transactions
  ADD CONSTRAINT reimburses_not_self
    CHECK (reimburses_transaction_id IS NULL OR reimburses_transaction_id <> id);

-- The read path asks "what repays this expense?" for every expense on screen.
CREATE INDEX idx_transactions_reimburses ON transactions(reimburses_transaction_id)
  WHERE reimburses_transaction_id IS NOT NULL;

-- Note on RLS: transactions is already FOR ALL USING (auth.uid() = user_id),
-- which covers this column on both sides. A user cannot point a row of theirs
-- at a row they cannot see, because the UPDATE that sets it is checked against
-- the same policy, and the target id would not be selectable to begin with.
