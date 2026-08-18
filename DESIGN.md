# Design

The visual world for the WagerPals **web** app. This replaces the previous light "Midnight
Glass → light blue" system; that look is evidence of what the product is, not authority over
what it becomes. `mobile/src/theme.ts` is deliberately **not** migrated yet (PRODUCT.md
§Platform) — do not treat the mobile light theme as drift.

## The world: after-hours ticker

A near-black room with one live green readout. The reference is a stock ticker or a scoreboard
seen at 1am — instrument panel, not casino floor. Everything structural is quiet charcoal; the
only saturated colour in the interface is the state of a bet. Green is not decoration, it is
"live / up / won", and it earns its loudness by being the only thing that has it.

Loud where it counts: money, odds, counts, countdowns, and the word SETTLED. Quiet everywhere
else: labels, chrome, navigation, and body copy recede into grey so the numbers read first.

## Palette

Defined once in `app/globals.css :root`. Never write a raw hex in a component.

| Token | Value | Role |
|---|---|---|
| `--color-bg` | `#0A0B0D` | Page. Near-black, faintly cool. |
| `--color-surface` | `#121417` | Cards, the feed's rows. |
| `--color-surface-2` | `#191C21` | Hover, inputs, pressed. |
| `--color-border` | `#252A31` | Hairlines. 1px only. |
| `--color-border-strong` | `#333A43` | Focus rings, active edges. |
| `--color-text` | `#E9ECEF` | Primary copy. 14.8:1 on `--color-bg`. |
| `--color-text-secondary` | `#A2A9B2` | Labels, meta. 7.1:1. |
| `--color-text-muted` | `#6B737D` | Timestamps only. 4.0:1 — never body copy. |
| `--color-accent` | `#24E17A` | Phosphor green. Live state, primary action, "yes". |
| `--color-accent-soft` | `#6EF9A5` | Hover lift, glow stops. |
| `--color-accent-deep` | `#0F9E56` | Pressed, and green that must sit under white text. |
| `--color-no` | `#FF5C63` | The opposing side, losses. |
| `--color-pending` | `#FFB020` | Escrow held, awaiting resolution. |
| `--color-info` | `#4CC2FF` | Neutral notices. |

Accent is dark-text-on-green, never white-on-green: `#24E17A` carries black at 11.4:1 and white
at only 1.8:1. Any green button uses `--color-bg` for its label.

## Type

Two faces, loaded through `next/font/google` and self-hosted by Next at build time.

- **Display — Oswald (500/600/700).** Condensed, chunky, tabular-friendly lining figures. It is
  reserved for *quantities and verdicts*: stakes, odds, side counts, the countdown, the leaderboard
  rank, and the SETTLED stamp. Set it with `letter-spacing: -0.01em` and `font-variant-numeric:
  tabular-nums` so columns of money align.
- **UI — IBM Plex Sans (400/500/600).** Humanist, warmer and more spoken than Inter, which suits
  a product whose main content is people arguing. Everything that is language rather than
  quantity: headings, body, labels, buttons, comments.

Scale steps stay on the existing `--text-*` tokens. Display type may reach `clamp(2.5rem, 8vw,
4.5rem)` for a headline stake; nothing exceeds 6rem. Body measure caps at 68ch.

## Depth and light

The room is lit from above. Elevation is a real offset shadow plus a hairline, never a halo:

- `--shadow-elev-1`: `0 1px 2px rgb(0 0 0 / 0.4)` — resting cards.
- `--shadow-elev-2`: `0 4px 12px -2px rgb(0 0 0 / 0.5)` — raised, hover.
- `--shadow-elev-3`: `0 12px 32px -6px rgb(0 0 0 / 0.6)` — modals.

**Activity glow** is the one exception and the world's signature: a card with recent activity
gets `box-shadow: 0 0 0 1px rgb(var(--color-accent-rgb) / 0.35), 0 0 24px -6px rgb(var(--color-accent-rgb) / 0.25)`
— a colored edge plus bloom, sitting *on top of* the normal elevation shadow, not replacing it.
It decays: a card is "hot" for 10 minutes after activity, then returns to rest.

## Motion

One authored moment per surface, exponential ease-out from an already-visible default. All of it
sits behind `@media (prefers-reduced-motion: no-preference)`.

- **Feed:** the activity glow breathes once when a card first mounts hot — it does not loop.
- **Bet detail:** the tug-of-war bar animates from centre to its true split on load, and
  re-animates when the split changes. This is the page's authored moment.
- **Lock in:** placing a bet drops the button into a pressed state and slides the stake into the
  bar — a short, weighted translate + scale, not a bounce.
- **Settled:** the SETTLED stamp lands once, rotated, with a fast scale-down and a shadow that
  tightens on impact.

## Components

- **Bet card (feed).** Proposer + timestamp, the bet title as the loudest language on the card,
  the tug-of-war bar, side counts in display face, the stake, and the two most recent comments
  inline with a count. Hot cards glow. Resolved cards collapse to a shorter row, desaturate, and
  carry the SETTLED stamp with the winning side.
- **Tug-of-war bar.** A single horizontal track split by stake weight, accent green on the left
  side and `--color-no` on the right, with a moving seam. Avatars stack on each end like chips
  (max 4 shown, then `+N`). This replaces every pie, ring, and bar-chart in the old design.
- **Stamp.** Display face, uppercase, heavy tracking, rotated ~-8°, drawn with a 2px outline and
  a knocked-back fill so it reads as ink on paper, not a badge.
- **Icons.** Drawn SVG on a 24px grid, 1.75px stroke, round caps. **No emoji anywhere in the
  UI** — the old design used 🎲 and friends; those are replaced.

## Bans specific to this world

- No gradient text, ever. Emphasis is weight and size.
- No card grid of icon + heading + text as page structure. The feed is a feed.
- No nested cards. A comment inside a bet card is a row, not a card.
- No monospace as a "technical" costume — the display face carries the data feel.
- No emoji as icons.
- Green is only ever live/won/yes. It never colours a neutral surface, a heading, or a border
  that means nothing.
