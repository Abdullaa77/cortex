-- @sentinel: table accounts
-- ============================================
-- CORTEX — Finance: accounts (Stage 1)
-- ============================================
-- Money doesn't leave, it MOVES. This is a household treasury for three
-- people, and the question it has to answer is "where is it", not "what did I
-- buy". Positions are primary; transactions explain the changes between them.
--
-- STAGE 1 CHANGES NO BEHAVIOUR. Nothing on /finance or /finance/transactions
-- moves by a tiyin. The columns are added, the 153 imported rows are pointed
-- at a single account, and every calculation carries on reading exactly what
-- it read before. That is the point: when Stage 2 breaks something, we will
-- know it was not the schema.
--
-- The acceptance test for this migration lives in
-- src/lib/finance/acceptance.test.ts and compares every number both pages can
-- render against a snapshot taken before the change.

-- ============================================
-- accounts
-- ============================================
-- ONE CURRENCY PER ACCOUNT, never mixed. Mom's som cash and mom's dollar cash
-- are two accounts even though they live in the same drawer — because that is
-- how they get counted, and the counting is the whole point of Stage 2. It
-- also keeps FX honest: positions stay native, and the household total is a
-- conversion at a stated rate rather than a number that has quietly averaged
-- two currencies together.

CREATE TABLE accounts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,

  name TEXT NOT NULL,

  -- Whose money it is. Scott is the single point every som passes through,
  -- but the som still belongs to someone.
  owner TEXT NOT NULL DEFAULT 'me' CHECK (owner IN ('me', 'mom', 'sister')),

  currency TEXT NOT NULL DEFAULT 'UZS' CHECK (currency IN ('UZS', 'USD')),
  kind TEXT NOT NULL DEFAULT 'cash' CHECK (kind IN ('cash', 'card', 'savings')),

  -- What the account held when it was first counted. No CHECK (> 0), for the
  -- same reason finance_opening_balance has none: zero is a real answer, and
  -- so is a card that starts overdrawn. The constraint belongs on money that
  -- moved, not on money held.
  opening_minor BIGINT NOT NULL DEFAULT 0,
  -- NULL until someone has actually counted it. A date here is a claim that a
  -- physical count happened on that day, and inventing one would be the same
  -- fiction date_precision exists on transactions to prevent.
  opening_at DATE,

  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  -- Names are how Scott refers to accounts out loud ("mom's cash"), so two
  -- accounts sharing one are indistinguishable at the point of use. This also
  -- makes the backfill below re-runnable.
  CONSTRAINT unique_account_name_per_user UNIQUE (user_id, name)
);

ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users own accounts" ON accounts
  FOR ALL USING (auth.uid() = user_id);

CREATE INDEX idx_accounts_user ON accounts(user_id, sort_order)
  WHERE is_active = true;

CREATE TRIGGER accounts_updated_at BEFORE UPDATE ON accounts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================
-- transactions: which account did the money touch
-- ============================================
--   expense  -> from = an account, to = NULL   (it left the household)
--   income   -> from = NULL, to = an account   (it entered the household)
--   transfer -> both set                       (it moved between accounts)
--
-- BOTH NULLABLE, and that is deliberate twice over. The 153 imported rows
-- predate any of this and must not be forced into a shape they never had; and
-- capture is untouched in Stage 1, so `-10k banana` keeps writing a row with
-- neither side set. A NOT NULL here would either reject that row or make the
-- import invent an account for it.

ALTER TABLE transactions
  ADD COLUMN from_account_id UUID REFERENCES accounts(id) ON DELETE SET NULL,
  ADD COLUMN to_account_id   UUID REFERENCES accounts(id) ON DELETE SET NULL;

-- Money cannot move from an account to itself. Nothing changes, and a row
-- claiming otherwise would inflate the transfer totals on both sides.
ALTER TABLE transactions
  ADD CONSTRAINT accounts_differ
    CHECK (from_account_id IS NULL
        OR to_account_id IS NULL
        OR from_account_id <> to_account_id);

-- ON DELETE SET NULL, not CASCADE, matching reimburses_transaction_id in 007:
-- deleting an account must not delete the record of what was spent from it.
-- The history survives and loses its pointer.
--
-- Note on RLS: transactions is already FOR ALL USING (auth.uid() = user_id),
-- and so is accounts. A user cannot point a row of theirs at an account they
-- cannot see, because the id would not be selectable to begin with.
--
-- Note on currency: nothing yet enforces that a transaction's currency matches
-- its account's. Every transaction today is UZS and every account seeded below
-- is UZS, so there is nothing to violate. Stage 2 introduces the first USD
-- account and owns that constraint — adding it now would be a rule with no
-- data to check.

-- Stage 2 asks "what is in this account" constantly; the imported rows already
-- make these indexes worth having.
CREATE INDEX idx_transactions_from_account
  ON transactions(from_account_id, occurred_at DESC)
  WHERE from_account_id IS NOT NULL;
CREATE INDEX idx_transactions_to_account
  ON transactions(to_account_id, occurred_at DESC)
  WHERE to_account_id IS NOT NULL;

-- ============================================
-- finance_settings
-- ============================================
-- User-level finance settings. One row per user, everything nullable and
-- unset by default, so its existence changes nothing until something is put
-- in it.
--
-- cutover_date is the first tenant. Scott wants a clean start: everything
-- before the cutover is REFERENCE, not truth. His existing gap gets
-- acknowledged once and left behind, rather than carried forward forever as a
-- discrepancy that never reconciles.
--
-- STAGE 1 STORES THE DATE AND NOTHING ELSE. No calculation reads it yet.
-- Pre-cutover rows are marked by DERIVING `occurred_at < cutover_date` in the
-- read path (see src/lib/finance/cutover.ts), not by a stored boolean on
-- transactions: a stored flag would duplicate this date, and go stale the
-- moment the date was edited. Same rule as the opening balance — one source of
-- truth, or the two drift.
--
-- More settings will land here: default account, display currency, the
-- reconciliation tolerance band, the FX rate the household total is stated at.

CREATE TABLE finance_settings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,

  -- NULL = no cutover set. Everything is truth.
  cutover_date DATE,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  -- One per user. Saving is an upsert on user_id, never a second insert.
  CONSTRAINT unique_finance_settings_per_user UNIQUE (user_id)
);

ALTER TABLE finance_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users own finance_settings" ON finance_settings
  FOR ALL USING (auth.uid() = user_id);

CREATE TRIGGER finance_settings_updated_at BEFORE UPDATE ON finance_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================
-- Backfill
-- ============================================
-- Every existing transaction gets pointed at one seeded account named 'Main'
-- (owner: me, currency: UZS, kind: cash) — the single undifferentiated pot the
-- imported notes were actually written against.
--
-- The side of Main the money touched is read from `direction`, and from
-- nothing else:
--
--   direction = 'expense' -> from = Main, to = NULL   (it left Main)
--   direction = 'income'  -> from = NULL, to = Main   (it arrived at Main)
--
-- TRANSFERS FOLLOW THE SAME RULE, and this is the one place worth reading
-- slowly. A transfer's *other* account does not exist yet, so that side stays
-- NULL — the confirmed 4,850,000 gets from = Main, to = NULL, and no attempt
-- is made to guess that it went to a dollar account. Guessing would write
-- fiction into the ledger; Stage 2 maps those destinations once the real
-- accounts are there.
--
-- But an INCOMING transfer — July's 160,000, the unnamed `+200k cash` return
-- leg — arrived at Main from somewhere unknown. Its unknown side is the
-- *source*, so it gets from = NULL, to = Main. Writing from = Main for it
-- would say the money left when it in fact arrived, which is not a missing
-- fact but a wrong one. Leaving the unknown side NULL is the rule; which side
-- is unknown depends on which way the money went.
--
-- Category kind is deliberately not consulted. A transfer and a purchase both
-- take money out of Main; what distinguishes them is whether it is spending,
-- and that question is already answered by classifyRow() in the read path.
--
-- opening_minor stays 0 and opening_at stays NULL. finance_opening_balance is
-- NOT copied in here: two rows claiming what the ledger started with is the
-- exact drift this codebase keeps killing, and the reconciliation still reads
-- the old table, so seeding a second figure would either change a number on
-- screen or sit there waiting to. Stage 2 owns that migration — see below.
--
-- Re-runnable: the account insert is ON CONFLICT DO NOTHING and the updates
-- only touch rows whose account columns are still NULL.

DO $$
DECLARE
  v_user UUID;
  v_main UUID;
BEGIN
  FOR v_user IN SELECT DISTINCT user_id FROM transactions LOOP
    INSERT INTO accounts (user_id, name, owner, currency, kind, sort_order)
    VALUES (v_user, 'Main', 'me', 'UZS', 'cash', 0)
    ON CONFLICT (user_id, name) DO NOTHING;

    SELECT id INTO v_main
    FROM accounts
    WHERE user_id = v_user AND name = 'Main';

    UPDATE transactions
       SET from_account_id = v_main
     WHERE user_id = v_user
       AND direction = 'expense'
       AND from_account_id IS NULL
       AND to_account_id IS NULL;

    UPDATE transactions
       SET to_account_id = v_main
     WHERE user_id = v_user
       AND direction = 'income'
       AND from_account_id IS NULL
       AND to_account_id IS NULL;
  END LOOP;
END $$;

-- ============================================
-- Stage 2 — write this down now, while it is obvious
-- ============================================
-- RETIRE finance_opening_balance. Once accounts carry opening_minor and
-- opening_at, that table is just the single-account version of the same thing,
-- and two places holding "what did you start with" is precisely the drift we
-- keep killing. Stage 2 must MIGRATE it into the accounts' opening figures and
-- DROP it — not leave both alive. Migration 006 exists because one entered
-- figure had no home; it should not survive into a world where every account
-- has one.
--
-- Also Stage 2: real accounts per person, per-currency balances, the physical
-- count-and-reconcile checkpoint, mapping the existing transfers to their real
-- destinations, the household view, and the first rule that reads cutover_date.
