# Cortex — Prompt 2 of 3: Core Logic Layer

## Context

Cortex project is initialized (prompt 1 complete). Supabase schema is live, auth works, placeholder pages exist. This prompt builds all the data hooks and business logic that prompt 3 (UI) will consume.

**Important:** This project uses **Next.js 16 + Tailwind v4**. Custom colors/fonts are in `globals.css` via `@theme`, NOT in `tailwind.config.ts`.

**Read the existing codebase first** — explore `src/lib/`, `src/components/providers/SupabaseProvider.tsx`, and `src/lib/types.ts` to understand current patterns before writing anything.

---

## What This Prompt Creates

All custom hooks + utility functions. No UI changes — prompt 3 handles that.

```
src/hooks/
├── useAreas.ts          # CRUD + default seeding
├── useProjects.ts       # CRUD + task counts
├── useTasks.ts          # CRUD + today algorithm + pin/complete
├── useIdeas.ts          # CRUD + rating
├── useInbox.ts          # Capture + process flow
└── useStats.ts          # Dashboard stats
src/lib/
├── today-algorithm.ts   # Today task auto-pull logic
└── helpers.ts           # Date helpers, formatters
```

---

## Step 1: Helpers (`src/lib/helpers.ts`)

Utility functions used across hooks:

```typescript
// Date helpers
export function isOverdue(dueDate: string | null): boolean
  // true if due_date is before today (not including today)

export function isDueToday(dueDate: string | null): boolean
  // true if due_date is today

export function formatRelativeDate(date: string): string
  // "today", "tomorrow", "yesterday", "Mon Mar 10", "Mar 10, 2026"
  // Use Intl.DateTimeFormat, respect user timezone

export function daysFromNow(date: string): number
  // Positive = future, negative = past, 0 = today

// Priority helpers
export function priorityLabel(p: number): string
  // 1→"Urgent", 2→"High", 3→"Medium", 4→"Low"

export function prioritySymbol(p: number): string
  // 1→"!", 2→"·", 3→" ", 4→"_"

// Text helpers
export function truncate(text: string, max: number): string
export function slugify(text: string): string
```

---

## Step 2: Areas Hook (`src/hooks/useAreas.ts`)

```typescript
export function useAreas() {
  // State
  areas: Area[]
  loading: boolean
  error: string | null

  // Actions
  fetchAreas(): Promise<void>
    // SELECT * FROM areas WHERE is_archived = false ORDER BY sort_order
    // If zero results AND user is authenticated, call seed_default_areas RPC, then re-fetch

  createArea(data: { name: string; icon: string; color: string }): Promise<Area>
    // INSERT with sort_order = max existing + 1
    // Optimistic: add to local state immediately, rollback on error

  updateArea(id: string, data: Partial<Area>): Promise<void>
    // UPDATE areas SET ... WHERE id = $id
    // Optimistic update

  archiveArea(id: string): Promise<void>
    // UPDATE areas SET is_archived = true WHERE id = $id
    // Remove from local state

  reorderAreas(orderedIds: string[]): Promise<void>
    // Batch UPDATE sort_order for each id
    // Optimistic: reorder local state immediately
}
```

**Fetch on mount** using `useEffect`. Cache in state.

---

## Step 3: Tasks Hook (`src/hooks/useTasks.ts`)

The most important hook. Powers the Today view, project task lists, and area task lists.

```typescript
export function useTasks(filters?: {
  project_id?: string;
  area_id?: string;
  status?: string | string[];
  is_pinned?: boolean;
}) {
  // State
  tasks: Task[]
  loading: boolean
  error: string | null

  // Fetching
  fetchTasks(): Promise<void>
    // SELECT * FROM tasks with optional filters
    // JOIN area name/color for display (or fetch separately and merge)
    // ORDER BY priority ASC, due_date ASC NULLS LAST, created_at DESC

  // CRUD
  createTask(data: {
    title: string;
    area_id: string;
    project_id?: string;
    priority?: number;
    due_date?: string;
    description?: string;
    estimated_minutes?: number;
  }): Promise<Task>
    // INSERT with defaults: status='todo', priority=3, is_pinned=false
    // Optimistic add

  updateTask(id: string, data: Partial<Task>): Promise<void>
    // UPDATE tasks SET ... WHERE id = $id
    // Optimistic update

  deleteTask(id: string): Promise<void>
    // DELETE FROM tasks WHERE id = $id
    // Optimistic remove from state

  // Quick actions
  completeTask(id: string): Promise<void>
    // UPDATE status='done', completed_at=now()
    // Optimistic: move to done in local state

  togglePin(id: string): Promise<void>
    // UPDATE is_pinned = !current
    // Optimistic toggle

  // Today algorithm
  getTodayTasks(): Task[]
    // Client-side filter + sort from already-fetched tasks
    // Uses today-algorithm.ts logic (see Step 4)
    // Returns max 7 tasks
}
```

**Important patterns:**
- All mutations are **optimistic** — update local state first, revert if Supabase call fails
- `fetchTasks` always fetches non-cancelled, non-done tasks unless `status` filter explicitly includes them
- When `project_id` filter is set, also fetch done tasks for that project (to show progress)

---

## Step 4: Today Algorithm (`src/lib/today-algorithm.ts`)

This is the brain of the dashboard. It decides what you should focus on right now.

```typescript
import { Task } from './types';
import { isOverdue, isDueToday } from './helpers';

const MAX_TODAY = 7;

export function computeTodayTasks(allTasks: Task[]): Task[] {
  // Input: all tasks with status 'todo' or 'in_progress'
  // Output: up to 7 tasks, sorted by importance

  const activeTasks = allTasks.filter(
    t => t.status === 'todo' || t.status === 'in_progress'
  );

  // Score each task
  const scored = activeTasks.map(task => ({
    task,
    score: computeScore(task),
  }));

  // Sort by score descending (highest = most important)
  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, MAX_TODAY).map(s => s.task);
}

function computeScore(task: Task): number {
  let score = 0;

  // In-progress tasks get highest base — you already started, finish it
  if (task.status === 'in_progress') score += 1000;

  // Overdue is critical
  if (isOverdue(task.due_date)) score += 500;

  // Due today is urgent
  if (isDueToday(task.due_date)) score += 300;

  // Manually pinned = user explicitly wants this today
  if (task.is_pinned) score += 200;

  // Priority weight (inverted — P1 gets most points)
  const priorityWeight = { 1: 100, 2: 60, 3: 30, 4: 10 };
  score += priorityWeight[task.priority as keyof typeof priorityWeight] || 10;

  // Due soon bonus (within 3 days)
  if (task.due_date) {
    const daysUntil = Math.ceil(
      (new Date(task.due_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
    );
    if (daysUntil > 0 && daysUntil <= 3) score += 50;
  }

  return score;
}
```

---

## Step 5: Projects Hook (`src/hooks/useProjects.ts`)

```typescript
export function useProjects(filters?: {
  area_id?: string;
  status?: string;
}) {
  // State
  projects: Project[]  // with computed task_count and completed_task_count
  loading: boolean
  error: string | null

  // Fetching
  fetchProjects(): Promise<void>
    // SELECT * FROM projects with filters
    // For each project, get task counts:
    //   task_count = COUNT tasks WHERE project_id = X AND status != 'cancelled'
    //   completed_task_count = COUNT tasks WHERE project_id = X AND status = 'done'
    // ORDER BY priority ASC, updated_at DESC
    //
    // APPROACH: Fetch projects first, then batch-fetch task counts
    // Use two queries, not N+1:
    //   1. SELECT * FROM projects ...
    //   2. SELECT project_id, 
    //        COUNT(*) FILTER (WHERE status != 'cancelled') as total,
    //        COUNT(*) FILTER (WHERE status = 'done') as done
    //      FROM tasks WHERE project_id IN (...) GROUP BY project_id
    // Merge counts into project objects client-side.
    //
    // NOTE: Supabase JS client doesn't support FILTER in count directly.
    // Instead use two separate count queries or a database function.
    // Simplest approach for v1: fetch all tasks for these projects and count client-side.

  // CRUD
  createProject(data: {
    title: string;
    area_id: string;
    description?: string;
    priority?: number;
    deadline?: string;
  }): Promise<Project>
    // INSERT with defaults: status='active', priority=2
    // Optimistic add with task_count=0, completed_task_count=0

  updateProject(id: string, data: Partial<Project>): Promise<void>
    // UPDATE projects SET ... WHERE id = $id
    // If status changed to 'completed', set completed_at = now()
    // If status changed FROM 'completed', clear completed_at
    // Optimistic update

  deleteProject(id: string): Promise<void>
    // DELETE FROM projects WHERE id = $id
    // Tasks with this project_id will have project_id set to NULL (ON DELETE SET NULL)
    // Optimistic remove

  archiveProject(id: string): Promise<void>
    // UPDATE status='abandoned'
    // Optimistic update
}
```

---

## Step 6: Ideas Hook (`src/hooks/useIdeas.ts`)

```typescript
export function useIdeas(filters?: {
  area_id?: string;
  rating?: number;
}) {
  // State
  ideas: Idea[]
  loading: boolean
  error: string | null

  // Fetching
  fetchIdeas(): Promise<void>
    // SELECT * FROM ideas with filters
    // ORDER BY rating DESC, created_at DESC

  // CRUD
  createIdea(data: {
    title: string;
    body?: string;
    area_id?: string;
    rating?: number;
  }): Promise<Idea>
    // INSERT with defaults: rating=0
    // Optimistic add

  updateIdea(id: string, data: Partial<Idea>): Promise<void>
    // Optimistic update

  deleteIdea(id: string): Promise<void>
    // DELETE FROM ideas WHERE id = $id
    // Optimistic remove

  // Quick actions
  rateIdea(id: string, rating: 0 | 1 | 2 | 3): Promise<void>
    // UPDATE rating WHERE id
    // Optimistic update
}
```

---

## Step 7: Inbox Hook (`src/hooks/useInbox.ts`)

The capture-to-organize pipeline.

```typescript
export function useInbox() {
  // State
  items: InboxItem[]    // only unprocessed items
  loading: boolean
  error: string | null
  unprocessedCount: number  // computed from items.length

  // Fetching
  fetchInbox(): Promise<void>
    // SELECT * FROM inbox WHERE processed_at IS NULL ORDER BY created_at DESC

  // Capture
  capture(rawText: string): Promise<InboxItem>
    // INSERT into inbox with source='quick_capture'
    // Optimistic add to top of list
    // This is the zero-friction entry point — must be fast

  // Process actions
  processToTask(
    inboxId: string,
    taskData: { title: string; area_id: string; priority?: number; project_id?: string; due_date?: string }
  ): Promise<void>
    // 1. INSERT into tasks table with provided data
    // 2. UPDATE inbox SET processed_at=now(), processed_to='task', processed_ref_id=new_task_id
    // 3. Remove from local items state
    // If raw_text starts with "!", default priority to 1

  processToIdea(
    inboxId: string,
    ideaData: { title: string; area_id?: string; body?: string }
  ): Promise<void>
    // 1. INSERT into ideas table
    // 2. UPDATE inbox SET processed_at=now(), processed_to='idea', processed_ref_id=new_idea_id
    // 3. Remove from local items state

  processToProject(
    inboxId: string,
    projectData: { title: string; area_id: string; description?: string }
  ): Promise<void>
    // 1. INSERT into projects table
    // 2. UPDATE inbox SET processed_at=now(), processed_to='project', processed_ref_id=new_project_id
    // 3. Remove from local items state

  trash(inboxId: string): Promise<void>
    // UPDATE inbox SET processed_at=now(), processed_to='trashed'
    // Remove from local items state
}
```

**Key behavior:** When processing, the inbox item's `raw_text` becomes the default `title` for whatever entity it's processed into. User can edit before confirming.

---

## Step 8: Stats Hook (`src/hooks/useStats.ts`)

Powers the stats bar on the Terminal dashboard.

```typescript
export function useStats() {
  // State
  stats: {
    todayCompleted: number;   // tasks completed today
    todayTotal: number;       // tasks in today view
    inboxCount: number;       // unprocessed inbox items
    activeProjects: number;   // projects with status='active'
    totalIdeas: number;       // all ideas
    streak: number;           // consecutive days with at least 1 task completed
  }
  loading: boolean

  // Fetching
  fetchStats(): Promise<void>
    // Multiple queries:
    // 1. COUNT tasks WHERE completed_at::date = today AND status = 'done'
    // 2. (todayTotal comes from today algorithm — accept as param or compute)
    // 3. COUNT inbox WHERE processed_at IS NULL
    // 4. COUNT projects WHERE status = 'active'
    // 5. COUNT ideas
    // 6. Streak: query tasks completed per day, count consecutive days backward from today
    //    For v1, keep streak simple:
    //    SELECT DISTINCT completed_at::date as day FROM tasks
    //    WHERE status='done' AND completed_at IS NOT NULL
    //    ORDER BY day DESC
    //    Then iterate: if yesterday exists, increment streak. Stop at first gap.

  // NOTE: streak calculation is expensive. Cache it — only recalculate on fetchStats() call,
  // not on every task completion. Good enough for v1.
}
```

---

## Step 9: Supabase Query Patterns

All hooks should use the Supabase browser client from the SupabaseProvider context.

**Pattern for getting the client:**
```typescript
import { useSupabase } from '@/components/providers/SupabaseProvider';

export function useTasks() {
  const { supabase, user } = useSupabase();
  // user.id is available for queries
}
```

**If SupabaseProvider doesn't expose the client this way**, check how it's implemented and adapt. Don't assume — **read the file first**.

**Error handling pattern:**
```typescript
try {
  const { data, error } = await supabase.from('tasks').select('*');
  if (error) throw error;
  // use data
} catch (err) {
  setError(err instanceof Error ? err.message : 'Unknown error');
  // revert optimistic update if applicable
}
```

**Optimistic update pattern:**
```typescript
// 1. Save previous state
const prev = [...tasks];
// 2. Apply optimistic change
setTasks(tasks.map(t => t.id === id ? { ...t, ...updates } : t));
// 3. Call Supabase
const { error } = await supabase.from('tasks').update(updates).eq('id', id);
// 4. Revert if failed
if (error) {
  setTasks(prev);
  setError(error.message);
}
```

---

## Step 10: Verification

Before marking complete:

1. `npm run build` passes — no type errors in any hook
2. All 6 hooks export correctly and import types from `@/lib/types`
3. `today-algorithm.ts` exports `computeTodayTasks`
4. `helpers.ts` exports all utility functions
5. No hook calls Supabase at module level — all calls are inside functions or useEffect
6. Every hook handles loading, error, and empty states
7. Every mutation is optimistic with rollback on error
8. No N+1 query patterns — batch where possible

## Skills to Use
- Use **verification-before-completion** to run through the checklist above
- Use **dispatching-parallel-agents** — one agent per hook file if beneficial

## Files Created (this prompt)
- `src/hooks/useAreas.ts`
- `src/hooks/useProjects.ts`
- `src/hooks/useTasks.ts`
- `src/hooks/useIdeas.ts`
- `src/hooks/useInbox.ts`
- `src/hooks/useStats.ts`
- `src/lib/today-algorithm.ts`
- `src/lib/helpers.ts`

## Files Modified
- NONE. Do not touch any files from prompt 1. If SupabaseProvider needs a small adjustment to expose client/user properly for hooks, that's the only exception — and explain what you changed.

## DO NOT Create
- Any UI components or page changes (prompt 3)
- Any API routes
- Any new Supabase tables or migrations
