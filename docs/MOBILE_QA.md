# WagerPals iPhone app — QA checklist and results

**Node:** n7 · **Date:** 2026-08-16 · **Target:** `mobile/` (Expo SDK 54 / React Native 0.81.4, iOS)

---

## How to read this document, and what "PASS" means here

This is a record of what was actually checked, by what method, with the result. It is not a
claim that the app was driven by hand on a device.

**There is no iOS simulator or physical device in this environment, and no reachable database.**
Nothing below was verified by launching the app. Every result is one of:

- **`[tsc]`** — proven by the TypeScript compiler (`npx tsc --noEmit`), which is a real proof.
- **`[grep]`** — proven by a mechanical search over the source, quoted so you can re-run it.
- **`[read]`** — verified by reading both sides of a contract (client call *and* server handler).
  Strong for shape/wiring mismatches, which is exactly the class of bug that made the Activity
  tab permanently empty. Cannot prove runtime feel.
- **`[UNVERIFIED]`** — implemented and type-correct, but its *behaviour* genuinely needs a
  device. Called out honestly rather than folded into a PASS.

Anything requiring a simulator, a Stripe transaction, a real push token, or a live database is
listed in [Not verified here](#not-verified-here). **Do not treat this document as a substitute
for a TestFlight pass.**

---

## Gate results

Run from the repo root unless noted.

| Gate | Command | Result |
|---|---|---|
| Mobile typecheck | `cd mobile && npx tsc --noEmit` | **PASS** — zero output |
| Root typecheck | `npx tsc --noEmit` | **PASS** — zero output |
| iMessage regression gate (n6) | `npx tsx scripts/verify-imessage.ts` | **PASS — 139/139** |
| Notifications regression gate (n4) | `npx tsx scripts/verify-notifications.ts` | **PASS — 14/14** |
| Web production build | `npm run build` | **PASS** (exit 0) — see note below |
| Lint | `npm run lint` | **NOT RUN — unavailable** |

**Build note.** `npm run build` fails on a bare checkout with
`Failed to collect page data for /api/auth/mobile-session` because Stack Auth requires
`NEXT_PUBLIC_STACK_PROJECT_ID` at build time. This is pre-existing and environmental — n4
recorded the identical behaviour in `DECISIONS.md`. Re-running with placeholder Stack Auth env
vars supplied inline produces **exit 0** and a full route manifest. n7 changed **zero** files
under `app/`, `lib/`, `components/` or `scripts/`, so it cannot have affected the web build. No
`.env.local` was created or left behind.

**Lint note.** The repo has **no ESLint configuration**, so `next lint` drops into an
interactive "How would you like to configure ESLint?" prompt and cannot run non-interactively.
Adding a config would mean editing root project files owned by other nodes, so this was left
alone and is reported as not-run rather than silently skipped.

---

## Audit findings — section D (mobile), closed status

Every finding from `docs/AUDIT.md` §D. **D2 was re-tested and found stale**; D11's server half
and D2/D10's owning file are outside n7's lane and are flagged, not silently dropped.

| # | Finding | Status | Evidence |
|---|---|---|---|
| **D1** | Deep-linking `/invite` with no params crashes the app | **CLOSED** | `CreateEventFromInviteScreen.tsx:145` is now `route.params ?? {}`; `hasInviteBasics` gates a designed invalid-invite state. Nav params made optional in `types/navigation.ts`. `[read]` `[tsc]` |
| **D2** | Google sign-in depends on `URL.searchParams`, unimplemented in RN | **NOT A BUG on RN 0.81.4** | RN *does* implement it: `URL.js:173` builds `searchParams` from a regex-extracted `search`, and `URLSearchParams.js:27` strips the leading `?` before parsing. Verified in the installed `node_modules`. The audit's claim held for older RN. **No change made** — see [Deliberately not changed](#deliberately-not-changed). `[read]` |
| **D3** | Resolving an event is impossible from the phone | **CLOSED** | `api.ts` now sends `event_id` (was `id`); `EventDetailScreen` gained a resolver-gated resolve control, plus cancel/unresolve/delete. `[read]` `[tsc]` |
| **D4** | Unresolve and delete send the wrong field name | **CLOSED** | Both send `{ event_id }`, matching `app/api/events/{unresolve,delete}/route.ts`. Both are now reachable from the UI. `[read]` |
| **D5** | The Activity tab is permanently empty | **CLOSED** | `getActivity(userId, opts)` now requires `userId` and sends `?userId=`; it throws client-side rather than firing a request guaranteed to 400. `ActivityScreen` passes `user.id`. `[read]` `[tsc]` |
| **D6** | Any thrown render error white-screens the app | **CLOSED** | `components/ErrorBoundary.tsx` (real `getDerivedStateFromError` + `componentDidCatch`), mounted at `RootNavigator.tsx:152` *outside* `NavigationContainer` so it survives a crash in any screen. `[grep]` |
| **D7** | No request timeout, so a hung network hangs on a spinner | **CLOSED** | Every request runs under an `AbortController` with a 15s default deadline; aborts surface as `ApiError{kind:'timeout'}` with a retry-able message. `[read]` |
| **D8** | Profile spins forever if auth is momentarily null | **CLOSED** | The `!authUser` early return now clears the loading flags and renders a signed-out state. Same latent bug found and fixed in `HomeScreen` and `ActivityScreen`. `[read]` |
| **D9** | Sessions cannot survive access-token expiry | **CLOSED** | Every request now sends `x-stack-refresh-token`; `lib/auth.ts:57` reads it and hands both tokens to Stack Auth's `getUser({tokenStore})`, which mints a fresh access token server-side. No sign-out on 401. See the caveat below. `[read]` |
| **D10** | Auth can commit a user with an empty ID | **MITIGATED (not fixed at source)** | The defect is in `auth.ts` (`id: data.user_id \|\| data.id \|\| ''`), which n7 does not own. `RootNavigator` now refuses to treat an id-less user as signed in, so the failure mode is a recoverable auth screen instead of a logged-in app where every request fails. **The root cause remains.** `[read]` |
| **D11** | iMessage-created events bypass the group membership check | **CLIENT HALF CLOSED** | `createEvent` now makes `creator_user_id` and `creator_username` *required parameters*, so no mobile call site can omit them and skip the server's `if (creator_user_id)` membership check. **The server half — deriving the creator from the session and enforcing unconditionally — is in `app/api/events/route.ts`, outside n7's lane.** `[read]` `[tsc]` |
| **D12** | No way to fund a wallet from the phone | **CLOSED, with a documented limit** | New `WalletScreen`; wallet summary on Profile; escrow shown on EventDetail. Every `Linking.openURL('…/profile?wallet=deposit')` removed from `EventDetailScreen` and `GroupDetailScreen`. Deposit *completion* still needs Stripe — see [Not verified here](#not-verified-here). `[grep]` |
| **D13** | Event creation asks users to hand-type a date string | **CLOSED** | Both create screens use `components/DateTimeField.tsx` (presets + day strip + time wheel), pure JS, no native module. `grep` for `YYYY-MM-DD`, `Invalid Date`, `endDate` across both screens returns nothing. `[grep]` |

### D9 caveat, stated precisely
The fix removes the user-visible symptom (an app that looks signed in but where every request
fails). Stack Auth refreshes the access token **server-side, per request**, from the refresh
token we now send. The mobile client does **not** receive or persist a rotated access token, so
every request pays that refresh until the user next signs in. If Stack Auth is ever configured
to rotate and invalidate refresh tokens on use, this approach needs revisiting.

---

## Cross-cutting checks

### Zero hardcoded colors — PASS `[grep]`
```
grep -rn "#[0-9a-fA-F]\{3,8\}\|rgba\?(" mobile/src/
```
Matches in exactly two files, **neither of which is a color in effect**:
- `mobile/src/theme.ts` — the token definitions themselves, which is the point.
- `mobile/src/navigation/MainTabNavigator.tsx:52` — a **comment** quoting the
  `rgba(255,255,255,0.94)` value that was removed, so the reason for the change survives.

No `StyleSheet` entry or inline style anywhere in `mobile/src` carries a color literal. Every
screen, component and navigator sources color from `colors` / `tokens.color` / `gradients`.
The final two literals (an `rgba(255,255,255,0.94)` fake-translucent tab bar and a `#0F172A`
shadow in `MainTabNavigator.tsx`) were replaced with a real `expo-blur` `tabBarBackground` and
`tokens.shadow.elev3.shadowColor`.

### FlatList correctness — PASS `[grep]`
Every `<FlatList>`/`<SectionList>` in the app has a `keyExtractor`; counts match one-for-one
across 8 files. No key is a bare array index:
- `item.id` for groups, events, transactions, users, bets
- `item.user_id` for members
- `ActivityScreen` composes `type-event_id-user_id-timestamp-index` because `ActivityItem` has
  no server-side id; the index is a last-resort tiebreaker, never the whole key
- Two `keyExtractor={() => 'noop'}` in `GroupAdminScreen` are on `sections={[]}` lists that
  exist purely to attach a `RefreshControl` to an error state — the extractor is never invoked

Virtualization props (`initialNumToRender` / `windowSize` / `maxToRenderPerBatch` /
`removeClippedSubviews`) set on the real content lists. `getItemLayout` deliberately **not**
set — none of these rows are fixed-height.

**Fixed during this pass:** `GroupDetailScreen` and `GroupAdminScreen` rendered their lists as
`.map()` inside a `ScrollView`, mounting every row at once. Both are now virtualized
(`FlatList` with a `ListHeaderComponent`, and a `SectionList` respectively).

### Pull-to-refresh actually refreshes — PASS `[read]`
`RefreshControl` is attached to the list itself in all 9 scrollable screens, including in the
loading, empty and error states (empty/error render via `ListEmptyComponent` with
`contentContainerStyle={{ flexGrow: 1 }}`). Previously an empty list rendered a plain `View`,
so a user with zero groups had no way to refresh.

> **Defect found and fixed during review.** The new SWR cache silently defeated pull-to-refresh:
> `request()` returns a cached entry whether it is fresh *or* stale, so a deliberate pull inside
> the TTL (15s groups / 10s activity / 5s events) replayed the same bytes and the spinner lied.
> Fixed centrally with `apiService.invalidateForRefresh(...prefixes)`, called at the top of every
> refresh handler. No single screen agent could have seen this — it only exists where the new
> cache meets the new refresh handlers.

### Safe area on notched devices — PASS `[grep]`
All 15 screens are covered: 12 use `SafeAreaView` / `useSafeAreaInsets` directly; the other 3
(`CreateEventScreen`, `CreateEventFromInviteScreen`, `EditUsernameScreen`) inherit it from
`components/FormScreen.tsx`, which calls `useSafeAreaInsets` (`FormScreen.tsx:47`) and pads both
scroll content and sticky footer by `insets.bottom`.

Screens pushed onto the native stack (which already draws a header) use `edges={['bottom']}`;
tab screens use `edges={['top']}`. `ProfileScreen` was using `edges={['top']}` *with*
`headerShown: true`, double-padding under the header — fixed.

Content clears the absolutely-positioned ~88pt tab bar via explicit bottom padding; the height
constants are now exported once from `MainTabNavigator` instead of being re-hardcoded per screen.

### Keyboard never covers the input — PASS `[read]` / partly `[UNVERIFIED]`
Every text-entry screen is wrapped in `FormScreen` (`KeyboardAvoidingView` with
`behavior: 'padding'` on iOS, `keyboardShouldPersistTaps="handled"`,
`keyboardDismissMode="interactive"`, sticky footer above the keyboard and home indicator), except
`EventDetailScreen`, which hand-builds the same recipe because it also needs a `RefreshControl`
(which `FormScreen` does not expose) and a pinned comment composer.

`[UNVERIFIED]` The exact `keyboardVerticalOffset` values (90 on iOS under a native-stack header)
are a standard value, not a measured one. **This is the single most likely thing to need a
nudge on a real device**, particularly on a Dynamic Island phone.

### Touch targets ≥ 44×44pt — PASS `[read]`
Shared primitives enforce it structurally: `Button` (`md`/`lg` are 44/52pt tall; `sm` is 36pt and
grows its hit area via computed `hitSlop`), `ListRow`, `Toggle` (whole row tappable), `Pill`,
`SegmentedControl`, `BottomSheet` close, `Field` accessories. 12 component files carry explicit
`minHeight: 44` / `minWidth: 44` / `hitSlop`.

`[UNVERIFIED]` Screens that still use bare `TouchableOpacity` rather than the shared `Button`
(`HomeScreen` ×7, `ExploreScreen` ×3, `TextInputModal` ×5) were read and their targets look
adequate, but they are not structurally guaranteed the way the primitives are. Worth a pass with
the Accessibility Inspector.

### Long usernames and titles don't overflow — PASS `[read]`
Every user-supplied string renders through a component with `numberOfLines` + `ellipsizeMode`,
inside a container with `flexShrink: 1` / `minWidth: 0` so trailing content (Admin badge, amount,
chevron) cannot be pushed off-screen. Checked specifically against a 20-char username (the
server cap in `lib/utils.ts validateUsername`) and a 120-char event title.

### No unhandled promise rejections — PASS `[grep]` `[read]`
Every `async` event handler has a `try/catch`; fire-and-forget calls carry `.catch()`.
`apiService.prefetch()` swallows by design so a cache warm can never surface as a rejection.
Optional legs of the aggregators (`getEventScreenData`'s wallet) degrade to `null` rather than
rejecting the whole screen.

### Errors reach the user as sentences — PASS `[grep]`
15 screens render `ApiError.userMessage`. The only remaining reads of raw `err.message` are
**branching**, not display: matching `'Authentication cancelled'`, `/subject/i`, and the join
failure strings. No screen renders a stack trace; `ErrorBoundary` shows the raw message only
under `__DEV__`.

### Offline / slow network — PASS `[read]`, behaviour `[UNVERIFIED]`
`ApiError.kind` distinguishes `network` / `timeout` / `http` / `parse`. Offline yields
"You appear to be offline. Check your connection and try again."; a 15s timeout yields
"That took too long. Tap to try again." — both with a working Retry, rather than an infinite
spinner. Idempotent GETs retry once after 400ms; mutations are **never** auto-retried (a retried
bet or withdrawal could double-submit — most of these routes take no client idempotency key).

`[UNVERIFIED]` Not exercised against a real degraded connection.

---

## Per-screen checklist

Legend: **L/E/E** = distinct Loading / Empty / Error states · **PTR** = pull-to-refresh ·
**KB** = keyboard-safe · **SA** = safe area · **44** = touch targets · **TXT** = overflow-safe

| Screen | L/E/E | PTR | KB | SA | 44 | TXT | Notes |
|---|:--:|:--:|:--:|:--:|:--:|:--:|---|
| Home | ✅ | ✅ | n/a | ✅ | ✅ | ✅ | Skeleton only on first load; later focuses refetch silently. Unmount guard added. |
| Explore | ✅ | ✅ | n/a | ✅ | ✅ | ✅ | Split bar, countdown, cash-stake pill. Title search. |
| Activity | ✅ | ✅ | n/a | ✅ | ✅ | ✅ | **Was 100% broken (D5).** Now paginated with a duplicate-load guard. |
| Profile | ✅ | ✅ | n/a | ✅ | ✅ | ✅ | **D8 fixed.** Wallet card added; sign-out clears the API cache. |
| Wallet *(new)* | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | Balance + escrow + history. Deposit limited — see below. |
| EventDetail | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **Resolve control added (D3).** Escrow UI, defensive `side_stats`. |
| GroupDetail | ✅ | ✅ | n/a | ✅ | ✅ | ✅ | Virtualized. Deposit button now routes in-app. |
| GroupAdmin | ✅ | ✅ | n/a | ✅ | ✅ | ✅ | Per-row busy state blocks double-tap; B7 consequence spelled out. |
| CreateEvent | ✅ | n/a | ✅ | ✅ | ✅ | ✅ | Date picker, payment type, subject tagging, notify toggle. |
| CreateEventFromInvite | ✅ | n/a | ✅ | ✅ | ✅ | ✅ | **D1 crash fixed** + invalid-invite state. |
| JoinGroup | ✅ | n/a | ✅ | ✅ | ✅ | ✅ | 6-digit numeric pad; distinct copy per failure. |
| EditUsername | inline | n/a | ✅ | ✅ | ✅ | ✅ | Inline validation; "username taken" surfaced properly. |
| NotificationPreferences *(new)* | ✅ | ✅ | n/a | ✅ | ✅ | ✅ | 7 categories; optimistic + debounced; OS-permission banner. |
| Auth | inline | n/a | ✅ | ✅ | ✅ | ✅ | Resend cooldown; cancelled Google sign-in is silent. |
| UsernameSetup | inline | n/a | ✅ | ✅ | ✅ | ✅ | Confirmed it calls `setUsername` (`username_selected: true`) — audit A10. |

Form screens show **inline field errors** instead of an `ErrorState`, and have no list, hence no
empty state. That is the intended pattern, not a gap.

---

## Behaviour verified by reading both sides of the contract

These are the mismatches that caused the worst bugs, so each was checked against the handler:

- `GET /api/activity` requires `userId`, 400s without it → client sends it. (D5)
- `POST /api/events/{resolve,unresolve,delete}` read `event_id`, not `id` → all three fixed. (D3/D4)
- `GET /api/events?id=` returns `escrow_total` and a `side_stats` map **keyed by side label**;
  `lib/db.ts:449` builds that map from flat SQL columns. Client indexes it defensively.
- `GET /api/wallet` returns `{wallet, transactions, escrow_held_total, available, event?}`;
  the per-event leg is `event.escrow_held`, **not** `escrow_total`. Both used correctly.
- `POST /api/bets` cash path: when `event.stake_amount` is set, `lib/payments.ts placeCashBet`
  requires the amount to equal it **exactly** (`INVALID_STAKE`). The UI locks the amount field
  for fixed-stake events instead of offering a free-form input the server will reject.
- Cash events **close** at `end_time` (`EVENT_CLOSED`); free events accept late bets flagged
  `is_late`. The UI blocks the former and warns on the latter — these are genuinely different,
  and the previous UI treated them the same.
- `GET /api/users?id=` 404s for an unknown user → the navigator now only forces username setup
  on a **404**, not on any failure. Previously a network blip dropped an established user into
  first-run setup.
- Notification categories match `lib/types.ts` exactly (7 keys); the server rejects unknown ones.

---

## Not verified here

Everything in this section needs a device, a live database, or real credentials.

1. **Nothing was run on a simulator or device.** No launch, no navigation, no gesture, no
   rendering. Visual polish, animation smoothness, haptic feel, blur appearance and the exact
   keyboard offsets are all unconfirmed.
2. **Deposits cannot complete in-app.** `POST /api/wallet` returns a Stripe `clientSecret`, and
   confirming it requires `@stripe/stripe-react-native`, which is **not** in `mobile/package.json`.
   Adding it is a native module needing an `expo prebuild`, which would put n6's Messages
   extension build at risk with no way to verify here (see `DECISIONS.md`). The deposit sheet
   therefore validates the amount in-app and hands off to the web flow, with an `AppState`
   listener refreshing the balance on return. It deliberately does **not** call `createDeposit()`
   just to discard the secret, which would strand an orphaned pending PaymentIntent and
   `transactions` row. `WalletScreen.tsx` carries a comment listing exactly what a future node
   must do.
3. **App Store policy on cash deposits is unresolved and out of scope.** Apple has a position on
   real-money deposit flows in iOS apps. Flagged, not decided — this is a product/legal call.
4. **Withdrawal, resolve, payout and escrow were never executed** against a database. The DB is
   unreachable from this worktree.
5. **Push notifications** were not delivered to a device. The preferences screen's OS-permission
   banner reads `Notifications.getPermissionsAsync()` and is untested against a real denial.
6. **The `DateTimeField` time wheel** compiles and its snap logic reads correctly, but the
   initial `contentOffset` positioning is the one part most likely to need a visual nudge.
7. **`Clipboard`** (tap-to-copy join code) uses RN's built-in, which is present and functional in
   0.81.4 but logs a deprecation warning. `expo-clipboard` is the long-term move; it was not
   added because n7 ships no new dependencies.
8. **No automated tests exist for the mobile app**, so there is no regression baseline. The two
   gates that *do* protect this work (`verify-imessage`, `verify-notifications`) cover the
   server contracts, not the UI.

---

## Deliberately not changed

- **`mobile/src/services/auth.ts`** — owned by an earlier node; its `migrateLegacySecureStore()`
  ordering is load-bearing for the iMessage extension and for keeping existing users signed in.
  D2 turned out not to need a change; D10 is mitigated in `RootNavigator` instead.
- **`mobile/src/theme.ts`, `notifications.ts`, `app.json`, `ios/**`** — consumed, not modified.
- **No new npm dependencies** — recorded in `DECISIONS.md` with rationale.
- **`app/**`, `lib/**`, `components/**`, `scripts/**`** — untouched, which is why the web build
  and both regression gates are unaffected.

## Handoff — things another node should pick up

1. **D11 server half** (`app/api/events/route.ts`): derive the creator from the session and
   enforce group membership unconditionally, rather than only `if (creator_user_id)`.
2. **D10 root cause** (`mobile/src/services/auth.ts:64`): throw when no user id is returned
   instead of defaulting to `''`.
3. **Resolver is not exposed for public-group cash events.** `app/api/events/route.ts` computes
   `resolver` only when `!group.is_public`, but `resolve/route.ts` requires the resolver whenever
   `payment_type === 'cash' || !group.is_public`. So for a **public group's cash event** the
   client is never told who may resolve it. EventDetail shows the control optimistically and
   relies on the server's 403 — correct, but the server should populate `resolver` whenever
   `payment_type === 'cash'` too.
4. **In-app Stripe deposit** — see item 2 of *Not verified here*.
5. **A TestFlight pass is still required.** This document is a static-analysis floor, not a
   substitute for it.
