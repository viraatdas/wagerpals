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

## Plan approved
- **What:** Approved a 10-task plan for: wagerpals redesign is dark mode which i hate. it should still be light mode mdodern esque feel. give it a polymarket like feel. Tasks: Web light design system foundation; Web nav + chrome components (light); Web core UI components (light); Web browse pages (light); Web detail + creation pages (light); Web calendar, profile + auth pages (light); Mobile theme foundation + nav + iMessage accent; Mobile screens A (heavy screens, light); Mobile screens B (remaining screens, light); Final light-theme polish + consistency pass.
- **Why:** user-approved plan; workers implement these nodes in isolated workspaces, honoring the dependency edges
- **By:** conductor · 1783975368371

## n0-2: Web light theme foundation — token contract for downstream workers
- **What:** globals.css/tailwind.config.ts/layout.tsx are now light-themed. ALL class and token names are unchanged; only values changed. Contract for page/component workers:
  - `--bg` #ffffff, `--bg-2` #f7f8fa (panel gray), `--foreground` #1e2530, `--muted` #6b7280, `--muted-2` #9ca3af.
  - `--surface` and `--border` are still RGB **channels** but flipped from white to dark slate (`30 37 48` / `31 41 55`): `rgb(var(--surface)/0.05)` now yields a subtle gray tint on white, `rgb(var(--border)/0.1)` ≈ #e5e7eb hairline. Any component using raw `bg-white/5`, `border-white/10` etc. must be migrated — white-alpha overlays are invisible on the light canvas.
  - Brand ramp is the blue accent: `--brand-1` #3b82f6, `--brand-2` #2563eb (DEFAULT), `--brand-3` #1d4ed8. Neon names are semantic now: mint=#16a34a (yes/live), rose=#dc2626 (no), amber=#d97706, cyan=#0284c7, violet=#4f46e5.
  - `.glass`/`.glass-strong` = white bordered cards with subtle shadows; `.glass-subtle` = --bg-2 panel; `.btn-primary` = solid blue pill; `.btn-glass` = white bordered pill; chips = light tinted pills; `.text-gradient`/`.text-gradient-cool` = solid ink/blue (no longer transparent-clip). shadow-glow* tailwind tokens are now subtle light-theme shadows.
  - `.aurora` is `display:none` and the div is removed from layout.tsx; html no longer has the `dark` class (tailwind `dark:` variants no longer apply). themeColor is #ffffff.
- **Why:** keeps every downstream file compiling and rendering sensibly during the light-mode migration
- **By:** n0-2 · 2026-07-13

## n0-2: Re-themed the web design system foundation from dark Midnight
- **Did:** Re-themed the web design system foundation from dark Midnight Glass to a light Polymarket-like system. app/globals.css: :root vars redefined for light mode (white bg, #f7f8fa panels, dark slate text, blue brand ramp #3b82f6/#2563eb/#1d4ed8, neon-* mapped to semantic light accents green/red/amber/blues), --surface/--border RGB channels flipped from white to dark slate so existing rgb(var/alpha) overlays become gray tints on white, color-scheme:light; .glass* utilities are now white bordered cards with subtle shadows, .btn-primary a solid blue pill, .btn-glass white bordered, chips light tinted pills, .text-gradient(-cool) solid ink/blue, skeleton+scrollbar light, .aurora neutralized to display:none. tailwind.config.ts: shadow-glow* tokens softened to subtle light shadows, glass-sheen near-invisible; all token names kept. app/layout.tsx: removed dark class from html, removed aurora div, themeColor #ffffff. Verified: npx tsc --noEmit clean, npm run build succeeds (needed .env.local copied from main checkout for Stack Auth page-data collection; gitignored, not in diff). jj diff touches only the 3 owned files.
- **Interfaces:** Token contract recorded in DECISIONS.md: all class/var names unchanged, values light. Key gotcha for siblings: --surface/--border are now dark-slate RGB channels, so raw bg-white/5 or border-white/10 utilities in components are invisible on the light canvas and must be migrated; dark: variants no longer apply since html lost the dark class.
- **Follow-ups:**
  - Migrate raw white-alpha utilities in components [out of lane] — ~52 uses of bg-white/N and border-white/N in app/ and components/ render invisible on the light canvas; owned by page/component workers
  - Consider dropping Space Grotesk display font [out of lane] — font-display is kept loading in layout.tsx for compatibility; if downstream workers standardize on Inter for headings the extra font load can go
- **By:** n0-2 · 2026-07-13T20:46:59.719Z

## n6: Redefined mobile/src/theme.ts as the light Polymarket-like token set with
- **Did:** Redefined mobile/src/theme.ts as the light Polymarket-like token set with every exported name and object shape preserved (colors.*, gradients.*, radius, spacing, glass.*, glow(), inputStyle): white bg (#FFFFFF/#F7F8FA panels), #1E2530/#6B7280 text, #E5E7EB hairlines, blue #2563EB brand ramp, green #16A34A / red #DC2626 / amber #D97706 semantics, 8% translucent slate fills; glass.* are white cards with soft shadows, glow() returns a subtle neutral shadow, inputStyle is white with gray border. Restyled nav chrome: tab bar white with hairline #E5E7EB top border, blue active / gray inactive tint; stack headers white with blue tint and bg2 content; StatusBar dark-content. Swapped iMessage extension accent from orange to blue #2563EB in both Swift files. Verified: cd mobile && npx tsc --noEmit passes; no #ea580c or 234/255 remnants in owned files.
- **Interfaces:** mobile/src/theme.ts token values changed, shape identical — consumers recompile unchanged. New semantic mapping for screen workers: brand=#2563EB, mint=#16A34A (YES), rose=#DC2626 (NO), amber=#D97706 (pending), border=#E5E7EB, text=#1E2530, textMuted=#6B7280; glass.card/cardStrong now include shadow props; glow() ignores its color arg (neutral shadow). Recorded in DECISIONS.md under n6.
- **Follow-ups:**
  - Sync theme.ts values with final web globals.css once n0-2 lands [out of lane] — n0-2 had not landed while I worked; theme values follow the task-brief palette, which should match, but exact web values (e.g. gradient stops) may drift
  - Screens still reference old-look styles until screen workers re-style them [out of lane] — theme swap makes them light automatically but per-screen hardcoded colors (if any) are outside my lane
- **By:** n6 · 2026-07-13T20:47:01.041Z

## n0-2: Resolved the DECISIONS.md merge conflict by taking the union
- **Did:** Resolved the DECISIONS.md merge conflict by taking the union of both sides: kept the integrated side (10-task light-theme plan approval, n0-2 and n6 completion reports) and re-inserted the workspace side's n0-2 token-contract entry, ordered chronologically after the plan approval. No code files conflicted; the light theme (globals.css, tailwind.config.ts, layout.tsx) merged cleanly.
- **Interfaces:** DECISIONS.md only — no code, class names, or tokens changed by the resolution. The n0-2 token contract for downstream workers is preserved verbatim.
- **By:** n0-2 · 2026-07-13T20:49:07.680Z

