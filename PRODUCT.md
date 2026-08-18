# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

The product is adaptive in fact — a Next.js 14 web app plus an Expo/React Native iOS app in
`mobile/` sharing one API — but the current redesign scope is **web only**. Mobile keeps its
existing light theme until a follow-up pass, so the lockstep rule between `app/globals.css`
and `mobile/src/theme.ts` is suspended for the dark palette (see DESIGN.md).

## Users

Small private friend groups — a group chat that bets on each other. Members are peers, not
house-vs-player: anyone can propose a bet, anyone can take a side. A group has admins and a
designated resolver who settles outcomes. Typical bets are about the group's own members
("is Nikita going to be employed by 2027?"), sports, and life events.

The real usage scene is a phone, in a group-chat moment, often at night — the app is opened in
bursts to check whether someone took the other side, not studied for long stretches.

## Product Purpose

Make a casual "bet you a tenner" between friends real: recorded, taken seriously, and settled.
Success is a group that keeps a running, visible receipt trail of who's been right.

## Positioning

Polymarket's mechanics at group-chat scale. Unlike a sportsbook, there is no house and no
counterparty risk — the group is the market, the stake is escrowed between members, and the
social layer (who proposed it, who's talking trash) is the product, not a comment box bolted on.

## Operating Context

- Groups are joined by a 6-digit code or an invite link; membership is the read boundary for
  every roster, bet, and settlement.
- Bets ("events") have two sides, an end time, and a resolver who declares the winner.
- Bets are either **just-for-fun** (`payment_type: 'none'`) or **cash** — cash stakes are
  escrowed on placement and paid out on settlement.
- A bet can be *about* a group member, who can be deliberately not notified (subject privacy).
- Bets can be composed and taken directly inside iMessage via a native Messages extension.

## Capabilities and Constraints

- Next.js 14 App Router, React 18, TypeScript, Tailwind. Postgres via `@vercel/postgres`,
  reached only through `lib/db.ts`. Auth is Stack Auth. Payments are Stripe.
- Deployed on Vercel; production is `wagerpals.io`.
- **Styling is tokens-only.** Design tokens are CSS custom properties in `app/globals.css`
  `:root`, surfaced through `tailwind.config.ts`. Raw hex in components is treated as a bug.
- Security invariants that any redesign must not disturb: money idempotency, one canonical user
  row per human, group membership as the read boundary, a never-anonymous user directory, and a
  single central notification filter. See CLAUDE.md §8.
- Terminology to keep: *group*, *bet*, *side*, *stake*, *escrow*, *resolve*, *settle*.

## Brand Commitments

- Name: **WagerPals**. Tagline in use: "Polymarket for friends".
- The mark must **not** be built from the letter W — explicitly rejected by the owner as "lame".
- Voice is the group chat, not the casino: irreverent, plain, a little competitive. Never
  "Vegas", never house-vs-player framing.

## Evidence on Hand

- Live production data: 45 users, 14 groups, 30 bets, 48 placed wagers. Real bet titles are the
  best available copy source for realistic states — use them, do not invent testimonials,
  user counts, or press.
- No marketing site, no case studies, no logos other than the app's own mark and icon set.

## Product Principles

1. **The group is the market.** Every screen should answer "who else is in, and on which side?"
   before it answers anything else.
2. **A settled bet is a receipt.** History is the point; resolved bets stay visible rather than
   disappearing.
3. **Talk is a first-class feature.** Comments are where the product's value actually lives;
   they are never a footer.
4. **Stakes should feel like stakes.** Money and odds get the loudest typography on the page.
5. **Membership gates everything.** No surface may leak a roster, stake, or settlement to a
   non-member.

## Accessibility & Inclusion

No product-specific standard was established by the owner. The floor applied here: text contrast
≥4.5:1 (≥3:1 for large display type) against the dark surfaces, visible keyboard focus, and
motion that respects `prefers-reduced-motion` — the app already ships reduced-motion handling in
the logo and comment threads and must keep it.
