-- ============================================
-- Harden the SECURITY DEFINER seed functions
-- ============================================
-- Both seed RPCs are SECURITY DEFINER and take p_user_id, so any authenticated
-- user could seed default rows into someone else's account by passing a
-- different UUID. Assert the caller owns the target, and pin search_path so a
-- caller-controlled path can't shadow the tables these functions write to.

CREATE OR REPLACE FUNCTION seed_default_areas(p_user_id UUID)
RETURNS void AS $$
BEGIN
  IF auth.uid() IS NULL OR p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'seed_default_areas: not authorized for this user';
  END IF;

  -- Only seed if user has no areas yet
  IF NOT EXISTS (SELECT 1 FROM areas WHERE user_id = p_user_id) THEN
    INSERT INTO areas (user_id, name, icon, color, sort_order) VALUES
      (p_user_id, 'Imperial', '>_', '#3B82F6', 0),
      (p_user_id, 'DST', '⚡', '#F59E0B', 1),
      (p_user_id, 'AI Biz', '◇', '#8B5CF6', 2),
      (p_user_id, 'Freelance', '↗', '#10B981', 3),
      (p_user_id, 'Dev', '{}', '#00FF88', 4),
      (p_user_id, 'Health', '♥', '#EF4444', 5),
      (p_user_id, 'Learning', '◈', '#06B6D4', 6),
      (p_user_id, 'Faith', '☾', '#D4AF37', 7),
      (p_user_id, 'Personal', '◉', '#EC4899', 8),
      (p_user_id, 'Finance', '$', '#22C55E', 9);
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

CREATE OR REPLACE FUNCTION seed_default_routines(p_user_id UUID)
RETURNS void AS $$
DECLARE
  v_prayer_id UUID;
  v_morning_id UUID;
  v_evening_id UUID;
BEGIN
  IF auth.uid() IS NULL OR p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'seed_default_routines: not authorized for this user';
  END IF;

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
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;
