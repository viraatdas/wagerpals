# WagerPals

[![Uptime Status](https://img.shields.io/badge/status-live-brightgreen)](https://stats.uptimerobot.com/DLPMolyHJj)
[![Website](https://img.shields.io/website?url=https%3A%2F%2Fwww.wagerpals.io)](https://www.wagerpals.io)

**[📊 View Status Page](https://stats.uptimerobot.com/DLPMolyHJj)** | **[🌐 Visit WagerPals](https://www.wagerpals.io)**

WagerPals is a social betting app: friends form groups, create events (predictions/bets
among the group), and settle them for bragging rights or real money. The repo has two apps
that share one backend:

```
app/          Next.js 14 App Router web app + API routes
components/   Shared web components
lib/          Backend logic, database access, types (shared by app/ and scripts/)
scripts/      Database migrations and verification scripts
mobile/       Expo/React Native iOS app, including a native iMessage Messages App Extension
public/       Static web assets
```

For architecture detail, environment variable reference, the invariants this codebase
depends on (money idempotency, identity resolution, notification filtering, design tokens),
and a full verification-script table, see [`CLAUDE.md`](./CLAUDE.md). This file covers
day-to-day setup, running, and troubleshooting.

## Quick start — web

```bash
npm install
cp .env.local.example .env.local   # fill in real values, see "Environment setup" below
npm run dev
```

Visit http://localhost:3000. `npm run build` / `npm run start` / `npm run lint` are the
standard Next.js build/start/lint commands.

## Quick start — mobile

```bash
cd mobile
npm install
cp .env.example .env               # fill in real values
npm start                          # expo start
```

Then press `i` for the iOS Simulator, or scan the QR code with Expo Go. The mobile app talks
to the same backend as the web app over `EXPO_PUBLIC_API_URL` — point it at your local
`npm run dev` server (`http://localhost:3000`, or your machine's LAN IP if testing on a
physical device) or at a deployed backend.

Other mobile commands (see `mobile/package.json`): `npm run android` / `npm run ios` (native
builds via `expo run:*`), `npm run web` (`expo start --web`), `npm run prebuild` (regenerates
`mobile/ios/`, including the native iMessage extension target — there is no committed `ios/`
directory, it's generated). `npm run beta` / `npm run build:ios` invoke Fastlane and require
`mobile/ios/` to already exist plus a working Fastlane/Apple credentials setup.

## Database & migrations

`lib/schema.sql` is the target schema for a brand-new database:

```bash
psql "$POSTGRES_URL" -f lib/schema.sql
```

To bring an **existing** database up to date instead, run the comeback migration:

```bash
npm run db:migrate   # additive and idempotent — safe to re-run
npm run db:verify    # read-only; asserts every column/table/index/constraint landed; exits non-zero if not
```

`db:verify` is safe to use as a deploy gate. Two data conditions can block individual
migration steps without aborting the run (duplicate emails differing only by case; existing
`transactions.type` values outside the allowed set) — the migration reports which steps were
blocked and why; fix the data and re-run.

There are older, narrower scripts (`db:init`, `db:clean`, `db:migrate-mobile`,
`db:migrate-wallet`) still present for compatibility — they predate `lib/schema.sql` and do
**not** create/drop the full current schema. Don't use them to bootstrap a fresh database;
see `CLAUDE.md` §3 for exactly what each one does and doesn't touch.

If duplicate `users` rows exist for the same person (e.g. one signed up with
email/password and again with Google before account linking was fixed), reconcile them with:

```bash
npx tsx scripts/merge-duplicate-users.ts            # dry run — prints the plan only
npx tsx scripts/merge-duplicate-users.ts --apply    # execute
```

Both require `POSTGRES_URL` in `.env.local`.

## Environment setup

Copy the example files and fill in real values:
- Web: `.env.local.example` → `.env.local`
- Mobile: `mobile/.env.example` → `mobile/.env`

At minimum, the web app needs a Postgres connection (`POSTGRES_URL`), Stack Auth credentials
(`NEXT_PUBLIC_STACK_PROJECT_ID`, `NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY`,
`STACK_SECRET_SERVER_KEY`), and `NEXT_PUBLIC_APP_URL`. Stripe (`STRIPE_SECRET_KEY`,
`STRIPE_WEBHOOK_SECRET`, `STRIPE_PUBLISHABLE_KEY`) is required for cash/real-money betting to
work; web push (`NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`) is required for browser
push notifications; `IMESSAGE_SHARE_SECRET` is required for the iMessage extension's share
links. The mobile app mainly needs `EXPO_PUBLIC_API_URL` pointed at your backend.

See `CLAUDE.md` §4 for the complete, per-variable required/optional breakdown, including a
couple of variables present in `mobile/.env.example` that don't currently appear to be read
anywhere in `mobile/src` — flagged there rather than silently omitted.

## Testing & verification

Everything runs via `tsx`, no test runner framework is configured. Highlights:

```bash
npm run identity:check        # forged x-stack-user-id header must not authenticate (no DB needed for this part)
npm run test:auth             # full identity/account-consolidation test, creates+drops a throwaway DB
npm run verify:payments       # drives the real payment routes against the shared dev DB
npm run verify:notifications  # proves the push filter pipeline, no DB/network needed
npm run verify:comments       # pure function tests for lib/comments.ts, no DB/network needed
npm run verify:imessage       # drives the real iMessage routes with in-memory fakes, no DB needed
npm run verify:escrow-chips   # drives the real event/ledger rendering against the shared dev DB
npm run verify:constraints    # proves the migration's constraint lookup is table-scoped
npm run db:verify             # structural/functional proof the comeback migration landed
```

Scripts marked "against the shared dev DB" or "throwaway DB" need `POSTGRES_URL` set in
`.env.local` (the throwaway-DB ones also need permission to `CREATE DATABASE`, or set
`TEST_ADMIN_POSTGRES_URL`). See `CLAUDE.md` §6 for the full table, including exactly what
each script proves.

## Deployment

**Web** — Vercel. `vercel.json` at the repo root sets the Next.js build/dev/install commands
and output directory explicitly. `vercel --prod` from the repo root, or connect the repo in
the Vercel dashboard. Set all required env vars (§ above) in the Vercel project settings —
`.env.local` is never deployed.

**Mobile** — EAS. `eas.json` (repo root) and `mobile/eas.json` both define build profiles
(`development`, `preview`, `production`); `mobile/eas.json`'s `production`/`preview`
profiles set `EXPO_PUBLIC_API_URL=https://wagerpals.io` and `submit.production.ios` targets
App Store Connect (`ascAppId`, `appleTeamId` are already filled in). From `mobile/`:

```bash
eas build --platform ios --profile production
eas submit --platform ios --profile production
```

The iMessage extension is bundled into the same iOS build via the Expo config plugin
declared in `mobile/app.json` (`./plugins/imessage-extension/withIMessageExtension`) — no
separate build step.

## Troubleshooting

**Database schema looks wrong / migration didn't apply everything** — run `npm run db:verify`;
it lists exactly what's missing. If it reports blocked steps, see the "Database & migrations"
section above for the two known blocking conditions.

**Duplicate accounts for the same person** — run `npx tsx scripts/merge-duplicate-users.ts`
(dry run first) and/or `npm run identity:check` to check for duplicate emails and broken
tombstones.

**Push notifications not arriving** — for web, confirm `NEXT_PUBLIC_VAPID_PUBLIC_KEY` and
`VAPID_PRIVATE_KEY` are both set (missing either silently disables web push, logged once in
server logs); for mobile, confirm the device has a registered Expo push token. `npm run
verify:notifications` proves the filter/dispatch logic itself is correct without needing a
real device.

**iMessage extension links don't open the app / can't take a side from the bubble** —
confirm `IMESSAGE_SHARE_SECRET` is set on the backend; without it, share tokens aren't
minted and only existing group members can act on a shared wager.

**Mobile build issues** — clear the Expo cache (`expo start -c`), reinstall
(`cd mobile && rm -rf node_modules && npm install`), and re-run `npm run prebuild` before a
native build if `mobile/ios/` is stale or missing.

## License

Private - All Rights Reserved
