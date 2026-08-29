-- @sentinel: column transactions.beneficiary
-- ============================================
-- CORTEX — Finance: who consumed it (Stage 3)
-- ============================================
-- Every row already knows whose money it was — that is the owner of the
-- account it left. What no row has ever known is WHO THE MONEY WAS FOR.
--
-- Mom's cash buying groceries the whole household eats is owner = 'mom' and
-- beneficiary = 'household'. Reported as "mom spent 400k" that is misleading.
-- Reported as "400k of household groceries, funded from mom's cash" it is true
-- and useful. Collapsing funding into consumption is what makes a shared
-- ledger read as an accusation, and this column is what stops it.
--
-- A NEW AXIS OVER THE SAME MONEY. Not one existing figure moves — not a
-- category total, not a month total, not the everyday floor, not either
-- reconciliation, not a position. src/lib/finance/acceptance.test.ts pins that
-- against a digest taken before Stage 2, and it is unchanged by this stage.

-- ============================================
-- The people, in one place
-- ============================================
-- accounts.owner and transactions.beneficiary are the same three names, plus
-- 'household' on the second. Writing the list out twice is how a fourth person
-- gets added to one and not the other, and then a beneficiary the accounts
-- cannot express sits in the ledger looking legitimate.
--
-- SQL has no import, so the shared list becomes a function and both CHECKs
-- call it. src/lib/finance/accounts.ts does the same thing with
-- ACCOUNT_OWNERS, and beneficiary.ts derives its type from that — three uses,
-- one list, in each language.

CREATE OR REPLACE FUNCTION is_finance_person(v TEXT)
RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = public, pg_temp
AS $$ SELECT v IN ('me', 'mom', 'sister') $$;

-- The same rule accounts has always had, now stated once instead of twice.
-- Values are identical, so no existing row can fail this.
ALTER TABLE accounts DROP CONSTRAINT accounts_owner_check;
ALTER TABLE accounts
  ADD CONSTRAINT accounts_owner_check CHECK (is_finance_person(owner));

-- ============================================
-- transactions.beneficiary
-- ============================================
-- NULLABLE, and NULL carries meaning: NOBODY RECORDED WHO THIS WAS FOR. It is
-- an absence, not a zero and not a household. The UI renders it as its own
-- labelled group — "not recorded" — and never folds it into anyone, and never
-- drops it out of a denominator. Same rule Stage 1 applied to the unknown side
-- of a transfer: a placeholder in a slot the user never filled asserts a
-- falsehood in place of an absence.
--
-- NO SPLITS, and no nullable split_json "for later". A 100k grocery run is not
-- evenly three ways, and modelling fractional consumption properly means split
-- rows, rounding rules, and a reconciliation that has to survive them. A column
-- that is always null is worse than no column, because the next person to read
-- this schema believes splits exist. If they are ever needed they get their own
-- stage and their own table.

ALTER TABLE transactions
  ADD COLUMN beneficiary TEXT
    CHECK (beneficiary IS NULL
        OR beneficiary = 'household'
        OR is_finance_person(beneficiary));

-- The breakdown is always asked for one month at a time, over spending only,
-- which the existing (user_id, occurred_at DESC) index already leads. This one
-- is for the narrower question the per-person view asks — "everything for
-- mom" — and stays out of the way of rows that have no beneficiary at all.
CREATE INDEX idx_transactions_beneficiary
  ON transactions(user_id, beneficiary, occurred_at DESC)
  WHERE beneficiary IS NOT NULL;

-- ============================================
-- Beneficiary belongs to spending, and to nothing else
-- ============================================
-- Only money that was consumed has a consumer.
--
--   income      -> nobody consumes money arriving; it has not been spent yet
--   transfer    -> money moving between two of the household's own containers
--                  is not consumed by either of them
--   unaccounted -> a gap nobody can explain has, by definition, no known
--                  consumer; guessing one would be the fiction that category
--                  exists to refuse
--
-- These are NULL as a matter of definition, not as a matter of nobody having
-- got round to them. Enforced rather than left optional, so "no beneficiary"
-- cannot drift into meaning "not filled in yet" — if both states were possible
-- on the same row, the NULL group would stop meaning anything.
--
-- IT CLEARS RATHER THAN RAISING, and that is a decision worth reading slowly.
-- Re-categorising a grocery row as Income is a legitimate edit; refusing it
-- with a message about beneficiaries would block a correction the user is
-- right to make, in language that explains nothing. Clearing is not a silent
-- repair of a mistake — for these rows NULL is the *only* correct value, so
-- the trigger is writing the answer rather than hiding a wrong one.
--
-- The read path does not rely on this. beneficiaryOf() in beneficiary.ts
-- returns null for the same rows independently, so a stale value that somehow
-- predates this trigger still cannot render. Two guards: a value wrong in
-- storage and right on screen is recoverable, one wrong on screen is not.
--
-- A trigger rather than a CHECK, because a CHECK cannot reach finance_categories
-- for the row's kind. Same shape as assert_transaction_account_currency in 009.

CREATE OR REPLACE FUNCTION clear_beneficiary_where_undefined()
RETURNS TRIGGER AS $$
DECLARE
  v_kind TEXT;
  v_slug TEXT;
BEGIN
  IF NEW.beneficiary IS NULL THEN
    RETURN NEW;
  END IF;

  -- A row with no category counts as spending, the same way classifyRow()
  -- defaults its kind to 'expense'. Answering differently here would give the
  -- uncategorised bucket no beneficiaries and make the groups stop adding up.
  IF NEW.category_id IS NOT NULL THEN
    SELECT kind, slug INTO v_kind, v_slug
    FROM finance_categories WHERE id = NEW.category_id;
  END IF;

  -- Also the not-found branch, which the foreign key should make unreachable.
  -- Left to three-valued logic, a NULL kind would make the test below evaluate
  -- to NULL rather than true, and the row would keep a beneficiary by accident.
  IF v_kind IS NULL THEN
    v_kind := 'expense';
    v_slug := NULL;
  END IF;

  IF NEW.direction <> 'expense'
     OR v_kind <> 'expense'
     OR COALESCE(v_slug, '') = 'unaccounted' THEN
    NEW.beneficiary := NULL;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public, pg_temp;

-- Fires on category_id and direction too, not just beneficiary: a row whose
-- category moves from Groceries to Income has to lose its beneficiary at the
-- same moment, or a stale 'household' outlives the fact that made it true.
CREATE TRIGGER transactions_beneficiary_scope
  BEFORE INSERT OR UPDATE OF beneficiary, category_id, direction ON transactions
  FOR EACH ROW EXECUTE FUNCTION clear_beneficiary_where_undefined();

-- ============================================
-- The backfill — this is the part that needs care
-- ============================================
-- 'household' is a default a person ACCEPTS. At capture time they are looking
-- at the confirmation strip and can change it in one tap, so letting the common
-- answer stand is a choice they made. A migration has nobody in front of it, so
-- anything it writes is a claim made on someone's behalf.
--
-- Three things therefore stay NULL:
--
--   * Anything before the cutover. Nobody knows who ate the July groceries.
--     Writing 'household' across those rows would assert something no human
--     ever checked, and it would then be INDISTINGUISHABLE from the rows where
--     he really did choose household. That is the whole cost — it does not just
--     add a wrong row, it destroys the meaning of the right ones.
--
--   * Anything reconstructed rather than captured. date_precision = 'month' is
--     exactly the 153 rows read back out of two months of notes: they carry a
--     month because no day was ever written down, and for the same reason no
--     consumer was. This guard is what protects them when no cutover is set at
--     all, where "before the cutover" is false for everything by design.
--
--   * Anything with no beneficiary by definition. The trigger above would clear
--     those anyway; the WHERE clause says so rather than relying on it, because
--     a backfill that depends on a trigger to be correct is a backfill nobody
--     can read.
--
-- What is left is a live capture, after the cutover, of money someone spent.
--
-- The rule is stated in TypeScript as backfillBeneficiary() in
-- beneficiary.ts, which is the tested copy; this is written to match, the same
-- arrangement sidesForClass and migration 009 already have.
--
-- Asia/Tashkent, not UTC. dayKey() compares LOCAL calendar days, because a
-- cutover is a fact about a day where the household is. Left at the database's
-- UTC default, a row captured at 02:00 Tashkent would resolve to the previous
-- day and could land on the wrong side of the line.
--
-- Re-runnable: only rows whose beneficiary is still NULL are touched.

UPDATE transactions t
   SET beneficiary = 'household'
  FROM finance_settings s
 WHERE s.user_id = t.user_id
   AND t.beneficiary IS NULL
   AND s.cutover_date IS NOT NULL
   AND t.date_precision = 'day'
   AND (t.occurred_at AT TIME ZONE 'Asia/Tashkent')::date >= s.cutover_date
   AND t.direction = 'expense'
   AND NOT EXISTS (
     SELECT 1 FROM finance_categories fc
      WHERE fc.id = t.category_id
        AND (fc.kind <> 'expense' OR fc.slug = 'unaccounted')
   );

-- ============================================
-- Stage 4 — noted here while it is obvious
-- ============================================
-- The household runway view needs no schema. It is the everyday floor, split by
-- beneficiary (which this stage provides), read against what the positions hold
-- — how many months the drawer covers, and how much of that burn is genuinely
-- shared. Nothing further is required in the database for it.
