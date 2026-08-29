-- @sentinel: table transactions
-- ============================================
-- CORTEX — Finance module
-- ============================================
-- Design notes, so nobody re-litigates these in three months:
--
-- * Every transaction is UZS. Two months of real capture notes contain no
--   USD-denominated transaction — dollars appear only as purchased goods or
--   reference amounts ("for 400$", "API $10"). The currency column stays for
--   the day that changes, but there is deliberately no fx_rate / converted
--   amount column: there is nothing to convert.
--
-- * amount_minor is an integer at a uniform exponent of 2 (1 so'm = 100 minor
--   units). Never a float. UZS has no circulating subunit, but a uniform
--   exponent keeps the arithmetic identical across currencies if one is ever
--   added, and 10,120.29 already appears in the real data.
--
-- * raw_input keeps exactly what was typed, forever. The parse is a derived
--   view of it, and a parser fix must be able to re-derive from the original.
--
-- * Debt, repayments and changes of form are NOT spending. They carry a
--   category whose kind is 'transfer' and the spend views exclude them. No
--   third direction, no extra column.

CREATE TABLE finance_categories (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  icon TEXT DEFAULT '◉',
  color TEXT DEFAULT '#00FF88',
  kind TEXT NOT NULL DEFAULT 'expense' CHECK (kind IN ('expense', 'income', 'transfer')),
  sort_order INTEGER DEFAULT 0,
  is_archived BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT unique_slug_per_user UNIQUE (user_id, slug)
);

CREATE TABLE transactions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  -- Everything lives under an area, same as every other entity. Finance is
  -- Area #10, already seeded.
  area_id UUID REFERENCES areas(id) ON DELETE SET NULL,
  category_id UUID REFERENCES finance_categories(id) ON DELETE SET NULL,

  direction TEXT NOT NULL CHECK (direction IN ('expense', 'income')),
  amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
  currency TEXT NOT NULL DEFAULT 'UZS' CHECK (currency IN ('UZS', 'USD')),

  comment TEXT NOT NULL DEFAULT '',
  raw_input TEXT NOT NULL,

  -- 'inferred' = the rules guessed it, 'confirmed' = the user accepted or
  -- corrected that guess, 'manual' = set by hand at entry.
  category_source TEXT DEFAULT 'inferred'
    CHECK (category_source IN ('inferred', 'confirmed', 'manual')),
  -- Parser flags carried through, so a review screen can show why a row was
  -- held back without re-parsing.
  needs_review BOOLEAN DEFAULT false,
  parse_flags TEXT[] DEFAULT '{}',

  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- How much of occurred_at is real. Imported rows come from notes with no
  -- per-line date — only a month header — so they land on the 1st and say
  -- 'month'. Anything typed into the app knows its day and says 'day'.
  -- Without this, a daily view built three months from now stacks every
  -- imported row on the 1st and reads as if a month's spending happened on
  -- day one. The column is what lets the code see the difference instead of
  -- relying on someone remembering the convention.
  date_precision TEXT NOT NULL DEFAULT 'day'
    CHECK (date_precision IN ('day', 'month')),
  import_batch_id UUID,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Learned keyword -> category map. A correction the user makes by hand is
-- stored here so the same comment classifies correctly next time.
CREATE TABLE finance_category_rules (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  keyword TEXT NOT NULL,
  category_id UUID REFERENCES finance_categories(id) ON DELETE CASCADE NOT NULL,
  hit_count INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT unique_keyword_per_user UNIQUE (user_id, keyword)
);

-- ============================================
-- Row Level Security
-- ============================================
ALTER TABLE finance_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_category_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users own finance_categories" ON finance_categories
  FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users own transactions" ON transactions
  FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users own finance_category_rules" ON finance_category_rules
  FOR ALL USING (auth.uid() = user_id);

-- ============================================
-- Indexes
-- ============================================
-- The first screen is "spend by category for a month", so the month scan and
-- the category rollup are what get indexed.
CREATE INDEX idx_transactions_user_date ON transactions(user_id, occurred_at DESC);
CREATE INDEX idx_transactions_category ON transactions(category_id, occurred_at DESC)
  WHERE category_id IS NOT NULL;
CREATE INDEX idx_transactions_review ON transactions(user_id) WHERE needs_review = true;
CREATE INDEX idx_transactions_batch ON transactions(import_batch_id)
  WHERE import_batch_id IS NOT NULL;
CREATE INDEX idx_finance_categories_user ON finance_categories(user_id, sort_order)
  WHERE is_archived = false;

CREATE TRIGGER transactions_updated_at BEFORE UPDATE ON transactions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER finance_category_rules_updated_at BEFORE UPDATE ON finance_category_rules
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================
-- Seed categories
-- ============================================
-- Derived from two months of real capture data, with line counts behind each.
-- Guarded the same way as the other seed RPCs (see migration 004).
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
      (p_user_id, 'transfer',       'Transfer / debt', '⇄',  '#6B7280', 'transfer', 16);
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;
