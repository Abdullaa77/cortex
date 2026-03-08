# Cortex — Fix Prompt: Critical Issues

## Read the codebase first
Explore `src/components/layout/QuickCapture.tsx`, `src/hooks/useInbox.ts`, `src/components/providers/SupabaseProvider.tsx`, and the browser console for errors before making any changes.

---

## Issue 1: Quick Capture Not Working (CRITICAL)

Typing text in the Quick Capture bar and pressing Enter does nothing — the item does not appear in Inbox.

**Debug steps (do all of these, report findings):**

1. Open browser dev tools → Console. Type in Quick Capture and press Enter. Report any errors.
2. Check `QuickCapture.tsx`:
   - Is it calling `useInbox()` and getting the `capture` function?
   - Is the `onSubmit` / `onKeyDown` handler actually calling `capture(text)`?
   - Is the input value being read correctly?
   - Is there an `e.preventDefault()` missing?
3. Check `useInbox.ts`:
   - Does the `capture` function call `supabase.from('inbox').insert(...)`?
   - Is `user.id` available when capture is called? (Check if `useSupabase()` returns the user)
   - Add a `console.log` before the insert to confirm it's being reached
4. Check `SupabaseProvider.tsx`:
   - Does it expose `user` with an `id` property?
   - Is `user` null when Quick Capture tries to use it?
5. Check Supabase dashboard → Table Editor → inbox table. Are there any rows? (Maybe rows are being inserted but the UI isn't refreshing)

**Common causes:**
- `user` is undefined because SupabaseProvider hasn't resolved the session yet
- The hook isn't connected to the provider properly
- Missing `await` on the capture call
- The input's onChange doesn't update state, so the submitted text is empty
- RLS policy blocks the insert because user_id doesn't match

**Fix it, then verify:**
- Type "test capture" in Quick Capture bar
- Press Enter
- Item should appear in Inbox page immediately
- Input should clear after capture
- Brief visual feedback (green flash or text change)

---

## Issue 2: Slow Page Transitions (1-2 seconds)

Each page takes 1-2 seconds to render when switching between sections. Users see a loading state or blank page before content appears.

**Root cause is likely:** Every page hook calls `fetchX()` in `useEffect` on mount, each making separate Supabase queries. There's no shared cache between pages.

**Fix approach — choose the simplest that works:**

### Option A: Add loading skeleton instead of blank (quick win)
- Each page already has a LoadingState component — make sure it renders immediately (not after a delay)
- This doesn't fix the actual speed but removes the perceived lag

### Option B: Fetch faster with parallel queries
- In hooks that make multiple queries (like useStats, useProjects with task counts), use `Promise.all` instead of sequential awaits
- Check each hook for sequential queries that could be parallelized

### Option C: Shared data context (best long-term, more work)
- Skip this for now — too much refactoring for a fix prompt

**Do Option A + B:**
1. Ensure every page shows LoadingState immediately (skeleton, not blank)
2. In every hook, wrap multiple Supabase queries in `Promise.all` where they don't depend on each other
3. In `useProjects`, the task count query should run in parallel with the projects query, not after

---

## Issue 3: Settings 404

Settings page was cut from v1 but the sidebar still links to it.

**Fix:**
Create `src/app/settings/page.tsx` as a simple placeholder:
```
── SETTINGS ──

> Coming soon.

Settings will be available in the next update.
```

Style it like other pages — monospace header, muted text, centered. Don't build any actual settings UI.

---

## Verification

1. Quick Capture: type text, Enter → item appears in Inbox
2. Navigate Terminal → Inbox → Projects → Areas — no blank white screens, loading states show immediately
3. Settings page renders without 404
4. `npm run build` still passes

## Skills to Use
- Use **systematic-debugging** for Issue 1
- Use **verification-before-completion** for all checks

## Files likely modified
- `src/components/layout/QuickCapture.tsx`
- `src/hooks/useInbox.ts` (if bug is here)
- `src/components/providers/SupabaseProvider.tsx` (if user not exposed properly)
- `src/hooks/useProjects.ts` (parallel queries)
- `src/hooks/useStats.ts` (parallel queries)
- Multiple page files (ensure LoadingState renders first)
- `src/app/settings/page.tsx` (NEW — placeholder)
