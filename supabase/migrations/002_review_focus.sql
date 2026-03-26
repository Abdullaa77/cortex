-- ============================================
-- Weekly Reviews
-- ============================================
CREATE TABLE weekly_reviews (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  week_start DATE NOT NULL,
  tasks_completed INTEGER DEFAULT 0,
  tasks_created INTEGER DEFAULT 0,
  projects_reviewed INTEGER DEFAULT 0,
  inbox_processed INTEGER DEFAULT 0,
  ideas_captured INTEGER DEFAULT 0,
  reflection TEXT DEFAULT '',
  energy_rating INTEGER CHECK (energy_rating BETWEEN 1 AND 5),
  completed_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- Focus Sessions
-- ============================================
CREATE TABLE focus_sessions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
  task_title TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  duration_seconds INTEGER,
  outcome TEXT CHECK (outcome IN ('completed', 'paused', 'skipped')),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Add actual_minutes to tasks if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tasks' AND column_name = 'actual_minutes'
  ) THEN
    ALTER TABLE tasks ADD COLUMN actual_minutes INTEGER DEFAULT 0;
  END IF;
END $$;

-- RLS
ALTER TABLE weekly_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE focus_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users own reviews" ON weekly_reviews FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users own focus_sessions" ON focus_sessions FOR ALL USING (auth.uid() = user_id);

-- Indexes
CREATE INDEX idx_reviews_user_week ON weekly_reviews(user_id, week_start DESC);
CREATE INDEX idx_focus_user ON focus_sessions(user_id, started_at DESC);
CREATE INDEX idx_focus_task ON focus_sessions(task_id) WHERE task_id IS NOT NULL;
