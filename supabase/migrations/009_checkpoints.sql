-- ============================================
-- CORTEX — Finance: the count that proves the ledger (Stage 2)
-- ============================================
-- Stage 1 taught the schema what an account is and changed nothing a person
-- could see. This is the stage where the product arrives, and it arrives by
-- inverting the usual arrangement.
--
-- Scott's household runs on physical cash for three people, and he is the
-- single point every som passes through. That makes possible the one thing no
-- subscription tracker can do: HE CAN OPEN THE DRAWER AND COUNT. So the ledger
-- is not the authority here. The count is. Transactions are a running story
-- about what happened between two counts, and where the story disagrees with
-- the drawer, the drawer wins — and the disagreement is itself a finding.
--
-- Positions are primary. Transactions explain the changes between them.

-- ============================================
-- The 'unaccounted' category
-- ============================================
-- Every count that disagrees with the ledger writes a visible adjustment
-- transaction closing the gap, and it is filed here — never merged into a real
-- category, never applied silently.
--
-- That is the whole design argument. A recurring gap of the same sign is
-- INFORMATION: it means Scott is systematically not logging one kind of spend.
-- Folding it into "Other", or into whichever category looks nearest, destroys
-- exactly the signal worth having and leaves a category total that is quietly
-- wrong. Kept separate, the signal survives — "you lose about 200k a month you
-- never type" is a sentence the app can only say if it never hid the money.
--
-- kind = 'expense', deliberately, and the DIRECTION carries the sign:
--
--   money went missing -> direction 'expense' -> classifyRow says 'spend'
--   money appeared     -> direction 'income'  -> classifyRow says 'income'
--
-- So the adjustment moves the derived balance, which is the point of writing
-- it — a gap that does not move the balance has not been closed. And because
-- 'unaccounted' is not in CORE_SLUGS, the everyday floor stays a statement
-- about groceries, transport and eating out rather than absorbing the leak.

CREATE OR REPLACE FUNCTION seed_finance_categories(p_user_id UUID)
RETURNS void AS $$
BEGIN
  IF auth.uid() IS NULL OR p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'seed_finance_categories: not authorized for this user';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM finance_categories WHERE user_id = p_user_id) THEN
    INSERT INTO finance_categories (user_id, slug, name, icon, color, kind, sort_order) VALUES
      (p_user_id, 'groceries',      'Groceries',       '⌗',  '#00FF88', 'expense',  0),
      (p_user_id, 'transport',      'Transport',       '→',  '#06B6D4', 'expense',  1),
      (p_user_id, 'eating-out',     'Eating out',      '◐',  '#F59E0B', 'expense',  2),
      (p_user_id, 'ehsan',          'Ehsan',           '☾',  '#D4AF37', 'expense',  3),
      (p_user_id, 'documents',      'Documents',       '▤',  '#8B5CF6', 'expense',  4),
      (p_user_id, 'clothing',       'Clothing',        '◇',  '#EC4899', 'expense',  5),
      (p_user_id, 'grooming',       'Grooming',        '✂',  '#EC4899', 'expense',  6),
      (p_user_id, 'travel',         'Travel',          '↗',  '#3B82F6', 'expense',  7),
      (p_user_id, 'phone-internet', 'Phone + net',     '◈',  '#3B82F6', 'expense',  8),
      (p_user_id, 'utilities',      'Utilities',       '⌂',  '#6B7280', 'expense',  9),
      (p_user_id, 'work-tools',     'Work tools',      '{}', '#00FF88', 'expense', 10),
      (p_user_id, 'health',         'Health',          '♥',  '#EF4444', 'expense', 11),
      (p_user_id, 'entertainment',  'Entertainment',   '◉',  '#F59E0B', 'expense', 12),
      (p_user_id, 'gifts-events',   'Gifts + events',  '❋',  '#EC4899', 'expense', 13),
      (p_user_id, 'investment',     'Investment',      '↑',  '#22C55E', 'expense', 14),
      (p_user_id, 'income',         'Income',          '+',  '#22C55E', 'income',  15),
      (p_user_id, 'transfer',       'Transfer / debt', '⇄',  '#6B7280', 'transfer', 16),
      (p_user_id, 'unaccounted',    'Unaccounted',     '≠',  '#EF4444', 'expense', 17);
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- Existing users seeded before this migration have the other sixteen and not
-- this one. Their next count needs somewhere to file its adjustment.
INSERT INTO finance_categories (user_id, slug, name, icon, color, kind, sort_order)
SELECT DISTINCT user_id, 'unaccounted', 'Unaccounted', '≠', '#EF4444', 'expense', 17
FROM finance_categories
ON CONFLICT (user_id, slug) DO NOTHING;

-- ============================================
-- Repair migration 008's backfill
-- ============================================
-- 008 chose which side of 'Main' a row touched by reading `direction`, and
-- nothing else. On the real 153 rows that is wrong exactly once, and the once
-- is instructive.
--
--   "4,625,000 salary (July)"
--
-- The line carries no leading plus, so the parser wrote direction = 'expense'.
-- It says salary, so the categoriser filed it under Income. `classifyRow` has
-- always resolved that in the ledger's favour — kind beats direction — which
-- is why every figure on /finance is correct and always has been. The account
-- pointers resolved it the other way, so Main was recorded as having 4,625,000
-- LEAVE when in fact it arrived. A 9,250,000 so'm error in the position, from
-- one row, with every month total still perfect.
--
-- Nothing could see it until this stage, because until this stage nothing
-- derived a position from the pointers. That is the argument for counting, in
-- one row of real data: the ledger was self-consistent and wrong, and only a
-- second, independent way of arriving at the same number could say so.
--
-- The rule, from here on, is the ledger's own: ask what the row COUNTS AS.
--
--   transfer-in / income  -> the money arrived  -> to_account_id
--   transfer-out / spend  -> the money left     -> from_account_id
--
-- which is `classifyRow` in summarize.ts and `sidesForClass` in accounts.ts,
-- written here a third time only because SQL cannot call them.
--
-- Only rows with exactly one side set are touched, and only to move that side.
-- A transfer whose other end has since been named by hand must not be undone
-- by a migration, and a row already pointing both ways is answered.

UPDATE transactions t
   SET from_account_id = NULL,
       to_account_id   = t.from_account_id
  FROM finance_categories c
 WHERE c.id = t.category_id
   AND t.from_account_id IS NOT NULL
   AND t.to_account_id IS NULL
   AND (c.kind = 'income' OR (c.kind = 'transfer' AND t.direction = 'income'));

UPDATE transactions t
   SET to_account_id   = NULL,
       from_account_id = t.to_account_id
  FROM finance_categories c
 WHERE c.id = t.category_id
   AND t.to_account_id IS NOT NULL
   AND t.from_account_id IS NULL
   AND c.kind = 'expense'
   AND t.direction = 'expense';

-- ============================================
-- balance_checkpoints
-- ============================================
-- ONE CONCEPT, NOT TWO. Stage 1's notes put opening_minor / opening_at on the
-- accounts table, and that was a mistake worth naming: an opening balance is
-- not a property of an account, it is simply THE FIRST TIME SOMEONE COUNTED
-- IT. Modelling it separately gives two tables answering "what was in there",
-- and two answers drift.
--
-- So there is one table, and the earliest checkpoint for an account IS its
-- opening balance. The read path becomes one rule with no special case:
--
--   balance at T = latest checkpoint at-or-before T
--                  + transactions between that checkpoint and T
--
-- Reconciliation stops being a feature and becomes the normal way a balance is
-- read.

CREATE TABLE balance_checkpoints (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,

  -- CASCADE, unlike transactions' SET NULL. A transaction without its account
  -- still records that money was spent and is worth keeping; a count of an
  -- account that no longer exists is a number with nothing to be about.
  account_id UUID REFERENCES accounts(id) ON DELETE CASCADE NOT NULL,

  -- A DATE, not a timestamp. A count is a fact about a day — you emptied the
  -- drawer some time that afternoon — and recording the minute would be the
  -- same invention date_precision exists on transactions to prevent.
  counted_at DATE NOT NULL,

  -- What was actually there. No CHECK (> 0): zero is a real count, and a card
  -- can genuinely be overdrawn. The constraint belongs on money that moved.
  counted_minor BIGINT NOT NULL,

  note TEXT,

  -- The adjustment this count wrote to close its gap, if it had one.
  -- SET NULL, not CASCADE: deleting the adjustment must not delete the record
  -- that a count happened. The gap simply reopens, visibly, which is honest.
  adjustment_transaction_id UUID REFERENCES transactions(id) ON DELETE SET NULL,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  -- One count per account per day. Counting twice in an afternoon and getting
  -- two figures is not two facts, it is one recount — and two checkpoints on
  -- one day would make "the latest checkpoint at-or-before T" ambiguous, which
  -- is the one thing the read path cannot afford.
  CONSTRAINT unique_checkpoint_per_account_day UNIQUE (account_id, counted_at)
);

ALTER TABLE balance_checkpoints ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users own balance_checkpoints" ON balance_checkpoints
  FOR ALL USING (auth.uid() = user_id);

-- The read path always asks "the latest checkpoint at-or-before this day, for
-- this account", so that is the index.
CREATE INDEX idx_balance_checkpoints_account
  ON balance_checkpoints(account_id, counted_at DESC);

CREATE TRIGGER balance_checkpoints_updated_at
  BEFORE UPDATE ON balance_checkpoints
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================
-- finance_settings gains its Stage 2 tenants
-- ============================================
-- default_account_id is what keeps capture at ten seconds. `-10k two bananas`
-- plus enter still books immediately, with no account picker in the hot path,
-- because the answer is already here. The account is editable afterwards.
-- The moment capture costs thirty seconds it stops being used daily, and
-- every downstream number rots — the default exists to prevent that, not as a
-- convenience.
--
-- uzs_per_usd is set BY HAND. There is no live FX fetch, deliberately: a rate
-- that moves on its own makes yesterday's household total unreproducible, and
-- Scott changes dollars at a counter, at a rate he knows. fx_rate_set_at is
-- stored so the total can state which rate it used and how old it is. A
-- household figure that does not name its rate is not a figure, it is a mood.

ALTER TABLE finance_settings
  ADD COLUMN default_account_id UUID REFERENCES accounts(id) ON DELETE SET NULL,
  -- Som per one dollar, in minor units of som (tiyin), so 12,650 so'm/$ is
  -- 1265000. Stored as an integer for the same reason every amount here is:
  -- floats do not add up.
  ADD COLUMN uzs_per_usd BIGINT CHECK (uzs_per_usd IS NULL OR uzs_per_usd > 0),
  ADD COLUMN fx_rate_set_at DATE;

-- ============================================
-- Migrate the two opening balances into checkpoints, then drop them
-- ============================================
-- Both of these say "what was in there when this started", which is what a
-- checkpoint says. Stage 1 wrote down that finance_opening_balance must be
-- MIGRATED AND DROPPED here rather than left alive beside its replacement.
-- Doing so.
--
-- Order matters: accounts.opening_* first (it is per-account and needs no
-- guess), then finance_opening_balance (which is household-wide and has to
-- pick an account).

DO $$
DECLARE
  v_user UUID;
  v_account UUID;
  v_has_opening BOOLEAN;
BEGIN
  -- accounts.opening_minor / opening_at -> checkpoint #0 for that account.
  -- Only where opening_at is set: Stage 1 left it NULL until someone had
  -- actually counted, and a checkpoint with an invented date would be a claim
  -- that a count happened when none did.
  INSERT INTO balance_checkpoints (user_id, account_id, counted_at, counted_minor, note)
  SELECT user_id, id, opening_at, opening_minor,
         'Migrated from the account''s opening balance.'
  FROM accounts
  WHERE opening_at IS NOT NULL
  ON CONFLICT (account_id, counted_at) DO NOTHING;

  -- Every user gets a default account, so capture has somewhere to land
  -- without asking. 'Main' is the pot migration 008 backfilled everything to.
  FOR v_user IN SELECT DISTINCT user_id FROM accounts LOOP
    SELECT id INTO v_account
    FROM accounts
    WHERE user_id = v_user AND is_active = true
    ORDER BY (name = 'Main') DESC, sort_order, name
    LIMIT 1;

    IF v_account IS NULL THEN CONTINUE; END IF;

    INSERT INTO finance_settings (user_id, default_account_id)
    VALUES (v_user, v_account)
    ON CONFLICT (user_id) DO UPDATE
      SET default_account_id = COALESCE(finance_settings.default_account_id, EXCLUDED.default_account_id);

    -- Rows captured after 008 ran have neither side set — Stage 1 left capture
    -- untouched on purpose, so `-10k banana` wrote a row belonging to no
    -- account. They belong to the default one, on the side the ledger says.
    -- Without this they would move no position and the drawer would disagree
    -- with the app by exactly the amount that was typed most recently, which
    -- is the worst possible set of rows to lose.
    UPDATE transactions t
       SET to_account_id = v_account
      FROM finance_categories c
     WHERE c.id = t.category_id
       AND t.user_id = v_user
       AND t.from_account_id IS NULL
       AND t.to_account_id IS NULL
       AND (c.kind = 'income' OR (c.kind = 'transfer' AND t.direction = 'income'));

    UPDATE transactions t
       SET from_account_id = v_account
     WHERE t.user_id = v_user
       AND t.from_account_id IS NULL
       AND t.to_account_id IS NULL;

    -- finance_opening_balance -> checkpoint #0 on that same account. It was
    -- always the single-account version of this table; it predates accounts
    -- existing at all, which is the only reason it was ever its own row.
    SELECT EXISTS (SELECT 1 FROM finance_opening_balance WHERE user_id = v_user)
      INTO v_has_opening;

    IF v_has_opening THEN
      INSERT INTO balance_checkpoints (user_id, account_id, counted_at, counted_minor, note)
      SELECT user_id, v_account, as_of, amount_minor,
             'Migrated from the opening balance entered before accounts existed.'
      FROM finance_opening_balance
      WHERE user_id = v_user
      ON CONFLICT (account_id, counted_at) DO NOTHING;
    END IF;
  END LOOP;
END $$;

DROP TABLE finance_opening_balance;

-- The columns Stage 1 added and this stage retired. Dropped rather than left
-- as a second place to write the same fact — leaving them would guarantee that
-- one day something writes to one and reads the other.
ALTER TABLE accounts
  DROP COLUMN opening_minor,
  DROP COLUMN opening_at;

-- ============================================
-- Currency: a transaction may only touch an account that holds its currency
-- ============================================
-- Stage 1 left this unenforced and said so: every transaction was UZS and the
-- one seeded account was UZS, so it was a rule with no data to check. Stage 2
-- introduces the first USD account — mom's dollar cash — and with it the first
-- way to be wrong. A 400,000 UZS expense pointed at a dollar envelope would
-- subtract four hundred thousand DOLLARS from that position, and the number
-- would look plausible enough on a page to go unnoticed.
--
-- A trigger rather than a CHECK, because a CHECK cannot reach another table.

CREATE OR REPLACE FUNCTION assert_transaction_account_currency()
RETURNS TRIGGER AS $$
DECLARE
  v_currency TEXT;
BEGIN
  IF NEW.from_account_id IS NOT NULL THEN
    SELECT currency INTO v_currency FROM accounts WHERE id = NEW.from_account_id;
    IF v_currency IS DISTINCT FROM NEW.currency THEN
      RAISE EXCEPTION
        'transaction is % but from_account holds %', NEW.currency, v_currency;
    END IF;
  END IF;

  IF NEW.to_account_id IS NOT NULL THEN
    SELECT currency INTO v_currency FROM accounts WHERE id = NEW.to_account_id;
    IF v_currency IS DISTINCT FROM NEW.currency THEN
      RAISE EXCEPTION
        'transaction is % but to_account holds %', NEW.currency, v_currency;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public, pg_temp;

CREATE TRIGGER transactions_account_currency
  BEFORE INSERT OR UPDATE OF currency, from_account_id, to_account_id ON transactions
  FOR EACH ROW EXECUTE FUNCTION assert_transaction_account_currency();

-- ============================================
-- transfer_pair_id
-- ============================================
-- A cross-currency transfer cannot be one row, and should not be: 4,850,000
-- so'm leaving and $400 arriving are two amounts at a rate someone agreed to,
-- and one row would have to silently elect one of them as the truth. Nor is it
-- a distortion to call it two movements — the som genuinely went out to
-- someone who changed it, and dollars genuinely came back.
--
-- So it is two rows, each naming the one account it actually touched, pointing
-- at each other. The rate Scott got is then IMPLIED by the pair rather than
-- assumed by the app, which means a bad exchange stays visible as a bad
-- exchange instead of vanishing into a balance.
--
-- Self-referential and SET NULL: unpairing must leave both rows intact, the
-- same way unlinking a reimbursement does. Nothing is deleted to undo a claim
-- about how two things relate.

ALTER TABLE transactions
  ADD COLUMN transfer_pair_id UUID REFERENCES transactions(id) ON DELETE SET NULL;

ALTER TABLE transactions
  ADD CONSTRAINT transfer_pair_is_not_self
    CHECK (transfer_pair_id IS NULL OR transfer_pair_id <> id);

CREATE INDEX idx_transactions_transfer_pair ON transactions(transfer_pair_id)
  WHERE transfer_pair_id IS NOT NULL;

-- NOT backfilled, and that is the point of the "needs the other side" queue.
-- The 4,850,000 went to a dollar position and the +151,000 came from his
-- sister; both facts are knowable, and knowable BY SCOTT. A migration that
-- guessed them would write fiction that reads exactly like history a week
-- later. See src/lib/finance/transfers.ts.

-- ============================================
-- Stage 3 and 4 — noted here while it is obvious
-- ============================================
-- Beneficiary (who consumed it, as against who paid) is Stage 3. It is a third
-- column on transactions, not a property of the account: mom's cash buying
-- groceries the whole household eats is owner='mom', beneficiary='household'.
-- The household runway view is Stage 4 and needs no schema.
