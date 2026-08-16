# WagerPals codebase audit

**Produced by:** remedial audit node (re-run of n0, which closed without writing this file)
**Date:** 2026-08-16
**Scope:** whole repo — `app/`, `lib/`, `components/`, `scripts/`, `mobile/`, `public/` (~18.5k LOC, 27 API routes, 14 mobile screens)
**Method:** every file in the four in-scope areas was read in full. Every finding below cites a real `file:line` that was re-verified against the working tree after the finding was written. Nothing here is inferred from docs or commit messages.

## How to use this document

Findings are grouped by the consumer node that owns them. Each finding is:

```
### ID — Title
`file:line` · SEVERITY · category
Evidence + impact.
**Fix:** one line.
```

**Severity:** `CRITICAL` = money loss, account takeover, or data exposure available to any user today · `HIGH` = feature is broken in production or a plausible attack/crash path · `MEDIUM` = wrong behavior under realistic conditions · `LOW` = hygiene, drift, dead weight.

**Categories:** `security` `money` `privacy` `correctness` `crash` `data-model` `ux` `dead-code` `ops`

### Routing table

| Section | Owner node | Findings | CRITICAL | HIGH | MEDIUM | LOW |
|---|---|---|---|---|---|---|
| A. Auth, identity, duplicate accounts | **n2** | A1–A13 | 5 | 4 | 3 | 1 |
| B. Payments, wallet, escrow | **n3** | B1–B14 | 5 | 8 | 1 | 0 |
| C. Notifications & subject privacy | **n4** | C1–C12 | 2 | 6 | 4 | 0 |
| D. Mobile: crashes & ship blockers | **n7** | D1–D13 | 0 | 9 | 4 | 0 |
| E. Cross-cutting (schema, web, infra) | **n1 / n8 / n9** | E1–E10 | 1 | 3 | 4 | 2 |
| **Total** | | **62** | **13** | **30** | **16** | **3** |

### The one finding that touches every node

**A1** (`lib/auth.ts:14`) is the root of the security posture. Every "protected" endpoint — bets, wallet, resolve, group admin — accepts an unverified `x-stack-user-id` header as proof of identity. Until n2 fixes it, none of the authorization checks n3 and n4 build on actually hold. **n3 and n4 should assume A1 is fixed and write their checks against a verified session, not against the header.**

---

## A. Auth, identity, and duplicate accounts → n2

### A1 — Any request can impersonate any user via an unverified header
`lib/auth.ts:14` · **CRITICAL** · security
When no `Authorization: Bearer` token is present, `getAuthenticatedUserId` falls back to trusting the raw `x-stack-user-id` request header and returns it as the authenticated identity. Nothing validates it. `curl -H 'x-stack-user-id: <victim-id>' /api/wallet?userId=<victim-id>` returns the victim's balance and full transaction history; the same header lets you place bets, delete their bets, resolve events, and manage groups as them. The web app depends on this path — `lib/api-client.ts:8` and `app/profile/page.tsx:75` send exactly this header and no token.
**Fix:** delete the header fallback and have the web client send the Stack Auth access token (`user.getAuthJson()`) like mobile does.

### A2 — `POST /api/users` has no authentication at all
`app/api/users/route.ts:34` · **CRITICAL** · security
The route never calls `requireAuth`. Any unauthenticated caller can POST `{id, username}` for an arbitrary user ID and rename that account, or pre-create rows for IDs that do not exist yet.
**Fix:** add `requireAuth` + `verifyUserMatch(authResult.userId, id)` at the top of the handler.

### A3 — `username_selected` is forced to `true` on every insert, killing the username picker
`lib/db.ts:49` · **CRITICAL** · correctness
The insert writes `${user.username_selected || true}` — since `false || true === true`, the column is `TRUE` for every newly created user regardless of what the caller passed. `app/page.tsx:37` gates the username modal on `!userData.username_selected`, so the modal **never shows**. Every user is silently stuck with the auto-derived username from `user.displayName || primaryEmail.split('@')[0]` (`app/page.tsx:85`).
**Fix:** `${user.username_selected ?? false}`.

### A4 — No email on `users`, so email and Google signups can never be merged
`lib/schema.sql:4-12` · **CRITICAL** · data-model
The `users` table has `id, username, username_selected, net_total, total_bet, streak, created_at` — no email, no auth-provider column, no link table. The row is keyed on the Stack Auth user ID. Signing in with `viraat@gmail.com` via magic code and later via Google produces two Stack Auth IDs, therefore two `users` rows, two wallets, two ledgers — with no column that could ever be used to detect the collision. This is the literal cause of the duplicate-account complaint.
**Fix:** add `email TEXT`, `email_normalized TEXT UNIQUE`, and `auth_identities(user_id, provider, provider_user_id)`; backfill from Stack Auth and dedupe on `email_normalized`.

### A5 — Duplicate signup silently creates `username1` instead of surfacing the collision
`app/api/users/route.ts:92-101` · **HIGH** · correctness
When the derived username is taken, the route loops appending `1, 2, 3…` and creates a *new* account under the mangled name. Meanwhile `components/UsernameModal.tsx:55` tells the user "Returning user? Just enter your existing username." A returning user who signs in with a second provider gets `viraat1` and an empty ledger, with no error and no hint that their real account exists.
**Fix:** on collision, look up the existing account by email/identity and link to it instead of minting a suffixed duplicate.

### A6 — Username uniqueness is a TOCTOU race that can 500
`app/api/users/route.ts:94-102` · **MEDIUM** · correctness
The `while (await db.users.getByUsername(...))` loop reads-then-writes with no transaction or unique-violation handling, and after 100 attempts it `break`s and inserts the colliding name anyway (line 97-99), hitting the `username UNIQUE` constraint and returning a raw 500 with `error.message` (line 134).
**Fix:** let the DB arbitrate — catch `23505` on insert and retry, and drop the 100-attempt escape hatch.

### A7 — Mobile writes the OS display name into the ledger instead of the app username
`mobile/src/screens/EventDetailScreen.tsx:135` · **HIGH** · correctness
`username: user.displayName || user.email || 'User'` sends the Stack Auth display name (e.g. `Viraat Das`, or a full email address) as the bet's `username`, which `bets.username` stores verbatim. The web client sends the chosen app username. The same human therefore appears under two different names in the same event ledger depending on which client placed the bet. Same bug at `mobile/src/screens/EventDetailScreen.tsx:166` (comments) and `mobile/src/screens/CreateEventFromInviteScreen.tsx:111` (iMessage bets).
**Fix:** fetch the app `users.username` once on login and use it for every write; better, stop accepting a client-supplied `username` server-side and join on `user_id`.

### A8 — Client-supplied `username` is trusted and denormalized into three tables
`app/api/bets/route.ts:15`, `app/api/comments/route.ts:26`, `lib/schema.sql:55,69,82` · **HIGH** · security
`bets.username`, `comments.username`, and `activities.username` are all written from the request body with no check that they match the authenticated user's actual username. Any authenticated user can post a bet or comment displaying someone else's name. The copies also go stale the moment a user renames.
**Fix:** drop `username` from the request contract, resolve it server-side from `user_id`, and join at read time.

### A9 — Username validation rules differ between web, mobile, and the server
`mobile/src/utils/helpers.ts:40,48` vs `lib/utils.ts:125,134` · **MEDIUM** · correctness
Mobile requires ≥3 chars and allows `-`; the server requires ≥2 and rejects `-` (`/^[a-zA-Z0-9_]+$/`). The mobile setup screen even advertises dashes (`mobile/src/screens/UsernameSetupScreen.tsx:116`) and lets you type them (`mobile/src/screens/UsernameSetupScreen.tsx:94`). Because mobile omits `username_selected`, the server skips validation entirely and runs `sanitizeUsername` instead (`app/api/users/route.ts:43,53`), which strips the dash — so `foo-bar` silently becomes `foobar` with no feedback.
**Fix:** export one validator from a shared module and have both clients and the server call it.

### A10 — Mobile's username setup never marks the username as chosen
`mobile/src/services/api.ts:48-53` · **MEDIUM** · correctness
`createOrUpdateUser` posts only `{id, username}`; it never sends `username_selected: true`. A user who picks a name on iOS is still flagged as not-having-chosen on the server, so the web app would re-prompt them (were the modal not already dead per A3).
**Fix:** add a `usernameSelected` parameter and pass `true` from `UsernameSetupScreen`.

### A11 — Open redirect leaks OAuth tokens to any URL the attacker names
`app/api/auth/mobile-oauth-callback/route.ts:11-22,86-101` · **CRITICAL** · security
`mobileCallbackUrl` is base64-decoded from the attacker-controllable `state` parameter with no scheme or host allowlist, then the freshly minted `access_token` and `refresh_token` are appended to it as query parameters and the user is 302'd there. A crafted state sends a real user's tokens to `https://attacker.example/`. The same pattern exists at `app/api/auth/mobile-session/route.ts:10-17,52-62` via the `callback` query parameter.
**Fix:** allowlist the callback to `wagerpals://` plus the app's own origin, and reject anything else.

### A12 — PKCE is stubbed out in the mobile OAuth exchange
`app/api/auth/mobile-oauth-callback/route.ts:56` · **HIGH** · security
The token exchange sends the literal `code_verifier: 'none'`. No verifier is generated, stored, or checked, so an intercepted authorization code can be redeemed by anyone — the exact attack PKCE exists to stop on a public mobile client.
**Fix:** generate a per-request verifier/challenge pair, keep the verifier server-side keyed by `state`, and send the real value.

### A13 — Three overlapping mobile auth callback routes, one of them dead
`app/api/auth/mobile-callback/route.ts:1-60` · **LOW** · dead-code
`mobile-callback` (POST, code exchange), `mobile-oauth-callback` (GET, code exchange), and `mobile-session` (GET, cookie scrape) all implement variations of the same handoff. Nothing in `mobile/` calls `mobile-callback`; its comment even says "This is a simplified version - you may need to adjust". Three code paths mean three places to get A11/A12 wrong.
**Fix:** delete `mobile-callback`, keep `mobile-oauth-callback` as the single OAuth entry point.

---

## B. Payments, wallet, and escrow → n3

### B1 — A negative bet amount credits the wallet
`app/api/bets/route.ts:33,51,59` · **CRITICAL** · money
`parsedAmount` is never checked for sign. With `amount: -100`: the balance check `wallet.balance < -100` is false, so it passes; `deductBalance` runs `SET balance = balance - (-100) WHERE balance >= -100`, which **adds $100** and reports success; a `bet_placed` transaction for `+100` is recorded. Free money, one request, no special access needed.
**Fix:** reject `!Number.isFinite(parsedAmount) || parsedAmount <= 0` before touching the wallet.

### B2 — Withdrawals delete the money instead of paying it out
`app/api/wallet/route.ts:102-125` · **CRITICAL** · money
The withdraw branch deducts the balance, writes a `withdrawal` transaction with `status: 'completed'`, and returns success. There is no Stripe payout, no Connect transfer, no external call of any kind. The user's balance goes to zero and no money ever leaves the platform.
**Fix:** either create a real Stripe payout and mark the transaction `pending` until the payout webhook confirms, or disable the withdraw action until payouts are built.

### B3 — The Stripe webhook is not idempotent, so retries double-credit
`app/api/webhooks/stripe/route.ts:36-47` · **CRITICAL** · money
On `payment_intent.succeeded` the handler credits the wallet **first** (line 41) and only then looks up the transaction and marks it completed (line 44-47). It never checks whether that transaction is already `completed`. Stripe retries webhooks on any non-2xx or timeout, and events can be delivered more than once by design — each redelivery adds the full deposit amount again.
**Fix:** make the credit conditional on flipping the transaction from `pending` to `completed` in a single guarded UPDATE, and no-op if zero rows changed.

### B4 — Resolve/unresolve/resolve mints unlimited money
`app/api/events/unresolve/route.ts:47-59` · **CRITICAL** · money
`resolve` credits winners' wallets and writes `winnings` transactions (`app/api/events/resolve/route.ts:59-92`). `unresolve` reverses only `users.net_total` and `streak` — it never debits the wallet or reverses the transactions. A group resolver can resolve, unresolve, and resolve again, paying out the full pot on every cycle.
**Fix:** in `unresolve`, reverse the wallet credits and write compensating transactions inside the same operation, and refuse to unresolve if any funds have since been withdrawn.

### B5 — `POST /api/events/delete` has no authentication and destroys escrowed bets
`app/api/events/delete/route.ts:4-20` · **CRITICAL** · security
No `requireAuth`, no admin check, no ownership check. Any anonymous caller can delete any event by ID; `ON DELETE CASCADE` (`lib/schema.sql:53`) takes every bet with it. In a real-money group the wallet deductions for those bets are never refunded — the money is simply gone.
**Fix:** require auth, restrict to the group resolver/admin, refund all outstanding bets, and refuse deletion of events that have real-money bets.

### B6 — "Real money" is inferred from `is_public`, with no per-event payment type
`app/api/bets/route.ts:49`, `app/api/events/resolve/route.ts:25` · **HIGH** · data-model
The only signal distinguishing points from dollars is `group.is_public === false`. `events` has no `payment_type` column (`lib/schema.sql:36-48`) and `bets` has no currency or escrow reference (`:51-62`). Every private group is implicitly a real-money group, and there is no way to run a friendly free bet inside a private group — which is what the product actually needs.
**Fix:** add `events.payment_type ('points'|'cash')` defaulting to the group's mode, and branch on that everywhere instead of `is_public`.

### B7 — Toggling group visibility retroactively changes the currency of open bets
`app/api/groups/route.ts:156-185` · **HIGH** · money
`PATCH /api/groups` lets an admin flip `is_public` at any time. Bets already placed and deducted under private (cash) rules will resolve under public (points) rules, or vice versa — bets placed for free under public rules will pay out real wallet money after a flip to private.
**Fix:** reject `is_public` changes while the group has unresolved events, and pin `payment_type` per event at creation (see B6).

### B8 — Late bets are counted for payout but never funded
`app/api/bets/route.ts:49` vs `lib/utils.ts:13,23` · **HIGH** · money
The wallet deduction is skipped for late bets (`&& !isLate`), yet `calculateNetResults` also excludes late bets from the pot and from payouts (`lib/utils.ts:13,23`). So a late bet is recorded, shown in the ledger and side totals (`app/api/events/route.ts:31-35` explicitly includes late bets in `side_stats`), and displayed to other users as real stake that influences their decision — while contributing nothing and risking nothing.
**Fix:** either reject late bets on cash events outright, or fund and settle them like any other bet.

### B9 — Deleting a bet does not refund the wallet
`app/api/bets/route.ts:142-198` · **HIGH** · money
`DELETE /api/bets` reverses `users.total_bet` and removes the activity row, but never credits the wallet back or reverses the `bet_placed` transaction. On a cash event, deleting your own bet destroys your own stake. There is also no check that the event is still unresolved.
**Fix:** refund the escrowed amount and write a `bet_refund` transaction; reject deletion once the event is resolved.

### B10 — If nobody backed the winning side, the whole pot vanishes
`lib/utils.ts:19,31` · **HIGH** · money
`winningTotal` is 0 when no non-late bet is on the winning side, so the `bet.side === winningSide && winningTotal > 0` branch never fires. Every participant is computed as a pure loser, their stakes were already deducted at bet time, and `resolve` credits nobody. The entire pot is retained by the platform with no record of where it went.
**Fix:** detect `winningTotal === 0` and refund every participant their stake as a push.

### B11 — Payouts are non-transactional and can halt halfway
`app/api/events/resolve/route.ts:48-96` · **HIGH** · money
Winners are paid one at a time in a `for` loop of independent `UPDATE`s, with no transaction and no idempotency key. Any failure or timeout mid-loop (Vercel functions do time out) leaves some users paid and some not, the event still `active`, and a retry double-pays everyone already credited.
**Fix:** wrap the settlement in one DB transaction keyed on `event_id`, and make it a no-op if the event is already resolved.

### B12 — Rounded per-user nets do not have to sum to zero
`lib/utils.ts:41` · **MEDIUM** · money
Each user's net is rounded to cents independently. Across many participants the rounded credits can exceed or fall short of the collected pot by a few cents per resolution, with no balancing entry. In a real-money system that drift is unaccounted-for platform liability.
**Fix:** compute payouts in integer cents and assign the rounding remainder to a single deterministic participant.

### B13 — Bets and transactions cannot be reconciled
`lib/schema.sql:112-121` · **HIGH** · data-model
`transactions` has no `event_id` or `bet_id`, only a free-text `description` like `Bet on "yes" - <title>`. There is no escrow table either — deducted funds are not held anywhere, they just leave the wallet. It is impossible to answer "what is currently escrowed for event X" or "refund the bet this transaction paid for" with a query.
**Fix:** add `transactions.event_id`/`bet_id` FKs and an `escrow` ledger holding stake per event until settlement.

### B14 — Wallet errors never reach the user in the web bet form
`components/BetForm.tsx:40-44` · **HIGH** · ux
The submit handler only acts `if (response.ok)`. The 400 carrying `Insufficient wallet balance. You have $X but need $Y` (`app/api/bets/route.ts:52-55`) is discarded — the form clears its loading state and nothing else happens. Users experience the Place Bet button as silently broken.
**Fix:** parse the error body and surface it via the existing `Toast`.

---

## C. Notifications and subject privacy → n4

### C1 — Every bet, event, and resolution is broadcast to every subscriber on the platform
`lib/push.ts:75-115`, called from `app/api/bets/route.ts:109`, `app/api/events/route.ts:131`, `app/api/events/resolve/route.ts:126`, `app/api/users/route.ts:119` · **CRITICAL** · privacy
`sendPushToAllSubscribers` loads `SELECT * FROM push_subscriptions` with no group, membership, or preference filter. The payload includes the event title, the bettor's name, and the dollar amount: `"viraat bet $50.00 on \"yes\" - Will Dave get fired\"`. Every private group's activity is pushed to every user of the app, including strangers and including people the bet is about. This is simultaneously the top privacy bug and the reason notifications feel like spam.
**Fix:** replace all four call sites with a group-scoped send that resolves recipients via `group_members` for the event's group.

### C2 — There is no notification preferences table, and no subject-privacy mechanism
`lib/schema.sql:1-136` · **CRITICAL** · data-model
Nothing in the schema records per-user notification settings, per-group mute, category opt-outs, or the "don't notify the person this bet is about" flag the product requires. `events` has no `subject_user_id` and `bets` has no `notify_subject` — the feature has no place to live.
**Fix:** add `notification_preferences(user_id, category, channel, enabled)` and `events.subject_user_id` + `events.notify_subject BOOLEAN`, and exclude the subject from the recipient set when `notify_subject` is false.

### C3 — `POST /api/push/send` broadcasts to all subscribers with no auth
`app/api/push/send/route.ts:4-29` · **HIGH** · security
Unauthenticated. Any caller can push arbitrary title/body/URL to every registered device. The `url` is used verbatim by `notificationclick` when opening a window (`public/service-worker.js:134,148`), making this a phishing primitive.
**Fix:** require auth plus an admin/server-secret check, or delete the route.

### C4 — `POST /api/push/cleanup` deletes every subscription, unauthenticated
`app/api/push/cleanup/route.ts:4-11` · **HIGH** · security
`DELETE FROM push_subscriptions` behind an open POST endpoint. One curl disables notifications for the entire user base until everyone re-subscribes.
**Fix:** delete the route, or gate it behind a server-side secret.

### C5 — `GET /api/push/debug` exposes user IDs and endpoints unauthenticated
`app/api/push/debug/route.ts:4-19` · **HIGH** · privacy
Returns the full subscription count and a list of `{id, user_id, endpoint-prefix}` for every subscriber. `app/api/push/verify-key/route.ts:14` similarly returns `fullPublicKey` "for debugging", and `app/api/push/test/route.ts:5` will fire a test push at every web subscriber on the platform — all three unauthenticated.
**Fix:** delete all three debug routes.

### C6 — `POST /api/push/subscribe` lets anyone bind a device to another user, or unsubscribe them
`app/api/push/subscribe/route.ts:5-79` · **HIGH** · security
No auth. `user_id` comes from the request body (line 38), so an attacker can register their own Expo token under a victim's `user_id` and receive that user's targeted notifications. The `DELETE` branch (line 55-71) deletes by endpoint with no ownership check, so knowing an endpoint is enough to silence someone.
**Fix:** require auth and derive `user_id` from the session; scope the delete to the caller's own subscriptions.

### C7 — The `userId` cookie fallback is client-settable and never set by the auth flow
`app/api/push/subscribe/route.ts:33-38` · **MEDIUM** · security
The route falls back to `cookies().get('userId')`. Nothing in the Stack Auth flow sets that cookie; the only cookie writer in the repo is `lib/cookies.ts:4`, a client-side `document.cookie` helper with no `Secure`, `HttpOnly`, or `SameSite`. So the fallback is purely attacker-controlled.
**Fix:** remove the cookie fallback (subsumed by C6).

### C8 — Dead subscription cleanup is commented out, so the table only grows
`lib/push.ts:65-69` · **HIGH** · ops
The `410 Gone` / `404` handler that prunes expired push subscriptions is commented out with "TEMPORARILY DISABLED - Don't auto-delete to see what's failing". Every uninstalled browser and revoked permission stays in the table forever, is loaded by `getAll()` on every single notification, and is retried on every send. Delivery latency and failure counts grow monotonically.
**Fix:** re-enable the delete on `410`/`404`.

### C9 — Expo pushes ignore the response body, so dead device tokens are never detected
`lib/push.ts:179-192` · **MEDIUM** · correctness
`sendExpoNotification` treats any HTTP 200 as success. Expo returns per-message tickets in the body — `DeviceNotRegistered`, `MessageTooBig`, `MessageRateExceeded` all arrive inside a 200. Failures are counted as successes and invalid iOS tokens are kept forever.
**Fix:** parse `data.status`, and on `DeviceNotRegistered` delete the subscription.

### C10 — Notifications are sent one HTTP request per device, serially fanned out
`lib/push.ts:87-101,131-145` · **MEDIUM** · ops
Every recipient gets its own `fetch` to `exp.host`. Expo's API accepts batches of 100. Combined with C1 (send to *everyone* on every bet) and C8 (dead rows never pruned), a single bet triggers N outbound requests inside the request handler, which will time out the function well before the user base gets large.
**Fix:** chunk Expo tokens into batches of 100 and send one request per chunk.

### C11 — Tapping a notification on iOS does nothing
`mobile/src/services/notifications.ts:96-106` · **HIGH** · ux
`addNotificationResponseReceivedListener` reads `data.url` and then contains only the comment "This will be implemented in the navigation setup". There is no navigation call, and nothing handles a cold start from a notification. Every push on mobile opens the app to whatever screen it was last on.
**Fix:** map `data.url` to a route and call `navigationRef.navigate`, plus handle `getLastNotificationResponseAsync` at startup.

### C12 — Whole categories of notification are simply missing
`app/api/groups/join/route.ts:46`, `app/api/comments/route.ts:52` · **MEDIUM** · correctness
Approve and promote send pushes (`app/api/groups/members/route.ts:39,67`), but a join request notifies no admin, a new comment notifies nobody, no one is told when an event they bet on is about to close, and a losing bettor never learns they lost. Meanwhile *every* user on the platform is told about *every* bet (C1) — the signal is exactly inverted.
**Fix:** define the recipient rule per event type (actor's group only; participants for resolution; admins for join requests) and route all sends through one helper.

---

## D. Mobile: crashes and ship blockers → n7

### D1 — Deep-linking to `/invite` without query parameters crashes the app
`mobile/src/screens/CreateEventFromInviteScreen.tsx:34` · **HIGH** · crash
`const { title, sideA, sideB, pick, amount } = route.params;` destructures without a guard. React Navigation leaves `params` `undefined` when a matched path carries no parameters, and the linking config registers this screen at the bare path `invite` (`mobile/src/navigation/RootNavigator.tsx:97-106`). Since the universal-link association claims `paths: ['*']` (`app/.well-known/apple-app-site-association/route.ts:23`), tapping a plain `https://wagerpals.io/invite` link — which the web app actually serves at `app/invite/page.tsx` — opens the app and throws `Cannot read property 'title' of undefined`.
**Fix:** `const { title, sideA, sideB, pick, amount } = route.params ?? {};` plus an invalid-invite empty state.

### D2 — Google sign-in depends on `URL.searchParams`, which React Native does not implement
`mobile/src/services/auth.ts:87-88` · **HIGH** · crash
`new URL(result.url).searchParams` — React Native's built-in `URL` is a partial implementation whose `searchParams` getter is not usable, and no polyfill is installed (`mobile/package.json:14-38` has no `react-native-url-polyfill`). The entire Google OAuth return path runs through this line.
**Fix:** add `react-native-url-polyfill/auto` to `mobile/index.ts`, or parse the callback with `expo-linking`'s `parse()`, which is already a dependency.

### D3 — Resolving an event is impossible from the phone
`mobile/src/services/api.ts:156-164`, `mobile/src/screens/EventDetailScreen.tsx` · **HIGH** · correctness
`resolveEvent` posts `{ id, winning_side }` but `app/api/events/resolve/route.ts:13` reads `event_id` — the request always fails with `Missing required fields`. It is also never called: `EventDetailScreen` renders no resolve control at all. There is no way to settle a bet from iOS, which for a betting app is a shipping blocker on its own.
**Fix:** send `event_id`, and add a resolver-only resolve control to `EventDetailScreen`.

### D4 — Unresolve and delete send the same wrong field name
`mobile/src/services/api.ts:166-178` · **MEDIUM** · dead-code
`unresolveEvent` and `deleteEvent` both send `{ id }` where the routes read `event_id` (`app/api/events/unresolve/route.ts:12`, `app/api/events/delete/route.ts:6`). Neither is called from any screen, so these are three broken, unreachable methods that will mislead the next implementer.
**Fix:** fix the field names when the corresponding UI is built, or delete the methods now.

### D5 — The Activity tab is permanently empty
`mobile/src/services/api.ts:213-216`, `mobile/src/screens/ActivityScreen.tsx:32` · **HIGH** · correctness
`getActivity(groupId?)` builds `?groupId=…`, but `app/api/activity/route.ts:14-19` requires `userId` and 400s without it. `ActivityScreen` calls `getActivity()` with no argument at all, so the request is `/api/activity` with no query — a guaranteed 400. The error is swallowed at line 34 and the screen renders its empty state forever.
**Fix:** change the signature to `getActivity(userId)` and pass the signed-in user.

### D6 — Any thrown render error white-screens the app
`mobile/src/` (no `ErrorBoundary` anywhere) · **HIGH** · crash
A repo-wide search finds no error boundary and no `componentDidCatch`. In a release build, one bad render — D1, a malformed API payload, a missing `event.bets` — unmounts the whole tree to a blank screen with no recovery path.
**Fix:** wrap `RootNavigator` in an error boundary that shows a retry affordance and reports the error.

### D7 — No request timeout anywhere, so a hung network hangs the app on a spinner
`mobile/src/services/api.ts:25-33` · **HIGH** · ux
The shared `fetch` wrapper sets no `AbortController` and no timeout. `RootNavigator:112` renders a full-screen spinner while `checkingUsername` is true, and `checkUserUsername` (`:55-67`) awaits `getUser` with no deadline. If that request never settles the user stares at a spinner with no way forward.
**Fix:** wrap every request in an `AbortController` with a ~15s timeout and surface a retry.

### D8 — The Profile screen spins forever if auth is momentarily null
`mobile/src/screens/ProfileScreen.tsx:34-45` · **MEDIUM** · ux
`loadUserData` returns at line 35 when `!authUser`, skipping the `finally` that clears `isLoading` — the early return happens before the `try`. `isLoading` stays `true` and the screen renders only the spinner (line 80-86), permanently.
**Fix:** `setIsLoading(false)` on the early-return path.

### D9 — Sessions cannot survive access-token expiry
`mobile/src/services/auth.ts:59-61,154-160` · **HIGH** · correctness
The refresh token is stored and never used again. `getAccessToken` returns whatever is in SecureStore with no expiry check and no refresh call, and nothing handles a 401 by refreshing. Once the short-lived Stack Auth access token expires, every API call fails and the app appears logged in but broken, with no path back except a manual sign-out.
**Fix:** add a refresh-on-401 path that exchanges the stored refresh token and retries once.

### D10 — Auth can commit a user with an empty ID
`mobile/src/services/auth.ts:64` · **MEDIUM** · correctness
`id: data.user_id || data.id || ''` — if the `users/me` lookup in `app/api/auth/mobile-verify-code/route.ts:52-54` fails (that path tolerates a non-OK response and leaves `userData` empty), the app stores and treats as signed-in a user whose ID is `''`. Every subsequent request omits the identity header and fails in a confusing way.
**Fix:** throw when no user ID is returned instead of defaulting to `''`.

### D11 — iMessage-created events bypass the group membership check
`mobile/src/screens/CreateEventFromInviteScreen.tsx:98-104` · **HIGH** · security
`createEvent` never sends `creator_user_id`, and `app/api/events/route.ts:88-93` only enforces membership `if (creator_user_id)`. So the mobile invite flow can create an event in any group ID, and no `event_created` activity row is written either (`:111` is likewise gated on `creator_username`).
**Fix:** make the server derive the creator from the session and enforce membership unconditionally.

### D12 — There is no way to fund a wallet from the phone
`mobile/src/screens/EventDetailScreen.tsx:103-105`, `mobile/src/screens/ProfileScreen.tsx:131-176` · **HIGH** · ux
The Deposit button calls `Linking.openURL('https://wagerpals.io/profile?wallet=deposit')`, kicking the user out to Safari. The mobile Profile screen shows no balance, no transactions, and no wallet section at all, even though `apiService.getWallet` exists (`mobile/src/services/api.ts:128`). Paid bets on iOS therefore fail with "insufficient balance" and no in-app remedy.
**Fix:** add a wallet section to the mobile Profile and an in-app deposit sheet (and confirm the App Store policy position on cash deposits before shipping).

### D13 — Event creation asks users to hand-type a date string
`mobile/src/screens/CreateEventFromInviteScreen.tsx:81-87`, `mobile/src/screens/CreateEventScreen.tsx` · **MEDIUM** · ux
End time is two free-text fields concatenated into `YYYY-MM-DDTHH:MM` and fed to `new Date()`, with an alert on `NaN`. No date picker library is installed (`mobile/package.json:14-38`). This is the single most-used form in the app.
**Fix:** add `@react-native-community/datetimepicker` (or Expo's) and drop the string parsing.

---

## E. Cross-cutting: schema, web, infrastructure → n1 / n8 / n9

### E1 — Private group contents are readable by anyone who knows the 6-digit ID
`app/api/groups/route.ts:44-70`, `app/api/groups/members/route.ts:98-108`, `app/api/comments/route.ts:9-19` · **CRITICAL** · privacy
None of these GET handlers authenticate. Group IDs are 6 digits (`app/api/groups/route.ts:10-13`), a 900k keyspace that is trivially enumerable, and each hit returns the group name, the full active member roster with usernames, and pending join requests. `/api/comments?eventId=` returns any event's comments to anyone. `GET /api/users` (`app/api/users/route.ts:30`) dumps every user with their net totals.
**Fix:** add `requireAuth` plus a membership check to every group-scoped read, and drop the unfiltered `getAll` user listing.

### E2 — Event lists are cached publicly at the CDN edge
`app/api/events/route.ts:59-63`, `app/api/activity/route.ts:24-26` · **HIGH** · privacy
Both routes set `Cache-Control: public, s-maxage=…`. Private-group event titles and per-user activity feeds are stored in shared edge caches; the activity response is personalized by a `userId` query parameter, so it is cacheable-by-URL but still served from a public cache to anyone who replays the URL.
**Fix:** use `private, no-store` on anything scoped to a group or a user.

### E3 — A bet on an unrecognized side crashes the event endpoint
`app/api/events/route.ts:33` and `app/api/bets/route.ts:15` · **HIGH** · crash
`POST /api/bets` never validates that `side` is one of the event's two sides. `GET /api/events?id=` then does `sideStats[bet.side].count++` against a map pre-seeded with only `side_a` and `side_b`, so one bet with an arbitrary side string permanently 500s that event's detail page on both web and mobile.
**Fix:** reject `side` not in `{side_a, side_b}` at bet creation, and default the bucket defensively on read.

### E4 — IDs come from `Math.random`
`lib/utils.ts:4` · **MEDIUM** · security
`generateId` is `Math.random().toString(36) + Date.now().toString(36)` and is used for event, bet, comment, and **transaction** IDs. It is not collision-resistant under concurrency and is not unguessable — and transaction IDs are the handle for money records.
**Fix:** use `crypto.randomUUID()` (the groups route already uses `crypto.randomInt`, `app/api/groups/route.ts:11`).

### E5 — Three divergent sources of schema truth, and two of them are destructive
`lib/schema.sql` vs `scripts/init-db.ts:15-121` vs `scripts/clean-db.ts:23`/`scripts/reset-db.ts:29` · **HIGH** · data-model
`lib/schema.sql` is not executed by anything. `scripts/init-db.ts` carries its own copy that omits `wallets` and `transactions` entirely. `clean-db.ts` and `reset-db.ts` `CREATE TABLE users/events/bets/activities` from the pre-groups era — running either against a current database destroys the groups, wallets, and transactions model. Wallet tables exist only in the ad-hoc `scripts/migrate-wallet.ts`.
**Fix:** adopt one ordered migrations directory as the single source of truth and delete the legacy reset scripts.

### E6 — Four `npm run` scripts point at files that do not exist
`package.json:12,13,16,17` · **LOW** · ops
`db:test` → `scripts/test-activity.ts`, `db:add-push` → `scripts/add-push-subscriptions.ts`, `verify-pwa` → `scripts/verify-pwa-setup.ts`, `test:push` → `scripts/test-push-notification.ts`. None of the four files is in `scripts/`.
**Fix:** delete the dead script entries.

### E7 — No security headers beyond three legacy ones
`next.config.js:24-42` · **MEDIUM** · security
A real-money app ships only `X-Content-Type-Options`, `X-Frame-Options`, and the deprecated `X-XSS-Protection`. There is no CSP, no `Strict-Transport-Security`, no `Referrer-Policy`, no `Permissions-Policy`. There is also no `middleware.ts`, so nothing enforces auth at the edge. Next is pinned at `14.2.15` (`package.json:25`), which is behind the 14.2.x security patches.
**Fix:** add CSP/HSTS/Referrer-Policy/Permissions-Policy and bump Next to the latest 14.2.x.

### E8 — The service worker caches authenticated pages and has a substring origin check
`public/service-worker.js:43,63-78` · **MEDIUM** · privacy
`url.origin.includes('wagerpals.io')` matches any origin containing that substring (e.g. `https://wagerpals.io.attacker.example`) and fails to match preview deployments. Every 200 HTML response — including private group and event pages — is written into a shared per-origin cache, and it is served after sign-out. The existence of `app/clear-cache/page.tsx` suggests this has already caused trouble.
**Fix:** compare `url.origin === self.location.origin` and never cache HTML for authenticated routes.

### E9 — Notification clicks always open a new window
`public/service-worker.js:142` · **LOW** · ux
`urlToOpen` is a relative path like `/events/abc` while `client.url` is absolute, so the focus-existing-window branch can never match and every notification opens another tab.
**Fix:** compare against `new URL(urlToOpen, self.location.origin).href`.

### E10 — Universal links claim every path, including the OAuth callbacks
`app/.well-known/apple-app-site-association/route.ts:23` · **MEDIUM** · correctness
`paths: ['*']` means every `https://wagerpals.io/...` URL is intercepted by the installed app — including `/auth/*` and `/api/auth/*`, the very URLs the OAuth flow needs to open in the browser. `mobile/app.json:20` also still lists a stale `wagerpals-v2-q0eep0858-viraatdas-projects.vercel.app` preview domain.
**Fix:** restrict `paths` to the deep-linkable routes (`/events/*`, `/groups/*`, `/invite`) and drop the stale domain.

---

## Appendix

### What was verified, and how
Every `file:line` in this document was re-read from the working tree after the finding was drafted. Where a claim depends on runtime behavior (B1's negative-amount credit, B3's webhook replay, D5's guaranteed 400) it was derived by reading both sides of the call — the client payload and the server's parameter names — not by executing the code. **No code was run against a live database, no requests were sent to Stripe or Expo, and nothing was deployed.** Downstream nodes should treat the reasoning as sound but reproduce the money-path ones (B1, B3, B4) against a test database before and after their fix.

### Deliberately out of scope
Visual/design findings were excluded — the light-theme migration was audited by n1–n9 of the previous plan and is recorded in `DECISIONS.md`. Two open items from that work remain relevant to n5 (brand): app icons are still the legacy orange `#ea580c` while the app accent is blue `#2563eb` (`public/icons/*.svg`, `mobile/assets/*`), and repeated inline input styling has not been hoisted into a shared class.

### Not covered here
- No automated tests exist anywhere in the repo, so there is no baseline any node can regress against. Recommend n1 add a minimal API-route test harness before n2/n3 start changing money paths.
- The iMessage extension Swift sources were read (`mobile/plugins/imessage-extension/swift/*.swift`) and are structurally sound; the composer only builds a URL, so the extension inherits D1's crash through the link it generates rather than owning a defect of its own.
- Load, cost, and query-plan analysis was not attempted.
