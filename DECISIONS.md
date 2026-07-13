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

