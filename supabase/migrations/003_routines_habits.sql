-- ============================================
-- CORTEX v3 — Routines & Habits Engine
-- ============================================

-- Routines: ordered sequences of steps (morning routine, evening routine, prayers)
CREATE TABLE routines (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  icon TEXT DEFAULT '◉',
  color TEXT DEFAULT '#00FF88',
  time_of_day TEXT DEFAULT 'anytime' CHECK (time_of_day IN ('morning', 'afternoon', 'evening', 'anytime')),
  sort_order INTEGER DEFAULT 0,
  is_prayer BOOLEAN DEFAULT false,
  is_archived BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Routine Steps: individual items within a routine
CREATE TABLE routine_steps (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  routine_id UUID REFERENCES routines(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  is_archived BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Habits: standalone daily trackables (not part of a routine)
CREATE TABLE habits (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  icon TEXT DEFAULT '○',
  color TEXT DEFAULT '#00FF88',
  track_type TEXT DEFAULT 'checkbox' CHECK (track_type IN ('checkbox', 'number')),
  target_value NUMERIC,
  unit TEXT,
  sort_order INTEGER DEFAULT 0,
  is_archived BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Daily Log: one row per trackable item per day
CREATE TABLE daily_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  log_date DATE NOT NULL DEFAULT CURRENT_DATE,
  routine_step_id UUID REFERENCES routine_steps(id) ON DELETE CASCADE,
  habit_id UUID REFERENCES habits(id) ON DELETE CASCADE,
  completed BOOLEAN DEFAULT false,
  value NUMERIC,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT one_reference CHECK (
    (routine_step_id IS NOT NULL AND habit_id IS NULL) OR
    (routine_step_id IS NULL AND habit_id IS NOT NULL)
  ),
  CONSTRAINT unique_step_per_day UNIQUE (user_id, log_date, routine_step_id),
  CONSTRAINT unique_habit_per_day UNIQUE (user_id, log_date, habit_id)
);

-- ============================================
-- Row Level Security
-- ============================================
ALTER TABLE routines ENABLE ROW LEVEL SECURITY;
ALTER TABLE routine_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE habits ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users own routines" ON routines FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users own routine_steps" ON routine_steps FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users own habits" ON habits FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users own daily_log" ON daily_log FOR ALL USING (auth.uid() = user_id);

-- ============================================
-- Indexes
-- ============================================
CREATE INDEX idx_routine_steps_routine ON routine_steps(routine_id, sort_order);
CREATE INDEX idx_daily_log_date ON daily_log(user_id, log_date DESC);
CREATE INDEX idx_daily_log_step ON daily_log(routine_step_id, log_date) WHERE routine_step_id IS NOT NULL;
CREATE INDEX idx_daily_log_habit ON daily_log(habit_id, log_date) WHERE habit_id IS NOT NULL;
CREATE INDEX idx_routines_user ON routines(user_id, sort_order) WHERE is_archived = false;
CREATE INDEX idx_habits_user ON habits(user_id, sort_order) WHERE is_archived = false;

-- ============================================
-- Auto-update trigger
-- ============================================
CREATE TRIGGER routines_updated_at BEFORE UPDATE ON routines
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER habits_updated_at BEFORE UPDATE ON habits
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================
-- Seed default routines and habits
-- ============================================
CREATE OR REPLACE FUNCTION seed_default_routines(p_user_id UUID)
RETURNS void AS $$
DECLARE
  v_prayer_id UUID;
  v_morning_id UUID;
  v_evening_id UUID;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM routines WHERE user_id = p_user_id) THEN

    -- Prayers routine
    INSERT INTO routines (user_id, name, icon, color, time_of_day, sort_order, is_prayer)
    VALUES (p_user_id, 'Prayers', '☾', '#D4AF37', 'anytime', 0, true)
    RETURNING id INTO v_prayer_id;

    INSERT INTO routine_steps (routine_id, user_id, name, sort_order) VALUES
      (v_prayer_id, p_user_id, 'Fajr', 0),
      (v_prayer_id, p_user_id, 'Dhuhr', 1),
      (v_prayer_id, p_user_id, 'Asr', 2),
      (v_prayer_id, p_user_id, 'Maghrib', 3),
      (v_prayer_id, p_user_id, 'Isha', 4);

    -- Morning routine
    INSERT INTO routines (user_id, name, icon, color, time_of_day, sort_order)
    VALUES (p_user_id, 'Morning Routine', '☀', '#F59E0B', 'morning', 1)
    RETURNING id INTO v_morning_id;

    INSERT INTO routine_steps (routine_id, user_id, name, sort_order) VALUES
      (v_morning_id, p_user_id, 'Wake up on time', 0),
      (v_morning_id, p_user_id, 'Make bed', 1),
      (v_morning_id, p_user_id, 'Brush teeth', 2),
      (v_morning_id, p_user_id, 'Wash face', 3),
      (v_morning_id, p_user_id, 'Breakfast', 4);

    -- Evening routine
    INSERT INTO routines (user_id, name, icon, color, time_of_day, sort_order)
    VALUES (p_user_id, 'Evening Routine', '🌙', '#8B5CF6', 'evening', 2)
    RETURNING id INTO v_evening_id;

    INSERT INTO routine_steps (routine_id, user_id, name, sort_order) VALUES
      (v_evening_id, p_user_id, 'Review tomorrow''s tasks', 0),
      (v_evening_id, p_user_id, 'Quran reading', 1),
      (v_evening_id, p_user_id, 'Skincare', 2),
      (v_evening_id, p_user_id, 'Set alarm', 3);

    -- Default habits
    INSERT INTO habits (user_id, name, icon, color, track_type, target_value, unit, sort_order) VALUES
      (p_user_id, 'Water', '💧', '#06B6D4', 'number', 8, 'cups', 0),
      (p_user_id, 'Vitamins', '💊', '#10B981', 'checkbox', NULL, NULL, 1),
      (p_user_id, 'Sleep', '😴', '#8B5CF6', 'number', 7, 'hours', 2),
      (p_user_id, 'Quran', '📖', '#D4AF37', 'checkbox', NULL, NULL, 3);

  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
