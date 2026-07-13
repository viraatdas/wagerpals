# Decisions

Shared, agent-authored log of cross-cutting decisions the fleet must honor. The conductor records plan/steer decisions here; workers record interface contracts + adjustments. Re-read before each significant step.

## Plan approved
- **What:** Approved a 1-task plan for: can you implement a calendar. Tasks: Events calendar page (web).
- **Why:** user-approved plan; workers implement these nodes in isolated workspaces, honoring the dependency edges
- **By:** conductor · 1783906505969

## n0: Added /calendar month-grid page (app/calendar/page.tsx) in the Midnight Glass
- **Did:** Added /calendar month-grid page (app/calendar/page.tsx) in the Midnight Glass style: fetches groups then per-group events like all-events, plots events on their end_time day as state-colored chips (mint=live, amber=ended awaiting resolution, muted=resolved) linking to /events/[id]; prev/next/Today month nav, dimmed out-of-month days, highlighted today, +N-more overflow, selected-day detail panel (mobile uses dots + panel), legend, loading skeleton, empty state with Create Event link. Added Calendar nav link to Header desktop links and mobile bottom nav (grid-cols-5→6). Verified: npx tsc --noEmit passes, npx next build succeeds, /calendar serves HTTP 200 under next start.
- **Interfaces:** New route app/calendar/page.tsx (client page, force-dynamic). Edited components/Header.tsx: desktopLinks + mobile navItems gained /calendar entries. No API or type changes; reuses EventWithStats from lib/types and GET /api/groups + /api/events.
- **Follow-ups:**
  - Mobile bottom nav now has 6 tabs [out of lane] — grid-cols-6 fits but is tighter on very narrow phones; consider consolidating if more tabs are added
- **By:** n0 · 2026-07-13T01:41:23.556Z

## n0-2: Web light theme foundation — token contract for downstream workers
- **What:** globals.css/tailwind.config.ts/layout.tsx are now light-themed. ALL class and token names are unchanged; only values changed. Contract for page/component workers:
  - `--bg` #ffffff, `--bg-2` #f7f8fa (panel gray), `--foreground` #1e2530, `--muted` #6b7280, `--muted-2` #9ca3af.
  - `--surface` and `--border` are still RGB **channels** but flipped from white to dark slate (`30 37 48` / `31 41 55`): `rgb(var(--surface)/0.05)` now yields a subtle gray tint on white, `rgb(var(--border)/0.1)` ≈ #e5e7eb hairline. Any component using raw `bg-white/5`, `border-white/10` etc. must be migrated — white-alpha overlays are invisible on the light canvas.
  - Brand ramp is the blue accent: `--brand-1` #3b82f6, `--brand-2` #2563eb (DEFAULT), `--brand-3` #1d4ed8. Neon names are semantic now: mint=#16a34a (yes/live), rose=#dc2626 (no), amber=#d97706, cyan=#0284c7, violet=#4f46e5.
  - `.glass`/`.glass-strong` = white bordered cards with subtle shadows; `.glass-subtle` = --bg-2 panel; `.btn-primary` = solid blue pill; `.btn-glass` = white bordered pill; chips = light tinted pills; `.text-gradient`/`.text-gradient-cool` = solid ink/blue (no longer transparent-clip). shadow-glow* tailwind tokens are now subtle light-theme shadows.
  - `.aurora` is `display:none` and the div is removed from layout.tsx; html no longer has the `dark` class (tailwind `dark:` variants no longer apply). themeColor is #ffffff.
- **Why:** keeps every downstream file compiling and rendering sensibly during the light-mode migration
- **By:** n0-2 · 2026-07-13

