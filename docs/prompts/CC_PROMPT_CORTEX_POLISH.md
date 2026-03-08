# Cortex — Aesthetic Polish Pass

## Context

Cortex is functionally complete. This prompt is purely visual/UX polish. The app needs to feel like a dark hacker terminal you *want* to live in — not a plain dark-mode app with monospace fonts.

**Read `src/styles/globals.css` first** to see existing design tokens. Then explore every component in `src/components/` to understand current styling.

**Reference aesthetic:** Think VS Code terminal + Warp terminal + cyberpunk UI. Dark, layered, subtle glow, alive but not distracting.

---

## 1. Visual Texture & Depth

The app currently feels flat and empty. Add layers without clutter.

### Background
- Add a very subtle grid pattern to the main background (CSS only, no images):
  ```css
  background-image: 
    linear-gradient(rgba(0, 255, 136, 0.03) 1px, transparent 1px),
    linear-gradient(90deg, rgba(0, 255, 136, 0.03) 1px, transparent 1px);
  background-size: 40px 40px;
  ```
- Apply to the body or main content area — NOT the sidebar

### Cards & Surfaces
- Project cards, task rows on hover, inbox items: add a subtle glass/frosted effect:
  ```css
  background: rgba(17, 17, 24, 0.8);
  backdrop-filter: blur(8px);
  border: 1px solid rgba(0, 255, 136, 0.08);
  ```
- On hover, cards get a very faint green glow border:
  ```css
  border-color: rgba(0, 255, 136, 0.2);
  box-shadow: 0 0 20px rgba(0, 255, 136, 0.05);
  ```

### Sidebar
- Sidebar should have a slightly different bg than content (darker or with a subtle gradient):
  ```css
  background: linear-gradient(180deg, #0A0A0F 0%, #0D0D14 100%);
  border-right: 1px solid rgba(0, 255, 136, 0.06);
  ```

### Section Headers (── TODAY ──, ── INBOX ──, etc.)
- Add a subtle gradient fade on the horizontal lines:
  ```css
  background: linear-gradient(90deg, transparent, rgba(0, 255, 136, 0.15), transparent);
  height: 1px;
  ```
  Instead of plain solid borders

---

## 2. Glow & Color Depth

### Green Accent Glow
- The "CORTEX" title in header: add text glow
  ```css
  text-shadow: 0 0 10px rgba(0, 255, 136, 0.4), 0 0 40px rgba(0, 255, 136, 0.1);
  ```
- Active sidebar item: green text with subtle glow
  ```css
  text-shadow: 0 0 8px rgba(0, 255, 136, 0.3);
  ```
- Quick Capture input caret: green
  ```css
  caret-color: #00FF88;
  ```
- Quick Capture ">" prefix: glow when input is focused
- The floating "+" FAB button: add a pulsing glow animation
  ```css
  animation: pulse-glow 2s ease-in-out infinite;
  @keyframes pulse-glow {
    0%, 100% { box-shadow: 0 0 15px rgba(0, 255, 136, 0.3); }
    50% { box-shadow: 0 0 25px rgba(0, 255, 136, 0.5); }
  }
  ```

### Area Color Badges
- Area badges (like the "Imperial" pill) should have their area color as background at ~15% opacity with the full color text — they currently look okay but add a subtle inner glow:
  ```css
  box-shadow: inset 0 0 8px rgba(AREA_COLOR, 0.1);
  ```

### Priority Colors
- P1 (urgent) tasks: faint red glow on the priority indicator
- P2 (high): faint amber glow
- These should be very subtle — just enough to feel alive

### Stats Bar
- Numbers that are non-zero: accent green color (already done based on screenshot)
- Add subtle separator glow between stat items instead of plain `│`

---

## 3. Typography & Spacing

### Font Hierarchy
- "CORTEX v1.0" header: JetBrains Mono, 16px, font-weight 700, letter-spacing 2px, green
- Section headers (TODAY, INBOX, STATS, etc.): JetBrains Mono, 11px, font-weight 600, letter-spacing 3px, uppercase, muted color with slight green tint (#4A5568 → #4A6858)
- Task titles: JetBrains Mono, 14px, font-weight 400, #E0E0E0
- Descriptions/body: Inter, 13px, font-weight 400, muted
- Stats/data: JetBrains Mono, 12px
- Timestamps: JetBrains Mono, 11px, very muted

### Spacing Fixes
- Sidebar nav items: increase vertical padding slightly (py-2.5 → py-3) for more breathing room
- Content area: add more horizontal padding on desktop (px-6 → px-10 or px-12) so content doesn't hug the sidebar
- Task rows: ensure consistent vertical spacing between rows (gap-2 or gap-3)
- Section headers: add more margin-top between sections (mt-8 at least) for clear visual separation
- Empty state messages: ensure they're vertically centered in the available space, not stuck at the top

### Quick Capture Bar
- Increase height slightly (h-12 → h-14)
- The `>` prefix should be green and slightly larger
- Input text: 14px monospace
- Add a top border with the subtle gradient line (same as section headers)

---

## 4. Animations & Transitions

All animations should be CSS-only. No framer-motion. Keep them subtle and fast.

### Page Transitions
- When content loads after hook fetch, fade in the content:
  ```css
  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(4px); }
    to { opacity: 1; transform: translateY(0); }
  }
  .page-content { animation: fadeIn 0.2s ease-out; }
  ```
- Apply this animation class to the main content wrapper of each page

### Task/Item Interactions
- Task row hover: smooth bg transition (150ms)
- Task completion: brief green flash on the checkbox, then the row fades out slightly (opacity 0.5) before being removed
  ```css
  transition: opacity 0.3s ease, background-color 0.15s ease;
  ```
- Inbox item processing: slide-out-left animation when processed
  ```css
  @keyframes slideOutLeft {
    to { transform: translateX(-20px); opacity: 0; }
  }
  ```

### Modal Animations
- Modal overlay: fade in 150ms
- Modal card: scale from 0.95 + fade in 150ms
  ```css
  @keyframes modalIn {
    from { opacity: 0; transform: scale(0.95); }
    to { opacity: 1; transform: scale(1); }
  }
  ```

### Sidebar
- Active indicator (green left border): animate width/opacity on route change
- Hover state: smooth 150ms bg transition
- Inbox badge count: when count changes, brief scale-up animation (1 → 1.2 → 1) 

### Quick Capture
- On successful capture: brief green flash on the entire bar (bg goes rgba(0,255,136,0.05) then fades back)
- Input clear: smooth (not instant)

### Floating Action Button (+)
- Already has pulse-glow from section 2
- On hover: scale up slightly (1.1) with transition

### Loading State
- Replace static "Loading..." with a terminal-style typing animation:
  ```css
  @keyframes blink {
    0%, 100% { opacity: 1; }
    50% { opacity: 0; }
  }
  .cursor-blink::after {
    content: '█';
    animation: blink 1s step-end infinite;
    color: #00FF88;
  }
  ```
- Show: `> Loading█` with blinking cursor

---

## 5. Scrollbar Styling

Custom scrollbar for the hacker aesthetic:
```css
::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}
::-webkit-scrollbar-track {
  background: transparent;
}
::-webkit-scrollbar-thumb {
  background: rgba(0, 255, 136, 0.15);
  border-radius: 3px;
}
::-webkit-scrollbar-thumb:hover {
  background: rgba(0, 255, 136, 0.3);
}
```

---

## 6. Mobile Specific

- MobileNav bottom bar: add a subtle top border glow and slightly frosted glass bg
- Quick capture modal (mobile): slide up from bottom with spring-like ease
- Touch feedback on task completion: brief haptic-style visual pulse

---

## Verification

1. `npm run build` passes
2. Background grid pattern is visible but extremely subtle
3. Cards have glass effect with border glow on hover
4. "CORTEX" title glows green
5. Page content fades in on load (not instant pop)
6. Task completion has visual feedback (flash + fade)
7. Modals animate in/out
8. Loading state shows blinking cursor
9. Scrollbar is styled (thin, green-tinted)
10. Overall feel: dark, layered, alive, professional — not a plain dark Bootstrap app

## Skills to Use
- Use **frontend-design** skill for component quality and aesthetic decisions
- Use **verification-before-completion** to check the list above

## Files Modified
- `src/styles/globals.css` — grid bg, scrollbar, keyframe animations, glow utilities
- `src/components/layout/AppShell.tsx` — bg grid on content area
- `src/components/layout/Sidebar.tsx` — gradient bg, glow on active, hover transitions
- `src/components/layout/Header.tsx` — title glow
- `src/components/layout/QuickCapture.tsx` — capture flash, styling upgrades
- `src/components/layout/MobileNav.tsx` — glass effect, border glow
- `src/components/ui/LoadingState.tsx` — blinking cursor animation
- `src/components/ui/Modal.tsx` — enter/exit animations
- `src/components/ui/Badge.tsx` — inner glow for area badges
- `src/components/tasks/TaskRow.tsx` — hover transition, completion animation
- `src/components/projects/ProjectCard.tsx` — glass effect, hover glow
- `src/components/inbox/InboxItem.tsx` — slide-out on process
- All page files — add fadeIn animation class to content wrapper

## DO NOT
- Install any animation libraries (CSS only)
- Change any data logic, hooks, or Supabase queries
- Break existing functionality — this is visual only
- Add scanline overlay (cut from v1 — too distracting)
- Go overboard — every effect should be SUBTLE. If you can barely notice it, it's perfect. If it's obvious, it's too much.
