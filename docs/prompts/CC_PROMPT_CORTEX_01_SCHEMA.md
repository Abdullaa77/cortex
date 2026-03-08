# Cortex — Prompt 1 of 3: Project Init + Supabase Schema + Auth

## Context

Building **Cortex** — a personal Brain OS / life organizer PWA. Dark hacker terminal aesthetic.

- **Stack:** Next.js 14 (App Router) + TypeScript + Supabase + Tailwind CSS
- **Auth:** Supabase Google OAuth
- **Deploy:** Vercel
- **Font:** JetBrains Mono (terminal feel) + Inter (readability)
- **Aesthetic:** Dark background (#0A0A0F), green accent (#00FF88), terminal/hacker vibe
- **This is prompt 1 of 3.** This prompt sets up the project, database schema, auth flow, and Supabase client. Prompt 2 adds core logic (hooks, Today algorithm). Prompt 3 builds the UI.

---

## Step 1: Initialize Project

You are already inside the `cortex` project folder. Initialize here:

```bash
npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir --import-alias "@/*"
```

Then initialize git and create the repo:
```bash
git init
git add .
git commit -m "chore: initial next.js project setup"
```

Install dependencies:
```bash
npm install @supabase/supabase-js @supabase/ssr lucide-react
npm install -D @types/node
```

Set up directory structure:
```
src/
├── app/
│   ├── layout.tsx
│   ├── page.tsx              # Terminal (Dashboard)
│   ├── login/page.tsx        # Auth page
│   ├── inbox/page.tsx
│   ├── projects/
│   │   ├── page.tsx
│   │   └── [id]/page.tsx
│   ├── areas/
│   │   ├── page.tsx
│   │   └── [id]/page.tsx
│   ├── ideas/page.tsx
│   └── auth/callback/route.ts  # OAuth callback
├── components/
│   ├── ui/                   # Base components (empty for now)
│   ├── layout/
│   │   └── Sidebar.tsx       # Placeholder
│   └── providers/
│       └── SupabaseProvider.tsx
├── lib/
│   ├── supabase/
│   │   ├── client.ts         # Browser client
│   │   ├── server.ts         # Server client
│   │   └── middleware.ts     # Auth middleware helper
│   ├── types.ts              # TypeScript interfaces
│   └── constants.ts          # Default areas, colors
├── hooks/                    # Empty for now (prompt 2)
└── styles/
    └── globals.css
```

Create placeholder `page.tsx` files for each route that just export a default component with the page name (e.g., `export default function InboxPage() { return <div>Inbox</div> }`). These get built out in prompt 3.

---

## Step 2: Environment Variables

Create `.env.local`:
```
NEXT_PUBLIC_SUPABASE_URL=<will be filled by Scott>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<will be filled by Scott>
```

Create `.env.example` with the same keys but empty values.

---

## Step 3: Supabase Client Setup

### `src/lib/supabase/client.ts`
Browser-side Supabase client using `@supabase/ssr` `createBrowserClient`.

### `src/lib/supabase/server.ts`
Server-side client using `@supabase/ssr` `createServerClient` with cookie handling for Next.js App Router. Use `cookies()` from `next/headers`.

### `src/lib/supabase/middleware.ts`
Helper for refreshing auth tokens in middleware. Export a `updateSession` function.

### `src/middleware.ts` (root level)
Next.js middleware that:
- Calls `updateSession` to refresh auth
- Redirects unauthenticated users to `/login` (except `/login` and `/auth/callback`)
- Redirects authenticated users from `/login` to `/`

---

## Step 4: Auth Flow

### `src/app/login/page.tsx`
Dark terminal-themed login page:
- Centered card on dark background (#0A0A0F)
- "CORTEX" title in JetBrains Mono, green (#00FF88)
- Subtitle: "Brain OS" in muted gray
- Single "Sign in with Google" button — dark bg, green border, green text on hover
- Uses Supabase `signInWithOAuth({ provider: 'google' })` with redirect to `/auth/callback`
- No other auth methods for v1

### `src/app/auth/callback/route.ts`
OAuth callback handler:
- Exchanges code for session using `supabase.auth.exchangeCodeForSession(code)`
- On success: redirect to `/`
- On error: redirect to `/login`

---

## Step 5: Database Schema

Create file `supabase/migrations/001_initial_schema.sql` with the following. Scott will run this in Supabase SQL Editor.

```sql
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
```

---

## Step 6: TypeScript Types

### `src/lib/types.ts`

```typescript
export interface Area {
  id: string;
  user_id: string;
  name: string;
  icon: string;
  color: string;
  sort_order: number;
  is_archived: boolean;
  created_at: string;
}

export interface Project {
  id: string;
  user_id: string;
  area_id: string;
  title: string;
  description: string;
  status: 'active' | 'paused' | 'completed' | 'abandoned';
  priority: 1 | 2 | 3;
  deadline: string | null;
  tags: string[];
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  // Computed (joined)
  area?: Area;
  task_count?: number;
  completed_task_count?: number;
}

export interface Task {
  id: string;
  user_id: string;
  project_id: string | null;
  area_id: string;
  title: string;
  description: string;
  status: 'todo' | 'in_progress' | 'done' | 'cancelled';
  priority: 1 | 2 | 3 | 4;
  due_date: string | null;
  estimated_minutes: number | null;
  is_pinned: boolean;
  tags: string[];
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  // Computed (joined)
  area?: Area;
  project?: Project;
}

export interface Idea {
  id: string;
  user_id: string;
  area_id: string | null;
  title: string;
  body: string;
  rating: 0 | 1 | 2 | 3;
  tags: string[];
  created_at: string;
  updated_at: string;
  // Computed
  area?: Area;
}

export interface InboxItem {
  id: string;
  user_id: string;
  raw_text: string;
  source: 'quick_capture' | 'manual';
  created_at: string;
  processed_at: string | null;
  processed_to: 'task' | 'idea' | 'project' | 'trashed' | null;
  processed_ref_id: string | null;
}
```

---

## Step 7: Constants

### `src/lib/constants.ts`

```typescript
export const DEFAULT_AREAS = [
  { name: 'Imperial', icon: '>_', color: '#3B82F6' },
  { name: 'DST', icon: '⚡', color: '#F59E0B' },
  { name: 'AI Biz', icon: '◇', color: '#8B5CF6' },
  { name: 'Freelance', icon: '↗', color: '#10B981' },
  { name: 'Dev', icon: '{}', color: '#00FF88' },
  { name: 'Health', icon: '♥', color: '#EF4444' },
  { name: 'Learning', icon: '◈', color: '#06B6D4' },
  { name: 'Faith', icon: '☾', color: '#D4AF37' },
  { name: 'Personal', icon: '◉', color: '#EC4899' },
  { name: 'Finance', icon: '$', color: '#22C55E' },
] as const;

export const PRIORITY_LABELS: Record<number, string> = {
  1: 'Urgent',
  2: 'High',
  3: 'Medium',
  4: 'Low',
};

export const PRIORITY_COLORS: Record<number, string> = {
  1: '#EF4444',
  2: '#F59E0B',
  3: '#00FF88',
  4: '#6B7280',
};

export const STATUS_COLORS = {
  todo: '#6B7280',
  in_progress: '#3B82F6',
  done: '#00FF88',
  cancelled: '#4B5563',
  active: '#00FF88',
  paused: '#F59E0B',
  completed: '#00FF88',
  abandoned: '#EF4444',
} as const;

export const MAX_TODAY_TASKS = 7;

export const RATING_LABELS: Record<number, string> = {
  0: 'Unrated',
  1: 'Meh',
  2: 'Interesting',
  3: 'Fire',
};
```

---

## Step 8: Tailwind Config + Global Styles

### `tailwind.config.ts`
Extend with:
- Colors: `bg: '#0A0A0F'`, `surface: '#111118'`, `surface2: '#1A1A24'`, `border: '#2A2A3A'`, `accent: '#00FF88'`, `accent-dim: '#00CC6A'`, `text-primary: '#E0E0E0'`, `text-muted: '#6B7280'`
- Font family: `mono: ['JetBrains Mono', 'monospace']`, `sans: ['Inter', 'sans-serif']`

### `globals.css`
- Import JetBrains Mono from Google Fonts (or use `next/font`)
- Body: `bg-bg text-text-primary font-mono`
- Scrollbar styling: thin, dark
- Selection color: green accent
- No scanline effect in v1 (cut)

### `src/app/layout.tsx`
- Import JetBrains Mono and Inter via `next/font/google`
- Set up `<html lang="en" className="dark">` (always dark)
- Wrap children in `SupabaseProvider`
- Metadata: title "Cortex", description "Brain OS"

---

## Step 9: Supabase Provider

### `src/components/providers/SupabaseProvider.tsx`
React context that provides the Supabase browser client and current user session. Children can use `useSupabase()` hook to get the client and user.

Include a `useEffect` that:
1. Gets current session on mount
2. Calls `seed_default_areas` RPC if this is the user's first login (check if areas exist)
3. Subscribes to `onAuthStateChange` for session updates

---

## Step 10: Verification

Before marking this prompt complete:

1. `npm run build` passes with zero errors
2. `.env.example` exists with both Supabase keys
3. All placeholder pages render without errors
4. Middleware redirects unauthenticated users to `/login`
5. Login page renders the Google sign-in button
6. OAuth callback route exists at `/auth/callback`
7. SQL migration file exists at `supabase/migrations/001_initial_schema.sql`
8. Types file exports all 5 interfaces
9. Constants file exports all defaults

## Skills to Use
- Use **verification-before-completion** to check all of the above
- Use **dispatching-parallel-agents** if beneficial — one agent for Supabase setup files, one for pages/routing, one for config/styles

## Files Created (this prompt)
- `src/lib/supabase/client.ts`
- `src/lib/supabase/server.ts`
- `src/lib/supabase/middleware.ts`
- `src/middleware.ts`
- `src/lib/types.ts`
- `src/lib/constants.ts`
- `src/app/layout.tsx`
- `src/app/page.tsx` (placeholder)
- `src/app/login/page.tsx`
- `src/app/auth/callback/route.ts`
- `src/app/inbox/page.tsx` (placeholder)
- `src/app/projects/page.tsx` (placeholder)
- `src/app/projects/[id]/page.tsx` (placeholder)
- `src/app/areas/page.tsx` (placeholder)
- `src/app/areas/[id]/page.tsx` (placeholder)
- `src/app/ideas/page.tsx` (placeholder)
- `src/components/providers/SupabaseProvider.tsx`
- `src/styles/globals.css`
- `supabase/migrations/001_initial_schema.sql`
- `tailwind.config.ts`
- `.env.local`
- `.env.example`

## DO NOT create
- Any hooks (prompt 2)
- Any real UI components (prompt 3)
- Any API routes beyond auth callback
- Service worker / PWA manifest (deferred)
