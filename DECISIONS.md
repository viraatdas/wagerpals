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

## n6: mobile/src/theme.ts is now the LIGHT Polymarket-like token set (same export shape)
- **What:** All exported names/shapes unchanged (colors.*, gradients.*, radius, spacing, glass.*, glow(), inputStyle) but values are now light: bg #FFFFFF, bg2 #F7F8FA, surface/surfaceElevated #FFFFFF, surfaceGlass rgba(15,23,42,0.04), border #E5E7EB, text #1E2530, textMuted #6B7280, textFaint #9CA3AF, brand/brand2 #2563EB (brand1 #3B82F6, brand3 #1D4ED8), mint #16A34A (YES), rose #DC2626 (NO), amber #D97706 (pending), cyan #0EA5E9, violet #4F46E5; *Fill tokens are 8% tints. glass.card/cardStrong are white cards with #E5E7EB border + soft slate shadow; glow() now ignores its color arg and returns a subtle neutral shadow; gradients.card is near-flat white. Screens restyled against these tokens get the light look automatically — do NOT hardcode dark values or re-add neon.
- **Why:** 15 files (~500 refs) consume these tokens; keeping the shape lets screen workers re-style without import churn.
- **Also:** nav chrome (tab bar white + hairline #E5E7EB top border, active tint colors.brand, inactive colors.textFaint; stack headers white bg / blue tint; contentStyle bg2), StatusBar style="dark", iMessage Swift accent is now #2563EB (was orange).
- **By:** n6 · 2026-07-13

