# Identity: one human, one WagerPals account

This is the operator-facing doc for how WagerPals identity works, what changed to make
"sign up with email/password" and "sign in with Google" collapse onto a single account,
and how to run/verify the fix.

## The model

- **One human = one Stack Auth account = one `users` row**, keyed by the Stack Auth user
  id (`users.id`). Every authenticated request resolves to a Stack Auth id first; the
  local `users` row is looked up (and lazily created/refreshed) from that id, never from
  anything a client can spoof.
- **`users.email` holds the lowercased, verified primary email** — and only that. An
  unverified email is never written here, because identity consolidation depends on
  email being trustworthy: if an unverified address could claim a row, anyone who typed
  in someone else's email could ride in on their account. The column is protected by
  `idx_users_email_lower`, a `UNIQUE INDEX ON users(LOWER(email)) WHERE email IS NOT
  NULL` (see `lib/schema.sql` / the `migrate-comeback` migration) — two live rows can
  never hold the same email; the database enforces it, not just application code.
- **`users.auth_methods`** (`JSONB NOT NULL DEFAULT '[]'`) is the append-only record of
  *how* that human can sign in — one entry per provider (`password`, `google`, `apple`,
  `passkey`, `stack` for Stack's own OTP/magic-link, `other`), each with an `identifier`
  and a `linked_at` timestamp. It's populated by `lib/sync-user.ts`'s `syncUser()` from
  the Stack Auth user object (`hasPassword`, `oauthProviders`, `passkeyAuthEnabled`,
  `otpAuthEnabled`) and is additive: existing entries are never dropped or overwritten,
  only merged with newly-observed ones (deduped on `provider`+`identifier`).
- **`users.merged_into`** is the tombstone pointer used when two rows are later found to
  represent the same human (e.g. a legacy pre-Stack row and a Stack Auth row that turned
  out to share an email) — see `scripts/merge-duplicate-users.ts`. A tombstoned row is
  excluded from `db.users.getAll()` (leaderboards, listings) but still resolvable by id,
  and must never hold a live `email` or be referenced by `bets`/`comments`/
  `group_members`/`wallets`/`transactions` — `scripts/check-identity.ts` asserts this.

None of this works, though, unless Stack Auth itself is configured to put both sign-in
methods on the *same* Stack Auth account in the first place. That's the next section.

## Required manual step: the Stack Auth dashboard setting

**This must be set by hand in the Stack Auth dashboard** (or via
`npm run stack:link-accounts -- --apply`, see below) — it is not something the
application code can control at request time.

1. Go to the [Stack Auth dashboard](https://app.stack-auth.com) and open this project.
2. Find the auth / sign-in configuration section for the project.
3. Set **OAuth account merge strategy** (`oauthAccountMergeStrategy`) to **`link_method`**.

The three possible values:

| Value | Behavior |
|---|---|
| `link_method` (**required for this task**) | When an OAuth sign-in (e.g. Google) presents a **verified** email that matches an existing account's email, it is linked onto that existing account instead of creating a new one. This is what makes "one human, one account" possible — email/password sign-up and Google sign-in for the same verified address land on one Stack Auth account, which means one `users` row. |
| `raise_error` | The OAuth sign-in is rejected outright if the email matches an existing account. Safer than `allow_duplicates` but a worse user experience — the human gets stuck rather than linked. |
| `allow_duplicates` | A **new, separate** Stack Auth account is created even when the email matches an existing one. **This is the setting that produces two accounts for one human** — the exact bug this task exists to clean up. If the project is currently on this setting, flipping it to `link_method` stops new duplicates; it does not retroactively merge ones that already exist (run the runbook below for that). |

Also confirm, while you're in the dashboard:

- **Google is configured to return verified emails.** WagerPals only trusts
  `primaryEmailVerified: true` — if Google sign-in can hand back an unverified or
  unconfirmed email, this whole model breaks.
- **The project's email-verification requirement is enabled** for password sign-up too.
  An unverified email must never be able to claim an existing account, which is
  precisely why `lib/sync-user.ts` and `scripts/backfill-user-emails.ts` both refuse to
  write `users.email` unless `primaryEmailVerified` is `true`.

Once `STACK_SUPER_SECRET_ADMIN_KEY` is available in the environment, the setting can
also be read and applied programmatically:

```bash
npm run stack:link-accounts              # prints the current value
npm run stack:link-accounts -- --apply   # sets it to link_method (idempotent)
```

`scripts/set-stack-account-linking.ts` prints these same manual instructions and exits
`0` (not an error) when `STACK_SUPER_SECRET_ADMIN_KEY` isn't set — plenty of deployments
will only ever flip this by hand, and that's fine.

## What changed in the code

- **`lib/sync-user.ts` — `syncUser(stackUser, opts)`** is now the single canonical path
  that creates or refreshes a `users` row from an authenticated Stack Auth session. It:
  - only ever writes a *verified* email, and only when no other row already owns it
    (checked via `db.users.getByEmail`, which also sees tombstoned rows so a merged
    account's email can't be handed to a different human);
  - merges `auth_methods` rather than overwriting them, so signing in a second way
    (e.g. adding Google after signing up with a password) adds to the same row's
    provider list instead of creating a new row;
  - fills `display_name`/`avatar_url` only when the row doesn't already have them.
  Both the web app and the mobile app funnel through this one function via
  `POST /api/users`.
- **`POST /api/users` now requires authentication.** `app/api/users/route.ts` calls
  `requireAuthUser(request)` first, before touching the body or the database: an
  unauthenticated request gets `401 { error: 'Authentication required' }` and never
  reaches `syncUser`/the database. Before this, the route trusted a client-supplied `id`
  in the request body with no verification — an unauthenticated caller could create or
  rename an arbitrary user by simply POSTing `{ id: '<victim-id>', username: '<new
  name>' }`. `scripts/check-identity.ts` Part A is the regression test for exactly this.
  A caller-supplied `id` that doesn't match the authenticated session's id now gets a
  `403` via `verifyUserMatch`.
- **The forgeable `x-stack-user-id` header fallback has been removed from `lib/auth.ts`.**
  `requireAuth`/`getAuthenticatedUserId` now resolve identity only from an
  `Authorization: Bearer <token>` header (the mobile app's path), an `x-stack-auth`
  header, or the Stack Auth cookie session (the web app's path) — never from a header a
  client can set to any value it likes. Every other authenticated route —
  `app/api/bets`, `app/api/comments`, `app/api/events` (+ `resolve`/`unresolve`),
  `app/api/groups` (+ `join`/`members`), `app/api/wallet` — calls `requireAuth()`, so
  this closes the same class of hole app-wide, not just on `/api/users`. `scripts/
  check-identity.ts` Assert 4/5/6 are the regression tests for this specifically (see
  below) — Assert 6 statically confirms `lib/auth.ts` never references the header string
  at all, not just that it's unused.
- **Two dead code paths whose only purpose was that forgeable header have been deleted:**
  `lib/api-client.ts` (a `createAuthFetch` helper that injected `x-stack-user-id` —
  nothing imported it) and the `app/api/auth/mobile-callback/route.ts` +
  `app/auth/mobile-callback/page.tsx` pair.

## What the runnable check does and does not prove

`npm run identity:check` (`scripts/check-identity.ts`) is designed to run under `tsx`,
outside a running Next.js server — no `next dev`, no deployed app. That's deliberate
(it's meant to be runnable in CI or by hand with nothing set up), but it means Part A's
assertions prove a narrower thing than "auth works end-to-end":

- `lib/stack.ts` has `import "server-only"`, which **throws** when the module is loaded
  outside a proper Next.js/webpack bundle — which is exactly what happens under `tsx`.
  `lib/auth.ts` catches that throw and fails closed to "unauthenticated". So every 401
  Part A observes (Asserts 1, 3, 5) arrives via that fail-closed path — **Stack Auth
  itself is never actually contacted** in this script.
- What that *does* still prove, and it's the thing that actually matters: **auth is
  evaluated, and the request is rejected, before the database is ever touched.** The
  pre-fix code touched the database first; a live Postgres connection with no real query
  guard would have surfaced as a 500 or a raw Postgres error, not a clean 401 — which is
  exactly why Asserts 1/3/5 treat an observed 500 as an explicit FAIL, not a pass.
- **Assert 4 is the one exception that doesn't depend on that fail-closed path at all.**
  It proves the `x-stack-user-id` header is never consulted as an identity source in the
  first place (`getAuthenticatedUserId()` returns `null` for a request whose *only*
  credential is that forged header) — true regardless of whether Stack Auth was
  reachable, because the resolution chain in `lib/auth.ts` simply doesn't read that
  header. Assert 6 backs this up statically by grepping `lib/auth.ts`'s own source.
- **What this script cannot prove:** that a *real, valid* Stack Auth session
  successfully authenticates (200, not 401) and that the cross-user `403` check
  (`verifyUserMatch`) actually fires for a mismatched id. Both require a running app
  with a real Stack Auth bearer token or cookie session — verify those manually or with
  an end-to-end test against a live deployment.

### Known cleanup follow-up: client files still sending the inert header

Assert 6 also greps `app/`, `lib/`, and `components/` for any file still *sending* an
`x-stack-user-id` header — the server ignores it now, so these are dead weight, not a
vulnerability, but worth cleaning up. As of this writing:

```
app/create/page.tsx
app/events/[id]/page.tsx
app/groups/[id]/admin/page.tsx
app/groups/[id]/page.tsx
app/groups/join/[id]/page.tsx
app/page.tsx
app/profile/page.tsx
components/BetForm.tsx
components/CommentForm.tsx
components/Header.tsx
components/Ledger.tsx
```

Re-run `npm run identity:check` for the current list — it's generated at runtime, not
hand-maintained, so it stays accurate as files change.

## Runbook

Run in this order. `npm run` needs a literal `--` before any flag you pass through to
the underlying script (otherwise npm swallows the flag itself):

```bash
npm run identity:check                        # 1. baseline — see where things stand

npm run identity:backfill                      # 2. dry run — see what would be filled in
npm run identity:backfill -- --apply           #    apply it

npm run users:merge                             # 3. dry run — see what duplicate rows exist
npm run users:merge -- --apply                  #    merge them

npm run identity:check                          # 4. confirm: zero duplicates, tombstones clean
```

- `identity:check` (`scripts/check-identity.ts`) has two independent halves: security
  assertions against `POST /api/users` (no database needed, always runs) and database
  consistency checks (duplicate emails, cross-row `auth_methods` collisions, tombstone
  integrity, multi-provider evidence — skipped with a clear message if `POSTGRES_URL`
  isn't set).
- `identity:backfill` (`scripts/backfill-user-emails.ts`) fills `email`/`display_name`/
  `avatar_url`/`auth_methods` on existing rows from Stack Auth. It's the prerequisite for
  `users:merge` finding anything, since merging is keyed on email.
- `users:merge` (`scripts/merge-duplicate-users.ts`) merges rows that turn out to be the
  same human (same email, or an email that shows up as an `auth_methods` identifier on
  one row and as `users.email` on another). Supports `--email <addr>` to scope to one
  address.

All three writing scripts default to a dry run; nothing is written to the database
without an explicit `--apply`.

## Known gaps / follow-ups

- **Legacy rows with no Stack Auth account cannot be backfilled.** Some existing
  `users.id` values predate Stack Auth entirely and were never valid Stack Auth ids
  (Stack Auth ids are UUIDs; some legacy rows have short non-UUID ids, which Stack
  Auth's API rejects with a validation error rather than a "not found"). Both cases are
  treated identically by `identity:backfill` — reported as `unresolvable` — and left
  alone. There is no way to attach an email to these without the human re-authenticating
  through Stack Auth under that same row (which the app doesn't currently support), or a
  manual/support-driven merge.
- **Pre-existing mobile users have `username_selected = false`** even though they
  already chose a username through the mobile app. The cause was the divergent sync path
  this task removed: mobile's old `apiService.createOrUpdateUser(id, username)` posted
  the chosen name *without* `username_selected: true`, so the server stored it with the
  column left at its `false` default, while the web app used that same column to decide
  whether to show the "pick a username" modal. That is the concrete mechanism behind the
  reported "email vs Google users behave differently" bug. It is fixed going forward
  (mobile now calls `apiService.setUsername()`, which sends `username_selected: true`),
  but existing rows are not retroactively corrected — there is no reliable way to tell a
  deliberately-chosen legacy username from an auto-derived one. On the live database at
  the time of writing, 37 of 53 live rows have `username_selected = false`; those humans
  will be prompted to confirm a username once more, and can simply re-enter the name they
  already have. Worth knowing about if support gets "why is it asking me again?" reports.
- **The cross-user `403` on `POST /api/users`** (authenticated as user A, request body
  carries user B's id) is implemented (`verifyUserMatch` in `lib/auth.ts`) but is not
  covered by an automated test here — `scripts/check-identity.ts` can't fabricate a real
  Stack Auth session, so this is a documented gap rather than a faked assertion. Cover it
  with a real end-to-end/integration test if one becomes available.
- **The OAuth account merge strategy dashboard setting is a manual step** (or requires
  `STACK_SUPER_SECRET_ADMIN_KEY` to set programmatically) and isn't verified by
  `identity:check` — there's no way to read it without Stack Auth admin credentials.
  Confirm it's `link_method` in the dashboard directly, or via
  `npm run stack:link-accounts` if the admin key is available.
