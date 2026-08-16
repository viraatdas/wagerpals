# CLAUDE.md

Guidance for AI coding agents (and new engineers) working in this repo. Every command and
path below was verified against the checkout at the time of writing — see the note at the
bottom of each section for anything that could not be fully verified.

## 1. Stack

**Web (repo root)** — Next.js 14 App Router, from `package.json`:
- `next` 14.2.15, `react` / `react-dom` ^18.3.1, TypeScript ^5
- `@vercel/postgres` ^0.10.0 — the only Postgres client used anywhere in the app
- `@stackframe/stack` ^2.8.41 — auth (Stack Auth)
- `stripe` ^22.0.0, `@stripe/stripe-js` ^9.4.0, `@stripe/react-stripe-js` ^6.3.0 — payments
- `web-push` ^3.6.7 — web push notifications (VAPID)
- `tailwindcss` ^3.4.14 — styling, driven by CSS custom properties (see §5, §8)
- `tsx` ^4.20.6 — runs every script in `scripts/` directly against TypeScript
- Package manager: npm (`package-lock.json` is committed)

**Mobile (`mobile/`)** — Expo / React Native, from `mobile/package.json`:
- `expo` ~54.0.13, `react-native` 0.81.4, `react` / `react-dom` 19.1.0
- `@react-navigation/native` ^7.1.18, `@react-navigation/bottom-tabs` ^7.4.9, `@react-navigation/native-stack` ^7.3.28
- `expo-notifications` ^0.32.12, `expo-secure-store` ~15.0.7, `expo-device`, `expo-haptics`, `expo-linear-gradient`
- TypeScript ~5.9.2
- Ships a native iMessage Messages App Extension via a config plugin at
  `mobile/plugins/imessage-extension/withIMessageExtension.js`, with Swift sources under
  `mobile/plugins/imessage-extension/swift/`. The extension is injected by `expo prebuild`
  (see §2) — there is no committed `mobile/ios/` directory; it's generated, not checked in.

## 2. How to run

### Web

```bash
npm install
cp .env.local.example .env.local   # fill in real values — see §4
npm run dev                        # next dev, http://localhost:3000
```

`npm run build` (`next build`) / `npm run start` (`next start`) / `npm run lint` (`next lint`)
all exist and map to their standard Next.js meaning.

### Mobile

```bash
cd mobile
npm install
cp .env.example .env               # fill in real values — see §4
npm start                          # expo start
```

Other verified `mobile/package.json` scripts:
- `npm run android` / `npm run ios` — `expo run:android` / `expo run:ios` (generates native
  projects on demand if missing)
- `npm run web` — `expo start --web`
- `npm run prebuild` — `EXPO_PUBLIC_API_URL=https://wagerpals.io expo prebuild --platform ios --clean`
  (regenerates `mobile/ios/`, including the iMessage extension target)
- `npm run beta` / `npm run build:ios` — `cd ios && fastlane beta` / `cd ios && fastlane build`.
  These require `mobile/ios/` to already exist (run `prebuild` first) and a working Fastlane
  setup; not verified further here (Fastlane/Xcode toolchain, Apple credentials).

**Not documented here (confirmed absent from `package.json` at time of writing):**
`db:test`, `db:add-push`, `verify-pwa`, `test:push` — none of these exist as npm scripts in
this checkout; do not add them back without also adding a working target file.

## 3. Database & migrations

Postgres is reached through `@vercel/postgres`, and only `lib/db.ts` is allowed to hold raw
SQL for the app's own tables (see §7). `lib/schema.sql` is the **target schema for a fresh
database** — it defines every table (`users`, `groups`, `group_members`, `events`, `bets`,
`escrow_holds`, `comments`, `comment_reactions`, `comment_mentions`, `activities`,
`push_subscriptions`, `notification_preferences`, `event_notification_mutes`, `wallets`,
`transactions`) with the full set of constraints and indexes. For a genuinely new database,
apply it directly, e.g. `psql "$POSTGRES_URL" -f lib/schema.sql`.

### Comeback migration (bringing an existing database up to date)

```bash
npm run db:migrate   # scripts/migrate-comeback.ts — additive, idempotent, safe to re-run
npm run db:verify     # scripts/verify-comeback.ts — read-only, exits non-zero if anything is missing
```

`migrate-comeback.ts` adds the identity/auth columns, cash escrow tables, notification
preferences and threaded-comment support on top of an older database. `verify-comeback.ts`
checks structurally (every column/table/index/constraint) and functionally (constraints and
FKs actually behave, inside a transaction that is always rolled back), so it can gate a
deploy. Two data conditions can block individual steps without aborting the whole run:
duplicate emails differing only in case (blocks `idx_users_email_lower`), and
`transactions.type` values outside the allowed set (blocks validating
`transactions_type_check`, which is added `NOT VALID` so new rows are still enforced).

### Legacy/partial scripts — do not use for a fresh setup

- `npm run db:init` (`scripts/init-db.ts`) creates only the original 8 tables (`users`,
  `groups`, `group_members`, `events`, `bets`, `comments`, `activities`,
  `push_subscriptions`) with an older column set — it predates `escrow_holds`, `wallets`,
  `transactions`, `comment_reactions`, `comment_mentions`, `notification_preferences`,
  `event_notification_mutes`, and newer `users` columns (`username_selected`,
  `auth_methods`, `merged_into`). It is **not** equivalent to `lib/schema.sql`.
- `npm run db:clean` (`scripts/clean-db.ts`) drops only `activities`, `bets`, `events`,
  `users` — it does not drop most of the newer tables.
- `npm run db:migrate-mobile` (`scripts/migrate-mobile.ts`) and `npm run db:migrate-wallet`
  (`scripts/migrate-wallet.ts`) are earlier point migrations (mobile `username_selected`
  column; wallet/transaction tables) whose effects are now folded into `db:migrate` /
  `lib/schema.sql`. Safe to re-run (idempotent `IF NOT EXISTS` style), but not the
  recommended path going forward.
- `scripts/reset-db.ts`, `scripts/clear-all-data.ts`, `scripts/migrate-to-groups.ts`,
  `scripts/migrate-to-legacy.ts`, `scripts/add-public-groups.ts` exist on disk but have no
  `npm run` alias in `package.json`; they're one-off/legacy utilities — run with
  `npx tsx scripts/<name>.ts` only if you've read what they do.

### Duplicate-user merge tool

```bash
npx tsx scripts/merge-duplicate-users.ts                        # dry run (default) — prints the plan, writes nothing
npx tsx scripts/merge-duplicate-users.ts --apply                # execute the merge
npx tsx scripts/merge-duplicate-users.ts --apply --email a@b.com  # limit to one duplicate group
npx tsx scripts/merge-duplicate-users.ts --apply --keep-tombstones  # keep loser rows (merged_into set, email cleared) instead of deleting them
npx tsx scripts/merge-duplicate-users.ts --help
```

Also exposed as `npm run users:merge` (equivalent to running the script with no flags, i.e.
dry run — append ` -- --apply` etc. to pass flags through npm). If both `--dry-run` and
`--apply` are given, `--dry-run` wins. Requires `POSTGRES_URL`. It groups live `users` rows
by shared candidate email (own `email` column or any email-shaped `auth_methods[].identifier`),
picks one canonical row per group (prefers `username_selected=true`, then oldest
`created_at`), re-points every FK reference (bets, comments, reactions, mentions, activities,
group memberships, groups, escrow holds, transactions, push subscriptions, notification
prefs/mutes) onto the canonical row, sums wallet balances (aborting a group on currency
mismatch), and deletes (or tombstones) the loser(s). Re-verifies zero remaining references
before committing each group.

## 4. Environment variables

Sources checked: `.env.local.example`, `.env.example`, `mobile/.env.example`, and a grep of
`process.env.` across `app/`, `lib/`, `scripts/`, `mobile/src/`.

### Web (`.env.local`)

| Variable | Required | Notes |
|---|---|---|
| `POSTGRES_URL` | Yes | Read by `@vercel/postgres` (`lib/db.ts` and every script). |
| `POSTGRES_PRISMA_URL`, `POSTGRES_URL_NO_SSL`, `POSTGRES_URL_NON_POOLING`, `POSTGRES_USER`, `POSTGRES_HOST`, `POSTGRES_PASSWORD`, `POSTGRES_DATABASE` | Standard Vercel Postgres/Neon integration set | Not read directly by `app/` or `lib/` code in this checkout — `@vercel/postgres` only needs `POSTGRES_URL`. `POSTGRES_URL_NON_POOLING`/`POSTGRES_PRISMA_URL` are set (not read) internally by `scripts/test-auth-consolidation.ts` for its own throwaway test database. Keep them set if your Postgres provisioning tool expects the full set. |
| `NEXT_PUBLIC_STACK_PROJECT_ID`, `NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY`, `STACK_SECRET_SERVER_KEY` | Yes | Stack Auth (`lib/stack.ts`). |
| `STACK_SUPER_SECRET_ADMIN_KEY` | Optional | Only used by `scripts/set-stack-account-linking.ts` to read/set the OAuth account-merge strategy via `StackAdminApp`; without it the script prints manual instructions instead. |
| `NEXT_PUBLIC_APP_URL` | Yes | Base URL for OAuth callbacks (`lib/stack.ts`) and share links (`lib/imessage-share.ts`). |
| `NEXT_PUBLIC_SITE_URL` | Optional fallback | `lib/imessage-share.ts` falls back to this only if `NEXT_PUBLIC_APP_URL` is unset; not in `.env.local.example`. |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | Required for web push | `lib/push.ts`; without both, web push sends are skipped (logged once, not fatal). |
| `VAPID_SUBJECT` | Optional | Defaults to `mailto:admin@wagerpals.com` in `lib/push.ts`. |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Required for cash payments | `app/api/webhooks/stripe/route.ts` refuses to process without both (500 if the webhook secret is missing, since verifying against an empty secret isn't a real check). |
| `STRIPE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Required for cash payments (client) | Stripe Elements on the client. |
| `APPLE_TEAM_ID`, `IOS_BUNDLE_IDENTIFIER` | Required for iOS universal links | Used to generate the `apple-app-site-association` response. |
| `IMESSAGE_SHARE_SECRET` | Required for the iMessage extension | `lib/imessage-share.ts` HMAC-signs share tokens; if unset, share tokens are disabled (warned once, not fatal) and only existing group members can act on a shared wager. |
| `TEST_ADMIN_POSTGRES_URL` | Optional, test-only | `scripts/test-auth-consolidation.ts` / `scripts/test-sync-user.ts`-style throwaway-DB tests use this instead of `POSTGRES_URL` when creating a scratch database on a different server (e.g. local Postgres). |

### Mobile (`mobile/.env`)

| Variable | Required | Notes |
|---|---|---|
| `EXPO_PUBLIC_API_URL` | Yes | Base URL for the backend (`mobile/src/services/auth.ts`, `api.ts`); defaults to `http://localhost:3000` in dev or `https://wagerpals.io` otherwise if unset. |
| `EXPO_PUBLIC_STACK_PROJECT_ID`, `EXPO_PUBLIC_STACK_PUBLISHABLE_KEY` | Listed in `mobile/.env.example` | **Not found referenced anywhere under `mobile/src`** in this checkout — mobile auth goes through the web app's Stack Auth-backed endpoints (`app/api/auth/mobile-*`) over `EXPO_PUBLIC_API_URL`, not a direct on-device Stack Auth SDK. Treat as currently unused/vestigial; verify before relying on them. |
| `EXPO_PUBLIC_EAS_PROJECT_ID` | Optional | `mobile/src/services/notifications.ts` falls back to `Constants.expoConfig.extra.eas.projectId` / `Constants.easConfig.projectId` if unset. |
| `EXPO_PUBLIC_AUTH0_DOMAIN`, `EXPO_PUBLIC_AUTH0_CLIENT_ID` | Present in `mobile/eas.json` build profiles and `mobile/app.json` `extra`, **not** in `mobile/.env.example`, **not** referenced in `mobile/src` | Appears to be leftover from a discarded Auth0 approach — flagged uncertain, not confirmed live. |

Uncertain items are called out inline above rather than asserted as fact.

## 5. Architecture overview

**Web request path**: browser → Next.js route (`app/**/page.tsx` for pages, or
`app/api/<name>/route.ts` for API routes) → for authenticated routes, `lib/auth.ts` resolves
the caller (see §8) → route handler calls into `lib/db.ts` (reads/writes) and/or
`lib/payments.ts` (money-moving actions) and/or `lib/push.ts` (notifications) → Postgres via
`@vercel/postgres`.

**Mobile request path**: `mobile/src/screens/*` → `mobile/src/services/api.ts` (HTTP client,
attaches `Authorization: Bearer <access token>` from `mobile/src/services/auth.ts` /
`shared-session.ts`) → same Next.js API routes as web, over `EXPO_PUBLIC_API_URL` → same
`lib/auth.ts` → `lib/db.ts`/`lib/payments.ts`/`lib/push.ts`. The iMessage extension's Swift
code (`mobile/plugins/imessage-extension/swift/WagerAPI.swift`) also talks to the same API,
authenticated via signed share tokens from `lib/imessage-share.ts` rather than a Stack Auth
session (see `app/api/imessage/*/route.ts`).

**Auth resolution**: `lib/auth.ts` (`getAuthenticatedStackUser` / `getAuthenticatedUserId` /
`requireAuth` / `requireAuthUser`) is the only place identity is resolved, from a live Stack
Auth session — see §8 for the security invariant this enforces. `lib/sync-user.ts`
(`syncUser`) is the single path that turns that resolved identity into a `users` row (create
or refresh), called from `POST /api/users`.

**Money**: all wallet/escrow/settlement logic lives in `lib/payments.ts`
(`placeCashBet`, `settleCashEvent`, `reverseCashSettlement`, `creditStripeDeposit`,
`failStripeDeposit`, `withdrawFromWallet`, `getWalletSummary`). The Stripe webhook
(`app/api/webhooks/stripe/route.ts`) is the only caller of `creditStripeDeposit` /
`failStripeDeposit`.

**Notifications**: `lib/push.ts` is the single module for deciding *and* sending pushes —
see §8 for the enforced filter pipeline. It supports both web push (VAPID/`web-push`) and
Expo push (mobile), picking exactly one device per recipient.

**Design tokens**: defined once as CSS custom properties in `app/globals.css` (`:root`) —
a legacy layer (`--bg`, `--brand-1/2/3`, `--neon-*`) and a canonical layer (`--color-surface`,
`--color-border`, `--color-text`, `--color-accent`, `--color-yes/no/win/loss/pending/info`,
`--text-*`/`--leading-*`, `--space-*`, `--radius-*`, `--shadow-elev-*`, `--duration-*`,
`--ease-*`). `tailwind.config.ts` maps both layers into Tailwind theme keys (e.g.
`bg-surface`, `text-ink`, `border-hairline`, `rounded-card`, `shadow-elev-2`,
`duration-fast`). `mobile/src/theme.ts` mirrors the same canonical token names for React
Native (documented in that file as required to change in lockstep with `globals.css`).

## 6. Verification scripts

All are run with `npx tsx scripts/<file>.ts` or their `npm run` alias. "Needs live DB" means
it requires `POSTGRES_URL` (and in two cases, permission to `CREATE DATABASE`) in `.env.local`.

| Script | npm alias | Proves | Needs live DB? |
|---|---|---|---|
| `scripts/verify-payments.ts` | `verify:payments` | Drives the real `app/api/bets`, `app/api/events/*`, `app/api/wallet`, `app/api/webhooks/stripe` route handlers against the shared Neon dev database; every write is tagged with a run prefix and cleaned up. Proves the money engine's idempotency/correctness for real. | Yes (shared dev DB) |
| `scripts/verify-notifications.ts` | `verify:notifications` | Drives real `lib/push.ts` functions against an in-memory fake of `lib/db` and a recording `PushTransport` (no sockets). Proves the filter pipeline: subject suppression, mutes, preferences, dedupe, actor exclusion, audience scoping, pruning, Expo batching. | No |
| `scripts/verify-imessage.ts` | `verify:imessage` | Drives the real `app/api/imessage/*` and `app/api/events/preview` route handlers with `lib/db`/`lib/auth`/`lib/sync-user`/`lib/push`/`lib/payments` swapped for in-memory fakes via `require.cache` pre-population. Proves the share-token compose/take-a-side flow. | No |
| `scripts/verify-comments.ts` | `verify:comments` | Pure function tests of `lib/comments.ts` (validation, mention parsing, threading, rate limiting) — no I/O at all. | No |
| `scripts/verify-escrow-chips.ts` | `verify:escrow-chips` | Drives the real `GET /api/events` handler and `lib/payments.ts` against the shared Neon dev database, then server-renders the real `Ledger` component, to prove escrow chips are shown for every bettor, not just the viewer. | Yes (shared dev DB) |
| `scripts/verify-constraint-status.ts` | `verify:constraints` | Proves `constraintStatus()` in `scripts/migrate-comeback.ts` is table-scoped (not just constraint-name-scoped) using throwaway `zz_probe_*` objects, dropped in a `finally`. | Yes |
| `scripts/verify-groups-auth.ts` | `verify:groups-auth` | Drives the real `GET /api/groups` and `GET /api/groups/members` handlers against the **real** `lib/auth.ts` — only Stack Auth itself is stubbed (`scripts/testing/stack-auth-stub.ts`, via the same `module.registerHooks` redirect `test:auth` uses), with `lib/db`/`lib/push` faked in memory. Proves a group's roster, pending-join queue and admin/resolver info reach only an authenticated **active member of that group**, that `?public=true` stays anonymous, and that `?userId=` cannot name anyone but the caller. | No |
| `scripts/verify-users-auth.ts` | `verify:users-auth` | Drives the real `GET /api/users` handler against the **real** `lib/auth.ts` — only Stack Auth itself is stubbed (`scripts/testing/stack-auth-stub.ts`, same `module.registerHooks` redirect as `verify:groups-auth`), with `lib/db` faked in memory. Proves the no-params user directory is 401 for an anonymous caller (and that the gate runs *before* `db.users.getAll()`), while `?id=<self>`, `?id=<other>` and `?username=` keep their existing shapes. | No |
| `scripts/verify-comeback.ts` | `db:verify` | Structural + functional proof that the comeback migration landed; read-only (write checks roll back). | Yes |
| `scripts/check-identity.ts` | `identity:check` | Part A (no DB): the forged `x-stack-user-id` header does not authenticate, unauthenticated requests get a clean 401 before touching the DB. Part B (needs DB): scans for duplicate emails, missing emails, broken tombstones, dangling FK references to tombstoned users. | Part A: No. Part B: skipped with a message if `POSTGRES_URL` is unset (does not fail). |
| `scripts/test-sync-user.ts` | `test:sync-user` | Integration test of `lib/sync-user.ts` against an in-memory mirror of the `users` table's real constraints. | No |
| `scripts/test-auth-consolidation.ts` | `test:auth` | End-to-end identity test driving the real `app/api/users` route handlers with only Stack Auth itself stubbed (`scripts/testing/stack-auth-stub.ts`); creates and drops its own throwaway `wagerpals_authtest_*` database. | Yes — needs `POSTGRES_URL` with `CREATE DATABASE` permission (or `TEST_ADMIN_POSTGRES_URL` pointed at a server that has it). Also needs Node 22.15+ per the script's own header comment (not independently verified here). |

`identity:backfill` (`scripts/backfill-user-emails.ts`) and `stack:link-accounts`
(`scripts/set-stack-account-linking.ts`) are one-off operator tools, not verification
scripts — both need `POSTGRES_URL` / Stack Auth credentials and support `--apply` /
dry-run the same way `users:merge` does.

## 7. File ownership conventions

- Postgres is reached **only** through `lib/db.ts` (application tables) — `lib/payments.ts`
  is the one documented exception, and it says why in its own header comment: it needs its
  own `tx.sql` statements inside `withTransaction`, and `lib/db.ts`'s row mappers aren't
  exported. Scripts under `scripts/` also issue raw SQL directly (they run outside the app).
- API routes: `app/api/<name>/route.ts` (Next.js route handler convention).
- Mobile screens: `mobile/src/screens/*.tsx`, wired up via `mobile/src/screens/index.ts` and
  `mobile/src/navigation/`.
- Shared web components: `components/*.tsx`.
- Isomorphic (server + client) logic that must stay framework-free: `lib/comments.ts` is the
  existing example — no `server-only`, no `next/*`, no `@/lib/db`, no Node builtins, no React.

## 8. INVARIANTS future work must not break

### Money idempotency

Settlement, deposits, and withdrawals must be idempotent — a retried request or a redelivered
Stripe webhook event must never double-credit a wallet. The actual mechanism, read directly
from `lib/payments.ts` and `app/api/webhooks/stripe/route.ts`:

- `transactions.idempotency_key` has a **partial UNIQUE index**
  (`idx_transactions_idempotency_key`, `lib/schema.sql`) — enforced by Postgres itself, not
  just application logic. Every money-moving insert uses
  `INSERT ... ON CONFLICT (idempotency_key) DO NOTHING` and only credits the wallet if a row
  was actually returned.
- Debits use a **guarded state transition**, not read-then-write:
  `UPDATE wallets SET balance = balance - $amount WHERE user_id = $id AND balance >= $amount`
  — a concurrent debit that wins the race makes the loser's `UPDATE` affect zero rows, which
  is detected and turned into `INSUFFICIENT_FUNDS` rather than allowing the balance to go
  negative.
- The Stripe webhook route verifies the signature (`stripe.webhooks.constructEvent`) before
  any database access, and `creditStripeDeposit` keys its idempotency check off
  `stripe:<event.id>` — a redelivered webhook event credits at most once. It never returns
  200 on an internal error (that would make Stripe stop retrying and silently lose a real
  deposit).
- Settlement (`settleCashEvent`) stamps every generated key with a monotonically increasing
  per-event "generation" number so a resolve → unresolve (`reverseCashSettlement`) → resolve
  cycle can't collide with the first settlement's now-stale keys and silently no-op a second
  payout.

Proven by `npm run verify:payments` (`scripts/verify-payments.ts`), which drives the real
route handlers against a live database — **needs `POSTGRES_URL`**.

### Single canonical user sync

One human, one `users` row. Identity is resolved **exclusively** from a verified Stack Auth
session by `lib/auth.ts` — via `Authorization: Bearer <token>` (mobile), the Stack Auth
`x-stack-auth` header/cookie mechanism, or the web cookie session.

**The `x-stack-user-id` request header must never again be trusted as proof of identity.**
It was a forged-identity vulnerability: earlier code accepted this client-supplied header as
the caller's identity, which meant anyone could act as any user by setting it. `lib/auth.ts`'s
resolution chain does not read this header at all, at any point. `npm run identity:check`
(`scripts/check-identity.ts`) is the regression test: it statically asserts `lib/auth.ts`
never references the string `x-stack-user-id`, and it asserts a request carrying a forged
`x-stack-user-id` header resolves to `null` identity and gets a 401 from `POST /api/users`
even when the request body also names the victim. This check runs without a database and
must keep passing.

`lib/sync-user.ts`'s `syncUser()` is the single canonical path from a resolved identity to a
`users` row (create or refresh) — both web and mobile funnel through it via `POST
/api/users`. `scripts/merge-duplicate-users.ts` (§3) is the recovery tool for rows that
already split into duplicates before this was fixed.

### Group membership is the read boundary

A group's **roster, pending-join queue, and admin/resolver identities** are only ever
returned to an authenticated caller with an `active` membership row **in that group**. The
two endpoints that can disclose them — `GET /api/groups?id=` and
`GET /api/groups/members?groupId=` — both call `requireAuth` before touching the database
and then check the caller's own membership row.

- Auth is checked **before** the group is looked up, so an anonymous caller can't use the
  404-vs-200 difference to enumerate the 6-digit group id space.
- An authenticated non-member (including someone whose join request is still `pending`) gets
  an **invite preview** from `?id=`: `name`, `is_public`, `member_count`/`admin_count`, and
  `viewer_status` — their own membership state, so the join page can tell them where they
  stand. Never `members`, `pending_requests`, `resolver`, `created_by` or `resolver_user_id`.
  `GET /api/groups/members` has no preview mode at all: a non-member gets 403.
- `GET /api/groups?public=true` is the one deliberately anonymous read — it lists public
  groups with counts only, never rosters. Do not add member data to it.
- `?userId=` must equal the caller (`verifyUserMatch`, 403 otherwise); omitting it derives the
  caller from the session. Never re-add a code path where a query param names whose data to
  return — that's the same class of bug as the `x-stack-user-id` header above.

Proven by `npm run verify:groups-auth` (`scripts/verify-groups-auth.ts`) — no database
required, and it drives the real `lib/auth.ts` (only Stack Auth is stubbed).

### The user directory is never anonymous

`GET /api/users` with **no query params** returns every row on the platform
(`db.users.getAll()`). That is a bulk scrape of the whole member list — username,
display_name, avatar_url, net_total, streak — so the handler calls `requireAuth` before it
touches the database and returns 401 to an anonymous caller. Auth is checked **first** so an
anonymous request can't learn the user count or infer anything from timing either.

- The two lookup branches are deliberately narrower and unchanged: `?id=` returns the
  caller's own full row when the session matches, otherwise the redacted `toPublicUser`
  shape; `?username=` returns the redacted shape. They resolve one named row at a time,
  not the directory.
- `toPublicUser()` is what keeps `email`, `auth_methods`, `merged_into` and `last_seen_at`
  out of every response except a caller reading their own row. Do not widen it.

Proven by `npm run verify:users-auth` (`scripts/verify-users-auth.ts`) — no database
required, and it drives the real `lib/auth.ts` (only Stack Auth is stubbed).

### The central notification filter

Every push must go through `notifyUsers()` in `lib/push.ts` — its own header comment states
this explicitly: "Nothing else in the codebase may send a push." Confirmed by grep: no file
other than `lib/push.ts` calls `webpush.sendNotification` or hits the Expo push HTTP
endpoint. `notifyEventAudience()` (resolves the audience to a group's active members) and
`sendPushToUser()` are both thin wrappers around `notifyUsers()`, not independent senders.

`notifyUsers()` enforces, in order: dedupe, explicit excludes (e.g. don't notify the actor),
event-scoped mutes (`event_notification_mutes` **and** an independent re-check of
`events.notify_subject`/`subject_user_id` directly off the event row — belt-and-braces
against the mute row ever being skipped), per-user notification preferences
(`notification_preferences`, category-aware, defaulting to fully enabled if no row exists),
and finally picks exactly one device per surviving recipient (newest Expo token, else newest
web subscription) so a user with multiple devices/tabs is never double-notified.

**No call site may broadcast to all subscribers or bypass this filter.** Proven by `npm run
verify:notifications` (`scripts/verify-notifications.ts`) — no database required.

### Tokens-only styling

No new raw hex colors or ad-hoc spacing/radius/shadow values in components. Design tokens are
defined once, as CSS custom properties, in `app/globals.css` `:root` (see §5), consumed via
the Tailwind theme keys `tailwind.config.ts` maps onto those variables (`bg-surface`,
`text-ink`, `border-hairline`, `rounded-card`, `shadow-elev-*`, `space-*`, etc.), and via
`mobile/src/theme.ts`'s mirrored token object on React Native. A grep for literal hex codes
in `components/` and `app/` at the time of writing turns up only a small number of
comment-justified exceptions — e.g. `components/Logo.tsx` explicitly notes `#f59e0b` has no
token yet, `app/auth/signin/page.tsx` uses Google's fixed brand colors for the "G" logo, and
`app/profile/page.tsx` passes literal hex into Stripe Elements' `appearance` option (a
third-party API that only accepts literal color strings, not CSS variables). Any new raw
color/spacing value in a component should be treated as a bug unless it's a similarly
narrow, documented exception.

## Verification notes

Every `npm run <script>` command above was checked against `package.json` /
`mobile/package.json` and every referenced script file was confirmed to exist on disk. Items
flagged uncertain in this document (not asserted as fact) are:
- Whether `EXPO_PUBLIC_STACK_PROJECT_ID` / `EXPO_PUBLIC_STACK_PUBLISHABLE_KEY` /
  `EXPO_PUBLIC_AUTH0_DOMAIN` / `EXPO_PUBLIC_AUTH0_CLIENT_ID` are actually consumed anywhere
  at runtime (grep found no reference under `mobile/src`).
- The exact toolchain requirements for `mobile/package.json`'s `beta` / `build:ios` scripts
  (Fastlane/Xcode/Apple credentials) — not exercised.
- `scripts/test-auth-consolidation.ts`'s stated "Node 22.15+" requirement — taken from the
  script's own comment, not independently verified against actual `CREATE DATABASE` behavior
  on older Node versions.
