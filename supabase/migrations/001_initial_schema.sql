-- ============================================
-- CORTEX v1 Schema
-- ============================================

-- Areas: permanent life domains
CREATE TABLE areas (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  icon TEXT DEFAULT '◉',
  color TEXT DEFAULT '#00FF88',
  sort_order INTEGER DEFAULT 0,
  is_archived BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Projects: collections of tasks toward an outcome
CREATE TABLE projects (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  area_id UUID REFERENCES areas(id) ON DELETE CASCADE NOT NULL,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed', 'abandoned')),
  priority INTEGER DEFAULT 2 CHECK (priority IN (1, 2, 3)),
  deadline DATE,
  tags TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ
);

-- Tasks: atomic units of work
CREATE TABLE tasks (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  area_id UUID REFERENCES areas(id) ON DELETE CASCADE NOT NULL,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  status TEXT DEFAULT 'todo' CHECK (status IN ('todo', 'in_progress', 'done', 'cancelled')),
  priority INTEGER DEFAULT 3 CHECK (priority IN (1, 2, 3, 4)),
  due_date DATE,
  estimated_minutes INTEGER,
  is_pinned BOOLEAN DEFAULT false,
  tags TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ
);

-- Ideas: things to explore later, not committed
CREATE TABLE ideas (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  area_id UUID REFERENCES areas(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  body TEXT DEFAULT '',
  rating INTEGER DEFAULT 0 CHECK (rating IN (0, 1, 2, 3)),
  tags TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Inbox: raw captures, unprocessed thoughts
CREATE TABLE inbox (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  raw_text TEXT NOT NULL,
  source TEXT DEFAULT 'quick_capture',
  created_at TIMESTAMPTZ DEFAULT now(),
  processed_at TIMESTAMPTZ,
  processed_to TEXT CHECK (processed_to IN ('task', 'idea', 'project', 'trashed')),
  processed_ref_id UUID
);

-- ============================================
-- Row Level Security
-- ============================================
ALTER TABLE areas ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE ideas ENABLE ROW LEVEL SECURITY;
ALTER TABLE inbox ENABLE ROW LEVEL SECURITY;

-- RLS Policies — users can only access their own data
CREATE POLICY "Users own areas" ON areas FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users own projects" ON projects FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users own tasks" ON tasks FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users own ideas" ON ideas FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users own inbox" ON inbox FOR ALL USING (auth.uid() = user_id);

-- ============================================
-- Indexes
-- ============================================
CREATE INDEX idx_tasks_user_status ON tasks(user_id, status);
CREATE INDEX idx_tasks_due ON tasks(user_id, due_date) WHERE status NOT IN ('done', 'cancelled');
CREATE INDEX idx_tasks_project ON tasks(project_id) WHERE project_id IS NOT NULL;
CREATE INDEX idx_tasks_pinned ON tasks(user_id) WHERE is_pinned = true AND status = 'todo';
CREATE INDEX idx_projects_area ON projects(area_id);
CREATE INDEX idx_projects_user_status ON projects(user_id, status);
CREATE INDEX idx_inbox_unprocessed ON inbox(user_id) WHERE processed_at IS NULL;
CREATE INDEX idx_ideas_area ON ideas(area_id) WHERE area_id IS NOT NULL;
CREATE INDEX idx_ideas_rating ON ideas(user_id, rating DESC);

-- ============================================
-- Auto-update updated_at trigger
-- ============================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tasks_updated_at BEFORE UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER projects_updated_at BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER ideas_updated_at BEFORE UPDATE ON ideas
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================
-- Seed default areas (runs via function after first login)
-- ============================================
CREATE OR REPLACE FUNCTION seed_default_areas(p_user_id UUID)
RETURNS void AS $$
BEGIN
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
$$ LANGUAGE plpgsql SECURITY DEFINER;
