# Cortex — Prompt 3 of 3: Full UI

## Context

Cortex project has foundation (prompt 1) and core logic (prompt 2) complete. Auth works, Supabase schema is live, all hooks and the Today algorithm are built. This prompt builds every UI component and page.

**CRITICAL:** This project uses **Next.js 16 + Tailwind v4**. Custom colors/fonts are defined in `globals.css` via `@theme`, NOT in `tailwind.config.ts`. **Read `globals.css` first** to see what design tokens exist before writing any styles.

**Read the entire codebase first** — explore `src/hooks/`, `src/lib/`, `src/components/`, and all page files before writing anything. Understand what each hook returns and how the Supabase provider works.

---

## Design System Reference

**Aesthetic:** Dark hacker terminal. Not a toy — a tool you respect.

**Colors (should already be in globals.css @theme):**
- Background: `#0A0A0F` (near-black)
- Surface: `#111118` (cards, panels)
- Surface2: `#1A1A24` (hover states)
- Border: `#2A2A3A` (subtle)
- Accent: `#00FF88` (terminal green — primary)
- Text: `#E0E0E0` (primary), `#6B7280` (muted)
- Priority: P1=`#EF4444`, P2=`#F59E0B`, P3=`#00FF88`, P4=`#6B7280`

**Fonts:** JetBrains Mono for headings/labels/data. Inter for body text/descriptions.

**Patterns:**
- Section headers: ALL CAPS, monospace, preceded by `──`
- Interactive elements prefixed with `>`
- Tags in `[brackets]`
- Priority indicators: `[!]` P1, `[·]` P2, `[ ]` P3, `[_]` P4
- Status: `□` todo, `◐` in_progress, `■` done
- Subtle green glow (`box-shadow: 0 0 20px rgba(0,255,136,0.1)`) on active/focused elements
- Minimal borders, rely on spacing and subtle bg differences for separation

---

## File Structure (what this prompt creates)

```
src/
├── components/
│   ├── layout/
│   │   ├── AppShell.tsx          # Sidebar + content + bottom nav + quick capture
│   │   ├── Sidebar.tsx           # Desktop sidebar (REPLACE placeholder)
│   │   ├── MobileNav.tsx         # Bottom tab bar for mobile
│   │   ├── Header.tsx            # Top bar with title + clock
│   │   └── QuickCapture.tsx      # Capture bar (bottom desktop, swipe mobile)
│   ├── ui/
│   │   ├── Modal.tsx             # Reusable modal/dialog
│   │   ├── Badge.tsx             # Priority/status/area badge
│   │   ├── ProgressBar.tsx       # Project progress bar
│   │   ├── EmptyState.tsx        # "No items" placeholder
│   │   └── LoadingState.tsx      # Terminal-style loading indicator
│   ├── tasks/
│   │   ├── TaskRow.tsx           # Single task row for lists
│   │   ├── TaskForm.tsx          # Create/edit task modal
│   │   └── TaskDetail.tsx        # Expanded task view
│   ├── projects/
│   │   ├── ProjectCard.tsx       # Project card with progress bar
│   │   └── ProjectForm.tsx       # Create/edit project modal
│   ├── inbox/
│   │   ├── InboxItem.tsx         # Single inbox item with action buttons
│   │   └── ProcessModal.tsx      # Modal for processing inbox → task/idea/project
│   └── ideas/
│       ├── IdeaCard.tsx          # Idea card with rating stars
│       └── IdeaForm.tsx          # Create/edit idea modal
├── app/
│   ├── layout.tsx                # MODIFY: wrap in AppShell
│   ├── page.tsx                  # Terminal (Dashboard) — REPLACE placeholder
│   ├── inbox/page.tsx            # REPLACE placeholder
│   ├── projects/
│   │   ├── page.tsx              # REPLACE placeholder
│   │   └── [id]/page.tsx         # REPLACE placeholder
│   ├── areas/
│   │   ├── page.tsx              # REPLACE placeholder
│   │   └── [id]/page.tsx         # REPLACE placeholder
│   └── ideas/page.tsx            # REPLACE placeholder
```

---

## Component Specifications

### AppShell (`src/components/layout/AppShell.tsx`)

The root layout wrapper. Wraps all authenticated pages.

```
DESKTOP (≥1024px):
┌──────────────────────────────────────────────┐
│ [Header]                                      │
├──────────┬───────────────────────────────────┤
│ [Sidebar]│ [children - page content]          │
│          │                                    │
│          │                                    │
│          │                                    │
├──────────┴───────────────────────────────────┤
│ [QuickCapture bar]                            │
└──────────────────────────────────────────────┘

MOBILE (<1024px):
┌──────────────────────┐
│ [Header]             │
├──────────────────────┤
│                      │
│ [children]           │
│ (full width, scroll) │
│                      │
├──────────────────────┤
│ [MobileNav]          │
└──────────────────────┘
```

- Use `'use client'`
- Detect screen size with a custom hook or media query
- Sidebar width: 220px on desktop, hidden on mobile
- QuickCapture pinned to bottom on desktop, hidden on mobile (mobile uses MobileNav's + button)
- Content area: `overflow-y-auto`, full remaining height
- Background: `#0A0A0F`

### Header (`src/components/layout/Header.tsx`)

```
CORTEX v1.0                              02:34 AM
```

- Left: "CORTEX" in green monospace, "v1.0" in muted
- Right: Current time (updates every minute), monospace, muted text
- Height: 48px, border-bottom with border color
- Sticky top

### Sidebar (`src/components/layout/Sidebar.tsx`)

REPLACE the placeholder. Desktop only.

```
> Terminal
  Inbox (3)
  Projects
  Areas
  Ideas
  ──────────
  Settings
```

- Nav items with icons from lucide-react: Terminal (Home), Inbox, FolderKanban (Projects), Layout (Areas), Lightbulb (Ideas), Settings
- Active item: green text + green left border (2px)
- Inactive: muted text, hover → surface2 bg
- Inbox shows unprocessed count badge (green bg, dark text, small pill)
- Use `useInbox()` hook just for `unprocessedCount` — or accept it as prop
- Link to respective routes using Next.js `Link`
- Font: monospace, text-sm
- Prefix active item with `>`

### MobileNav (`src/components/layout/MobileNav.tsx`)

Bottom tab bar, mobile only.

```
⌂        ☐        ◈        ☆        +
Home    Inbox   Projects  Ideas   Capture
```

- 5 tabs with icons and labels
- Active tab: green icon + text
- Inactive: muted
- The `+` button opens QuickCapture as a modal/sheet from bottom
- Fixed to bottom, height 64px, bg surface, border-top
- Safe area padding for notched phones (`pb-safe`)

### QuickCapture (`src/components/layout/QuickCapture.tsx`)

Zero-friction inbox capture.

**Desktop:** Fixed bar at bottom of AppShell.
```
> _  [type to capture...]                    [Enter ↵]
```
- Input with green caret, monospace
- Placeholder: "Capture a thought..."
- On Enter: calls `useInbox().capture(text)`, clears input, brief green flash to confirm
- On `!` prefix: visual indicator that this will be urgent
- On `?` prefix: visual indicator that this will be an idea

**Mobile:** Modal that slides up when + is tapped in MobileNav.
- Same input behavior
- Close on submit or swipe down
- Auto-focus input when opened

---

### TaskRow (`src/components/tasks/TaskRow.tsx`)

Single task in a list. Used on Terminal page, Project detail, Area detail.

```
□ [!] Fix auth bug on dashboard          [Imperial]  32m
```

Props: `task: Task`, `onComplete`, `onTogglePin`, `onClick`

- Left: status icon (□/◐/■) — clickable to cycle or complete
- Priority indicator with priority color
- Title — truncate if too long
- Right side: area badge (area color bg, small pill), estimated time if set
- If overdue: title in red, or a small red dot indicator
- If pinned: small pin icon
- Hover: surface2 bg
- Click: opens TaskDetail or TaskForm for editing
- Swipe right (mobile): complete task

### TaskForm (`src/components/tasks/TaskForm.tsx`)

Modal for creating or editing a task.

Props: `task?: Task` (if editing), `defaultAreaId?: string`, `defaultProjectId?: string`, `onClose`, `onSave`

Fields:
- Title (required) — monospace input, autofocus
- Area (required) — select dropdown, populated from `useAreas()`
- Priority — 4 clickable buttons (1-4), highlight active
- Due date — date input
- Project — optional select dropdown, filtered by selected area
- Description — textarea, optional
- Estimated minutes — number input, optional

Footer: Cancel + Save buttons. Save is green accent.

### TaskDetail (`src/components/tasks/TaskDetail.tsx`)

Expanded view when clicking a task. Can be a slide-out panel or modal.

Shows all task fields + actions:
- Complete / Reopen
- Pin / Unpin
- Edit (opens TaskForm)
- Delete (with confirmation)
- Status change (todo → in_progress → done)

---

### ProjectCard (`src/components/projects/ProjectCard.tsx`)

Used on Projects page.

```
┌─────────────────────────────────────────┐
│ Shadow System v3                  [Dev] │
│ Build the real training system          │
│ ████████░░░░░░░░░░  4/12 tasks          │
│ Due: Apr 15 • P1                        │
└─────────────────────────────────────────┘
```

Props: `project: Project`, `onClick`

- Surface bg, subtle border, hover glow
- Title in monospace, area badge top-right
- Description: 1 line, muted text, truncated
- Progress bar: green fill, dark track. `completed_task_count / task_count`
- Bottom: deadline (formatted relative), priority badge
- Click → navigates to `/projects/[id]`

### ProjectForm (`src/components/projects/ProjectForm.tsx`)

Modal for create/edit.

Fields: Title, Area (required), Description, Priority (1-3), Deadline

---

### InboxItem (`src/components/inbox/InboxItem.tsx`)

Single item in inbox list.

```
"check out that new AI framework"     [→T] [→I] [→P] [✕]
2 hours ago
```

Props: `item: InboxItem`, `onProcess`

- Raw text in quotes, monospace
- Relative timestamp below, muted
- 4 action buttons on the right (or below on mobile):
  - →T (to Task) — blue
  - →I (to Idea) — purple
  - →P (to Project) — green
  - ✕ (Trash) — muted, red on hover
- Clicking any action opens ProcessModal with the appropriate type pre-selected

### ProcessModal (`src/components/inbox/ProcessModal.tsx`)

Modal that appears when processing an inbox item.

Props: `item: InboxItem`, `processType: 'task' | 'idea' | 'project'`, `onClose`, `onProcessed`

- Title pre-filled from `item.raw_text` (editable)
- Area selector (required for task/project, optional for idea)
- If task: priority selector, optional project selector, due date
- If idea: optional body textarea
- If project: optional description
- Save button processes the item and closes modal

---

### IdeaCard (`src/components/ideas/IdeaCard.tsx`)

```
★★★ AI-powered meal planner app              [Dev]
    Could use OpenAI API to generate weekly plans...
```

Props: `idea: Idea`, `onRate`, `onClick`

- Rating stars (clickable to change): ★ filled, ☆ empty. 0 stars = unrated
- Title, area badge
- Body preview (1 line, truncated, muted)
- Click → opens IdeaForm for editing

### IdeaForm (`src/components/ideas/IdeaForm.tsx`)

Modal for create/edit.

Fields: Title, Body (markdown textarea), Area (optional), Rating (0-3 clickable stars)

---

### UI Primitives

#### Modal (`src/components/ui/Modal.tsx`)
- Dark overlay bg (rgba black 0.7)
- Centered card with surface bg, border, rounded-lg
- Header with title + close X button
- Body slot (children)
- Optional footer slot
- Close on Escape key, close on overlay click
- Animate: fade in overlay + scale-up card (CSS transition, no framer-motion needed)

#### Badge (`src/components/ui/Badge.tsx`)
- Small pill: area badges (colored bg at 20% opacity, colored text), priority badges, status badges
- Props: `label: string`, `color: string`, `size?: 'sm' | 'md'`

#### ProgressBar (`src/components/ui/ProgressBar.tsx`)
- Thin bar (4px height), dark track, colored fill
- Props: `value: number` (0-100), `color?: string` (default green)

#### EmptyState (`src/components/ui/EmptyState.tsx`)
- Centered text with terminal-style message
- Props: `icon`, `title`, `description`, `action?: { label, onClick }`
- Example: "No tasks yet. Capture something with the bar below."

#### LoadingState (`src/components/ui/LoadingState.tsx`)
- Terminal typing animation: `Loading...` with blinking cursor
- Or pulsing green dots
- Keep it simple and on-brand

---

## Page Specifications

### Terminal / Dashboard (`src/app/page.tsx`) — REPLACE

The home screen. Most important page.

```
── TODAY ─────────────────────────────────────
[TaskRow] Fix auth bug on dashboard     [Imperial]
[TaskRow] Push Shadow System v3 PR         [Dev]
[TaskRow] Review pull request #42       [Imperial]
[TaskRow] Research protein meal prep     [Health]
[TaskRow] Call barber for flow cut     [Personal]

── INBOX (3 unprocessed) ─────────────────────
"check out that new AI framework"
"idea for habit streak visualizer"
"ask manager about friday off"
[Process All →]

── STATS ─────────────────────────────────────
Tasks: 2/5 today  │  Inbox: 3  │  Projects: 4 active  │  Ideas: 12  │  Streak: 7d
```

Implementation:
- Use `useTasks()` → call `getTodayTasks()` or use the imported `computeTodayTasks` with fetched tasks
- Use `useInbox()` for unprocessed items (show max 5, with "View all →" link)
- Use `useStats()` for stats bar at bottom
- Section headers: monospace, all caps, muted color, with `──` line decoration
- "Process All →" links to `/inbox`
- If no today tasks: EmptyState with message "All clear. Capture something new."
- If inbox is empty: don't show inbox section at all
- Each TaskRow is interactive — click to expand, checkbox to complete
- Stats bar: fixed at bottom of the content area (not the page), monospace, small text, muted, with green accent numbers

### Inbox Page (`src/app/inbox/page.tsx`) — REPLACE

```
── INBOX (7 unprocessed) ─────────────────────

[InboxItem] "check out that new AI framework"    [→T] [→I] [→P] [✕]
[InboxItem] "idea for habit streak visualizer"    [→T] [→I] [→P] [✕]
[InboxItem] "ask manager about friday off"        [→T] [→I] [→P] [✕]
...

── PROCESSED TODAY (4) ────────────────────────
✓ "fix login bug" → Task [Imperial]
✓ "try rust" → Idea [Learning]
```

Implementation:
- Use `useInbox()`
- Show unprocessed items with action buttons
- Below: show items processed today (query inbox where processed_at::date = today), collapsed by default, expandable
- If inbox empty: EmptyState "Inbox zero. Your brain is clear."
- Each action button opens ProcessModal

### Projects Page (`src/app/projects/page.tsx`) — REPLACE

```
── ACTIVE ────────────────────────────────────
[ProjectCard] Shadow System v3           [Dev]
[ProjectCard] Dashboard Redesign      [Imperial]

── PAUSED (2) ────────────────────────────────
[ProjectCard] ...

── COMPLETED (8) ─────────────────────────────
[ProjectCard] ... (collapsed, click to expand)
```

Implementation:
- Use `useProjects()`
- Group by status: active → paused → completed → abandoned
- Active shown fully, others collapsed with count, click to expand
- Floating action button (bottom right): `+` to create new project via ProjectForm
- Filter bar at top: area filter dropdown (optional for v1 — skip if it adds too much time)

### Project Detail (`src/app/projects/[id]/page.tsx`) — REPLACE

```
← PROJECTS / Shadow System v3                [Dev]
Build the real training system
████████░░░░░░░░░░  4/12 tasks  •  Due: Apr 15  •  P1

── TODO ──────────────────────────────────────
[TaskRow] Build quest engine v3               P1
[TaskRow] Implement fuel domain               P2

── IN PROGRESS ───────────────────────────────
[TaskRow] Progression ladder logic            P1

── DONE ──────────────────────────────────────
[TaskRow] Write v3 PRD                        ✓
[TaskRow] Design data models                  ✓

[+ Add Task]
```

Implementation:
- Fetch project by ID + its tasks using `useTasks({ project_id })`
- Also fetch done tasks for this project (override default filter)
- Back link to `/projects`
- Project header: title, description, progress bar, deadline, priority
- Tasks grouped by status: todo → in_progress → done
- Add Task button opens TaskForm with `defaultProjectId` set
- Edit project button (pencil icon in header) opens ProjectForm
- Delete project button with confirmation modal

### Areas Page (`src/app/areas/page.tsx`) — REPLACE

```
── AREAS ─────────────────────────────────────

>_ IMPERIAL                    2 projects  •  8 tasks
⚡ DST                          1 project   •  4 tasks
◇  AI BIZ                      2 projects  •  6 tasks
↗  FREELANCE                   1 project   •  3 tasks
{} DEV                          3 projects  • 15 tasks
♥  HEALTH                      1 project   •  3 tasks
◈  LEARNING                    1 project   •  5 tasks
☾  FAITH                       0 projects  •  2 tasks
◉  PERSONAL                    1 project   •  2 tasks
$  FINANCE                     0 projects  •  1 task
```

Implementation:
- Use `useAreas()`
- For each area, show counts (active projects + open tasks) — fetch these counts
  - Simplest: fetch all projects and tasks once, count client-side per area
- Each row is clickable → navigates to `/areas/[id]`
- Area icon with area color, name in caps, counts muted
- Bottom: "+ Add Area" button (opens a simple form inline or modal)

### Area Detail (`src/app/areas/[id]/page.tsx`) — REPLACE

```
← AREAS / ⚡ DST
Dream Service Team — HVAC/boiler proposals

── PROJECTS (1 active) ───────────────────────
[ProjectCard] Q1 Sprint

── TASKS (4 open) ────────────────────────────
[TaskRow] Send proposal to Manhattan client   P1
[TaskRow] Follow up with Brooklyn lead        P2
...

── IDEAS (2) ─────────────────────────────────
[IdeaCard] Automated quoting tool             ★★
```

Implementation:
- Fetch area by ID
- Use `useProjects({ area_id })` and `useTasks({ area_id })` and `useIdeas({ area_id })`
- Show projects, tasks, and ideas for this area
- Add Task / Add Project buttons

### Ideas Page (`src/app/ideas/page.tsx`) — REPLACE

```
── IDEAS VAULT (23) ──────────────────────────

── FIRE (3) ──────────────────────────────────
[IdeaCard] ★★★ AI-powered meal planner     [Dev]
[IdeaCard] ★★★ Weekly video essay channel  [Personal]

── INTERESTING (8) ───────────────────────────
[IdeaCard] ★★  Streak visualizer           [Dev]
...

── UNRATED (12) ──────────────────────────────
[IdeaCard] ☆   "that new AI framework"     [Dev]
...
```

Implementation:
- Use `useIdeas()`
- Group by rating: 3 (Fire) → 2 (Interesting) → 1 (Meh) → 0 (Unrated)
- Each IdeaCard has clickable rating stars to change rating inline
- Floating `+` button to add new idea via IdeaForm
- Click idea → opens IdeaForm for editing

---

## Global Patterns

### Responsive Breakpoints
- Mobile: < 1024px — no sidebar, bottom nav, full-width content
- Desktop: ≥ 1024px — sidebar + content + bottom quick capture

### Loading States
- Every page shows `LoadingState` while hooks are fetching
- Use loading from each hook

### Error States
- Show error message in red text if hook returns error
- "Retry" button that re-calls fetch

### Empty States
- Every page has a contextual EmptyState when no data
- Terminal page: "All clear. Nothing to do... or is there? Capture something."
- Inbox: "Inbox zero. Your mind is clear."
- Projects: "No projects yet. Start one."
- Ideas: "No ideas captured. Let your mind wander."

### Modals
- All forms (TaskForm, ProjectForm, IdeaForm, ProcessModal) render as Modal
- Close on Escape, close on overlay click
- Never navigate to a new page for create/edit — always modal

### Toast/Feedback
- Don't build a toast system for v1. Use the green flash on QuickCapture for capture confirmation.
- For other actions (task completed, item processed), the optimistic UI update IS the feedback — the item visually moves/changes immediately.

---

## Verification

Before marking complete:

1. `npm run build` passes with zero errors
2. Every page renders with real hooks (not mock data)
3. Terminal page shows Today tasks, Inbox preview, Stats
4. Quick capture works: type text, hit Enter, item appears in inbox
5. Inbox page shows items with action buttons
6. Processing an inbox item opens ProcessModal, saving creates the entity and removes from inbox
7. Projects page shows grouped projects with progress bars
8. Project detail shows tasks grouped by status
9. Areas page shows all areas with counts
10. Area detail shows projects + tasks + ideas for that area
11. Ideas page shows ideas grouped by rating
12. Sidebar navigation works on desktop, MobileNav works on mobile
13. All modals open/close properly (Escape key, overlay click, X button)
14. Responsive: check mobile layout doesn't break

## Skills to Use
- Use **dispatching-parallel-agents** heavily — split by domain:
  - Agent 1: Layout components (AppShell, Sidebar, MobileNav, Header, QuickCapture)
  - Agent 2: UI primitives (Modal, Badge, ProgressBar, EmptyState, LoadingState)
  - Agent 3: Task components + Task pages (TaskRow, TaskForm, TaskDetail, page.tsx terminal, project detail)
  - Agent 4: Project + Inbox + Ideas components and pages
- Use **verification-before-completion** to check the full list above
- Use **frontend-design** skill for component quality

## Files Created
All component files listed in the File Structure section above.

## Files Modified
- `src/app/layout.tsx` — wrap authenticated content in AppShell
- `src/app/page.tsx` — REPLACE placeholder with Terminal dashboard
- `src/app/inbox/page.tsx` — REPLACE placeholder
- `src/app/projects/page.tsx` — REPLACE placeholder
- `src/app/projects/[id]/page.tsx` — REPLACE placeholder
- `src/app/areas/page.tsx` — REPLACE placeholder
- `src/app/areas/[id]/page.tsx` — REPLACE placeholder
- `src/app/ideas/page.tsx` — REPLACE placeholder
- `src/components/layout/Sidebar.tsx` — REPLACE placeholder
- `src/styles/globals.css` — add any missing design tokens, scrollbar styles, glow effects

## DO NOT
- Install framer-motion or any animation library — use CSS transitions only
- Create any new hooks or modify existing hooks
- Change Supabase schema
- Build Settings page (deferred)
- Build Weekly Review page (deferred)
- Build Command Palette (deferred)
- Build keyboard shortcuts (deferred)
- Build PWA service worker (deferred)
